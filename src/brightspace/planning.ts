import type { AppContext } from '../context.js';
import { toSafeError, TudelftError } from '../errors.js';
import { timeOf, toLocal } from '../util/dates.js';
import { announcements } from './news.js';
import { assignments } from './assignments.js';
import { calendarEvents } from './calendar.js';
import { listCourses, type Course } from './courses.js';
import { quizzes } from './quizzes.js';

export interface UpcomingItem {
  kind: 'assignment' | 'quiz' | 'calendar' | 'availability_ends';
  courseId: string;
  courseCode: string;
  courseName: string;
  id: string;
  title: string;
  when: string;
  whenLocal?: string;
  daysLeft: number;
  detail?: string;
  url: string;
}

export interface UpcomingOptions {
  courseIds?: string[];
  days?: number;
  includeAnnouncements?: boolean;
  includeCalendar?: boolean;
}

/** Resolve the course set: explicit ids, or every active course. */
export async function selectCourses(ctx: AppContext, courseIds?: string[]): Promise<Course[]> {
  const all = await listCourses(ctx.brightspace, { activeOnly: true });
  if (!courseIds?.length) return all.items;
  const wanted = new Set(courseIds);
  const picked = all.items.filter(
    (course) => wanted.has(course.id) || (course.courseCode && wanted.has(course.courseCode)),
  );
  if (!picked.length)
    throw new TudelftError(
      'NOT_FOUND',
      'None of the given course ids are active enrollments. Use list_courses.',
    );
  return picked;
}

/** Everything with a date in the coming days across courses: due dates, quizzes, calendar events. */
export async function upcoming(ctx: AppContext, options: UpcomingOptions = {}) {
  const days = Math.max(1, Math.min(180, options.days ?? 14));
  const courses = await selectCourses(ctx, options.courseIds);
  const now = Date.now();
  const end = now + days * 86_400_000;
  const items: UpcomingItem[] = [];
  const errors: { courseId: string; area: string; error: ReturnType<typeof toSafeError> }[] = [];
  const undated: { courseId: string; kind: string; id: string; title: string }[] = [];
  const recent: unknown[] = [];
  const push = (
    course: Course,
    kind: UpcomingItem['kind'],
    id: string,
    title: string,
    when: string | null,
    url: string,
    detail?: string,
  ): void => {
    const time = timeOf(when);
    if (time === undefined) {
      if (kind !== 'availability_ends') undated.push({ courseId: course.id, kind, id, title });
      return;
    }
    if (time < now - 86_400_000 || time > end) return;
    const local = toLocal(when);
    items.push({
      kind,
      courseId: course.id,
      courseCode: course.courseCode ?? course.code,
      courseName: course.name,
      id,
      title,
      when: when!,
      ...(local ? { whenLocal: local } : {}),
      daysLeft: Math.floor((time - now) / 86_400_000),
      ...(detail ? { detail } : {}),
      url,
    });
  };
  await Promise.all(
    courses.map(async (course) => {
      const [a, q, n] = await Promise.allSettled([
        assignments(ctx, course.id),
        quizzes(ctx, course.id),
        options.includeAnnouncements === false
          ? Promise.resolve(null)
          : announcements(ctx, course.id, { since: new Date(now - 7 * 86_400_000), limit: 3 }),
      ]);
      if (a.status === 'fulfilled') {
        for (const item of a.value.items) {
          push(
            course,
            'assignment',
            item.id,
            item.title,
            item.dueDate,
            item.url,
            item.submitted ? 'submitted' : undefined,
          );
          if (!item.dueDate && item.closesAt)
            push(
              course,
              'availability_ends',
              item.id,
              item.title,
              item.closesAt,
              item.url,
              'no due date; submissions close',
            );
        }
      } else errors.push({ courseId: course.id, area: 'assignments', error: toSafeError(a.reason) });
      if (q.status === 'fulfilled') {
        for (const quiz of q.value.items.filter((item) => item.active)) {
          push(
            course,
            'quiz',
            quiz.id,
            quiz.name,
            quiz.dueDate ?? quiz.closesAt,
            quiz.url,
            quiz.dueDate ? undefined : 'closes',
          );
        }
      } else errors.push({ courseId: course.id, area: 'quizzes', error: toSafeError(q.reason) });
      if (n.status === 'fulfilled' && n.value) {
        for (const item of n.value.items)
          recent.push({
            courseId: course.id,
            courseCode: course.courseCode ?? course.code,
            id: item.id,
            title: item.title,
            publishedAt: item.publishedAt,
            publishedLocal: item.publishedLocal,
            url: item.url,
            text: item.text.slice(0, 400),
          });
      } else if (n.status === 'rejected')
        errors.push({ courseId: course.id, area: 'announcements', error: toSafeError(n.reason) });
    }),
  );
  if (options.includeCalendar !== false) {
    try {
      const events = await calendarEvents(
        ctx,
        courses.map((course) => course.id),
        new Date(now),
        new Date(end),
      );
      const seen = new Set(items.map((item) => `${item.kind}:${item.courseId}:${item.id}`));
      for (const event of events.items) {
        if (event.relatedKind === 'assignment' && seen.has(`assignment:${event.courseId}:${event.relatedId}`))
          continue;
        if (event.relatedKind === 'quiz' && seen.has(`quiz:${event.courseId}:${event.relatedId}`)) continue;
        const course = courses.find((c) => c.id === event.courseId);
        if (!course) continue;
        push(
          course,
          'calendar',
          event.id,
          event.title,
          event.start,
          event.url,
          event.eventType === 'event' ? event.location || undefined : event.eventType,
        );
      }
    } catch (error) {
      errors.push({ courseId: '*', area: 'calendar', error: toSafeError(error) });
    }
  }
  items.sort((a, b) => timeOf(a.when)! - timeOf(b.when)!);
  return {
    from: new Date(now).toISOString(),
    to: new Date(end).toISOString(),
    courses: courses.map((course) => ({
      id: course.id,
      code: course.courseCode ?? course.code,
      name: course.name,
    })),
    items,
    recentAnnouncements: recent,
    withoutDate: undated,
    errors,
    complete: errors.length === 0,
    note: 'Dates come from Brightspace assignments, quizzes and calendar. Items without a published date are listed separately; check instructions for deadlines written in text. OSIRIS exams are in exam_overview and the class schedule in get_timetable.',
  };
}
