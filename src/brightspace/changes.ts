import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AppContext } from '../context.js';
import { toSafeError } from '../errors.js';
import { accountKey } from '../index/install.js';
import { announcements } from './news.js';
import { assignments } from './assignments.js';
import { courseContent } from './content.js';
import { courseGrades } from './grades.js';
import { selectCourses, type UpcomingOptions } from './planning.js';
import type { Course } from './courses.js';

interface CourseSnapshot {
  takenAt: string;
  announcements: Record<string, string>;
  topics: Record<string, string>;
  assignments: Record<string, string>;
  grades: Record<string, string>;
}

interface SnapshotFile {
  version: 1;
  courses: Record<string, CourseSnapshot>;
}

async function loadSnapshots(file: string): Promise<SnapshotFile> {
  try {
    const data = JSON.parse(await readFile(file, 'utf8')) as SnapshotFile;
    return data.version === 1 && data.courses ? data : { version: 1, courses: {} };
  } catch {
    return { version: 1, courses: {} };
  }
}

async function saveSnapshots(file: string, data: SnapshotFile): Promise<void> {
  await mkdir(join(file, '..'), { recursive: true, mode: 0o700 });
  const temp = `${file}.tmp`;
  await writeFile(temp, JSON.stringify(data), { mode: 0o600 });
  await rename(temp, file);
}

export interface ChangeSet {
  courseId: string;
  courseCode: string;
  courseName: string;
  firstCheck: boolean;
  newAnnouncements: unknown[];
  newOrUpdatedContent: unknown[];
  newAssignments: unknown[];
  changedDueDates: unknown[];
  newGrades: unknown[];
  errors: { area: string; error: ReturnType<typeof toSafeError> }[];
}

/** Compare live course data with the last snapshot for this account and report what changed. */
export async function whatsNew(ctx: AppContext, options: UpcomingOptions & { peek?: boolean } = {}) {
  const identity = await ctx.brightspace.identity();
  const file = join(ctx.config.snapshotDir, `${accountKey(ctx, identity.id)}.json`);
  const snapshots = await loadSnapshots(file);
  const courses = await selectCourses(ctx, options.courseIds);
  const changes: ChangeSet[] = [];
  const now = new Date().toISOString();
  for (const course of courses) changes.push(await diffCourse(ctx, course, snapshots.courses[course.id]));
  if (!options.peek) {
    for (const course of courses) {
      const change = changes.find((c) => c.courseId === course.id)!;
      if (change.errors.length) continue;
      snapshots.courses[course.id] = (change as ChangeSet & { next: CourseSnapshot }).next;
      snapshots.courses[course.id]!.takenAt = now;
    }
    await saveSnapshots(file, snapshots);
  }
  const stripped = changes.map((change) => {
    const copy = { ...change } as ChangeSet & { next?: CourseSnapshot };
    delete copy.next;
    return copy;
  });
  const touched = stripped.filter(
    (change) =>
      change.newAnnouncements.length ||
      change.newOrUpdatedContent.length ||
      change.newAssignments.length ||
      change.changedDueDates.length ||
      change.newGrades.length,
  );
  return {
    checkedAt: now,
    previousCheck:
      Object.values(snapshots.courses)
        .map((s) => s.takenAt)
        .sort()
        .at(-1) ?? null,
    snapshotAdvanced: !options.peek,
    courses: stripped,
    summary: {
      coursesChecked: courses.length,
      coursesWithChanges: touched.length,
      newAnnouncements: touched.reduce((n, c) => n + c.newAnnouncements.length, 0),
      newOrUpdatedContent: touched.reduce((n, c) => n + c.newOrUpdatedContent.length, 0),
      newAssignments: touched.reduce((n, c) => n + c.newAssignments.length, 0),
      changedDueDates: touched.reduce((n, c) => n + c.changedDueDates.length, 0),
      newGrades: touched.reduce((n, c) => n + c.newGrades.length, 0),
    },
    note: 'On the first check for a course everything counts as existing and nothing is reported as new. Use peek: true to compare without advancing the snapshot.',
  };
}

async function diffCourse(
  ctx: AppContext,
  course: Course,
  previous: CourseSnapshot | undefined,
): Promise<ChangeSet & { next: CourseSnapshot }> {
  const next: CourseSnapshot = { takenAt: '', announcements: {}, topics: {}, assignments: {}, grades: {} };
  const result: ChangeSet & { next: CourseSnapshot } = {
    courseId: course.id,
    courseCode: course.courseCode ?? course.code,
    courseName: course.name,
    firstCheck: !previous,
    newAnnouncements: [],
    newOrUpdatedContent: [],
    newAssignments: [],
    changedDueDates: [],
    newGrades: [],
    errors: [],
    next,
  };
  const [news, content, work, grades] = await Promise.allSettled([
    announcements(ctx, course.id),
    courseContent(ctx, course.id),
    assignments(ctx, course.id),
    courseGrades(ctx, course.id),
  ]);
  if (news.status === 'fulfilled') {
    for (const item of news.value.items) {
      const stamp = item.modifiedAt ?? item.publishedAt ?? '';
      next.announcements[item.id] = stamp;
      if (previous && previous.announcements[item.id] === undefined)
        result.newAnnouncements.push({
          id: item.id,
          title: item.title,
          publishedAt: item.publishedAt,
          publishedLocal: item.publishedLocal,
          text: item.text.slice(0, 500),
          url: item.url,
        });
    }
  } else result.errors.push({ area: 'announcements', error: toSafeError(news.reason) });
  if (content.status === 'fulfilled') {
    for (const topic of content.value.topics) {
      const stamp = topic.lastModified ?? '';
      next.topics[topic.id] = stamp;
      if (!previous) continue;
      const before = previous.topics[topic.id];
      if (before === undefined)
        result.newOrUpdatedContent.push({
          change: 'new',
          topicId: topic.id,
          title: topic.title,
          module: topic.module,
          type: topic.type,
          url: topic.url,
        });
      else if (before !== stamp && stamp)
        result.newOrUpdatedContent.push({
          change: 'updated',
          topicId: topic.id,
          title: topic.title,
          module: topic.module,
          type: topic.type,
          url: topic.url,
        });
    }
  } else result.errors.push({ area: 'content', error: toSafeError(content.reason) });
  if (work.status === 'fulfilled') {
    for (const item of work.value.items) {
      next.assignments[item.id] = item.dueDate ?? '';
      if (!previous) continue;
      const before = previous.assignments[item.id];
      if (before === undefined)
        result.newAssignments.push({
          id: item.id,
          title: item.title,
          dueDate: item.dueDate,
          dueLocal: item.dueLocal,
          url: item.url,
        });
      else if (before !== (item.dueDate ?? ''))
        result.changedDueDates.push({
          id: item.id,
          title: item.title,
          previousDueDate: before || null,
          dueDate: item.dueDate,
          dueLocal: item.dueLocal,
          url: item.url,
        });
    }
  } else result.errors.push({ area: 'assignments', error: toSafeError(work.reason) });
  if (grades.status === 'fulfilled') {
    const values = grades.value.values as {
      id: string;
      name: string;
      displayed: string;
      lastModified: string | null;
      points: number | null;
      maxPoints: number | null;
    }[];
    for (const value of values) {
      const stamp = `${value.displayed}|${value.lastModified ?? ''}`;
      next.grades[value.id] = stamp;
      if (previous && previous.grades[value.id] !== stamp && value.displayed)
        result.newGrades.push({
          id: value.id,
          name: value.name,
          displayed: value.displayed,
          points: value.points,
          maxPoints: value.maxPoints,
          lastModified: value.lastModified,
        });
    }
  } else result.errors.push({ area: 'grades', error: toSafeError(grades.reason) });
  return result;
}
