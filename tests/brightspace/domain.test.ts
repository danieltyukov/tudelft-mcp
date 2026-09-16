import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { assignment, assignments, parseMySubmissions } from '../../src/brightspace/assignments.js';
import { calendarEvents, parseCalendar } from '../../src/brightspace/calendar.js';
import { whatsNew } from '../../src/brightspace/changes.js';
import { courseContent, flattenToc, readMaterial } from '../../src/brightspace/content.js';
import { courseGrades, summarise, parseGradeItem, parseGradeValue } from '../../src/brightspace/grades.js';
import { announcements, readAnnouncementAttachment } from '../../src/brightspace/news.js';
import { upcoming } from '../../src/brightspace/planning.js';
import { listRecordings } from '../../src/brightspace/recordings.js';
import { confirmSubmission, prepareSubmission } from '../../src/brightspace/submissions.js';
import { getLibrary } from '../../src/index/install.js';
import { binary, json, mockApi, signedInContext } from '../helpers.js';

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`../fixtures/brightspace/${name}.json`, import.meta.url), 'utf8'));
const ORIGIN = 'https://brightspace.tudelft.nl';

afterEach(() => vi.restoreAllMocks());

describe('content', () => {
  it('flattens the TOC, classifies topics and skips hidden ones', () => {
    const result = flattenToc(fixture('toc'), '774356', ORIGIN);
    expect(result.modules.map((m) => m.path.join('/'))).toEqual(['Week 1', 'Week 1/Extra']);
    expect(result.topics.map((t) => t.id)).toEqual(['1001', '1002', '1003', '1004', '1010']);
    const slides = result.topics[0]!;
    expect(slides).toMatchObject({
      type: 'file',
      filename: 'lecture1.pdf',
      extension: '.pdf',
      extractable: true,
      module: 'Week 1',
    });
    expect(result.topics[1]).toMatchObject({ type: 'file', extractable: false });
    expect(result.topics[2]).toMatchObject({ type: 'link', external: true });
    expect(result.topics[3]).toMatchObject({ type: 'activity' });
    expect(result.modules[0]?.description).toBe('Intro week. See site');
  });
  it('indexes descriptions when reading content', async () => {
    const ctx = await signedInContext();
    mockApi({ '/content/toc': fixture('toc') });
    await courseContent(ctx, '774356');
    const library = await getLibrary(ctx);
    expect((await library.search('intro week')).length).toBe(1);
  });
  it('reads a file topic, extracts and indexes it', async () => {
    const ctx = await signedInContext();
    mockApi({
      '/content/topics/1001/file': (url: URL) =>
        url.pathname.endsWith('/file')
          ? binary('Lecture one: Ohm law V = I R', 'text/plain', 'lecture1.txt')
          : undefined,
      '/content/topics/1001': {
        Id: 1001,
        Title: 'Lecture 1 slides',
        TopicType: 1,
        Url: '/content/enforced/774356/lecture1.txt',
        Description: { Text: '', Html: '' },
      },
    });
    const result = await readMaterial(ctx, '774356', '1001', { maxChars: 12 });
    expect(result).toMatchObject({
      kind: 'file',
      filename: 'lecture1.txt',
      format: 'txt',
      text: 'Lecture one:',
      nextOffset: 12,
      indexed: true,
    });
    const hits = await (await getLibrary(ctx)).search('ohm law');
    expect(hits[0]?.readWith?.arguments).toEqual({ courseId: '774356', topicId: '1001' });
  });
  it('describes link topics without downloading', async () => {
    const ctx = await signedInContext();
    mockApi({
      '/content/topics/1003': {
        Id: 1003,
        Title: 'Collegerama',
        TopicType: 3,
        Url: 'https://collegeramavideoportal.tudelft.nl/x?token=1',
        Description: { Text: '', Html: '' },
      },
    });
    const result = await readMaterial(ctx, '774356', '1003');
    expect(result.kind).toBe('external_link');
    expect(result.resourceUrl).toBe('https://collegeramavideoportal.tudelft.nl/x');
  });
  it('finds recording links', async () => {
    const ctx = await signedInContext();
    mockApi({ '/content/toc': fixture('toc') });
    const result = await listRecordings(ctx, '774356');
    expect(result.items.map((r) => r.provider).sort()).toEqual(['Brightspace media', 'Collegerama']);
  });
});

describe('announcements', () => {
  it('parses, filters unpublished, sorts newest first and indexes', async () => {
    const ctx = await signedInContext();
    mockApi({ '/news/': fixture('news') });
    const result = await announcements(ctx, '774356');
    expect(result.items.map((a) => a.id)).toEqual(['5002', '5001']);
    expect(result.items[1]).toMatchObject({
      pinned: true,
      attachments: [{ fileId: '77', fileName: 'schedule.txt', size: 1234 }],
      publishedLocal: 'Tue 1 Sep 2026 10:00',
    });
    expect(result.items[1]?.links[0]?.url).toBe(`${ORIGIN}/d2l/le/content/774356/Home`);
    const since = await announcements(ctx, '774356', { since: new Date('2026-09-05T00:00:00Z') });
    expect(since.items.map((a) => a.id)).toEqual(['5002']);
  });
  it('reads an attachment only when it belongs to the announcement', async () => {
    const ctx = await signedInContext();
    mockApi({
      '/news/5001/attachments/77': binary('Week 1 Monday', 'text/plain'),
      '/news/5001': (fixture('news') as unknown[])[0],
    });
    const result = await readAnnouncementAttachment(ctx, '774356', '5001', '77', {});
    expect(result.text).toBe('Week 1 Monday');
    await expect(readAnnouncementAttachment(ctx, '774356', '5001', '78', {})).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});

describe('assignments', () => {
  it('parses folders with types, dates and group flag', async () => {
    const ctx = await signedInContext();
    mockApi({ '/dropbox/folders/': fixture('dropbox') });
    const result = await assignments(ctx, '774356');
    expect(result.items.map((a) => a.id)).toEqual(['3001', '3002']);
    expect(result.items[0]).toMatchObject({
      submissionType: 'file',
      groupAssignment: false,
      maxScore: 10,
      dueLocal: 'Thu 1 Oct 2026 23:59',
      closesAt: '2026-10-10T21:59:00.000Z',
      submitted: false,
    });
    expect(result.items[1]).toMatchObject({
      submissionType: 'text',
      groupAssignment: true,
      dueDate: null,
      submitted: true,
    });
  });
  it('merges submission history and feedback', async () => {
    const ctx = await signedInContext();
    mockApi({
      '/submissions/mysubmissions/': fixture('mysubmissions'),
      '/dropbox/folders/3001': (fixture('dropbox') as unknown[])[0],
    });
    const result = await assignment(ctx, '774356', '3001');
    expect(result.submissionCount).toBe(1);
    expect((result.feedback as { score: number }).score).toBe(8.5);
    const history = parseMySubmissions(fixture('mysubmissions'));
    expect(history[0]?.submissions[0]?.files[0]?.fileName).toBe('report.pdf');
  });
});

describe('grades', () => {
  it('summarises released values', () => {
    const data = fixture('grades') as { items: unknown[]; values: unknown[] };
    const items = data.items.map(parseGradeItem).filter(Boolean) as ReturnType<typeof parseGradeItem>[];
    const values = data.values.map(parseGradeValue).filter(Boolean) as ReturnType<typeof parseGradeValue>[];
    const summary = summarise(items as never, values as never);
    expect(summary).toMatchObject({
      gradedItems: 1,
      totalItems: 2,
      pointsEarned: 7.5,
      simpleAverage: 75,
      weightedAverage: 75,
    });
  });
  it('reads the gradebook including the final grade', async () => {
    const ctx = await signedInContext();
    const data = fixture('grades') as { items: unknown[]; values: unknown[]; final: unknown };
    mockApi({
      '/grades/final/values/myGradeValue': data.final,
      '/grades/values/myGradeValues/': data.values,
      '/grades/': data.items,
    });
    const result = await courseGrades(ctx, '774356');
    expect((result.finalGrade as { displayed: string }).displayed).toBe('7.5');
    expect((result.values as { weight: number }[])[0]?.weight).toBe(40);
    expect((result.ungradedItems as { id: string }[]).map((i) => i.id)).toEqual(['202']);
  });
});

describe('calendar and planning', () => {
  it('expands occurrences and maps event types', () => {
    const events = parseCalendar(fixture('calendar'), ORIGIN);
    expect(events.map((e) => e.title)).toEqual(['Lab session', 'Lab session', 'Report 1 - Due']);
    expect(events[2]).toMatchObject({ eventType: 'due', relatedKind: 'assignment', relatedId: '3001' });
    expect(events[0]?.startLocal).toBe('Mon 21 Sep 2026 13:45');
  });
  it('requires millisecond ISO timestamps and batches courses', async () => {
    const ctx = await signedInContext();
    const calls = mockApi({ '/calendar/events/myEventsWithOccurrences/': fixture('calendar') });
    const result = await calendarEvents(
      ctx,
      ['774356'],
      new Date('2026-09-01T00:00:00Z'),
      new Date('2026-12-01T00:00:00Z'),
    );
    expect(result.items.length).toBe(3);
    expect(calls.find((c) => c.includes('myEventsWithOccurrences'))).toContain(
      'startDateTime=2026-09-01T00%3A00%3A00.000Z',
    );
  });
  it('builds an upcoming overview across active courses', async () => {
    vi.useFakeTimers({ now: new Date('2026-09-16T12:00:00Z'), toFake: ['Date'] });
    const ctx = await signedInContext();
    const data = fixture('grades') as { items: unknown[] };
    mockApi({
      '/enrollments/myenrollments/': fixture('enrollments'),
      '/dropbox/folders/': fixture('dropbox'),
      '/quizzes/': {
        Objects: [
          {
            QuizId: 5,
            Name: 'Quiz 1',
            IsActive: true,
            DueDate: '2026-09-25T21:59:00.000Z',
            AttemptsAllowed: { IsUnlimited: false, NumberOfAttemptsAllowed: 2 },
          },
        ],
        Next: null,
      },
      '/news/': fixture('news'),
      '/calendar/events/myEventsWithOccurrences/': fixture('calendar'),
      '/grades/': data.items,
    });
    const result = await upcoming(ctx, { days: 30 });
    expect(result.courses.map((c) => c.id)).toEqual(['774356']);
    expect(result.items.map((i) => `${i.kind}:${i.title}`)).toEqual([
      'calendar:Lab session',
      'quiz:Quiz 1',
      'calendar:Lab session',
      'assignment:Report 1',
    ]);
    expect(result.withoutDate.map((i) => i.title)).toEqual(['Reflection']);
    expect(result.recentAnnouncements.length).toBe(1);
    vi.useRealTimers();
  });
});

describe('whats_new', () => {
  it('records a baseline first, then reports changes', async () => {
    const ctx = await signedInContext();
    const news = fixture('news') as Record<string, unknown>[];
    const grades = fixture('grades') as { items: unknown[]; values: unknown[] };
    let newsBody = news.slice(1);
    let values = grades.values;
    mockApi({
      '/enrollments/myenrollments/': fixture('enrollments'),
      '/news/': () => json(newsBody),
      '/content/toc': fixture('toc'),
      '/dropbox/folders/': fixture('dropbox'),
      '/grades/final/values/myGradeValue': () => new Response('', { status: 404 }),
      '/grades/values/myGradeValues/': () => json(values),
      '/grades/': grades.items,
    });
    const first = await whatsNew(ctx);
    expect(first.courses[0]?.firstCheck).toBe(true);
    expect(first.summary.coursesWithChanges).toBe(0);
    newsBody = news;
    values = [
      ...grades.values,
      {
        GradeObjectIdentifier: '202',
        GradeObjectName: 'Final',
        GradeObjectTypeName: 'Numeric',
        DisplayedGrade: '9',
        PointsNumerator: 9,
        PointsDenominator: 10,
      },
    ];
    const second = await whatsNew(ctx, { peek: true });
    expect(second.summary).toMatchObject({ newAnnouncements: 1, newGrades: 1, newAssignments: 0 });
    expect(second.courses[0]?.newAnnouncements[0]).toMatchObject({ id: '5001', title: 'Welcome' });
    const third = await whatsNew(ctx, { peek: true });
    expect(third.summary.newAnnouncements).toBe(1);
  });
});

describe('submissions', () => {
  it('previews files with hashes and refuses closed or wrong-type assignments', async () => {
    const ctx = await signedInContext();
    const { writeFile, mkdtemp } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = await mkdtemp(join(tmpdir(), 'sub-'));
    const file = join(dir, 'report.pdf');
    await writeFile(file, 'pdf bytes');
    const folders = fixture('dropbox') as Record<string, unknown>[];
    mockApi({
      '/submissions/mysubmissions/': [],
      '/dropbox/folders/3001': folders[0],
      '/dropbox/folders/3002': folders[1],
    });
    const preview = await prepareSubmission(ctx, {
      courseId: '774356',
      assignmentId: '3001',
      files: [file],
      comment: 'v1',
    });
    expect(preview.preview.files[0]).toMatchObject({ name: 'report.pdf', size: 9 });
    expect(preview.preview.files[0]?.sha256).toHaveLength(64);
    expect(preview.status).toBe('preview_only');
    await expect(
      prepareSubmission(ctx, { courseId: '774356', assignmentId: '3002', files: [file] }),
    ).rejects.toMatchObject({ code: 'NOT_ALLOWED' });
    await expect(
      prepareSubmission(ctx, { courseId: '774356', assignmentId: '3001', files: [join(dir, 'missing.pdf')] }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
  it('uploads once and verifies the new submission', async () => {
    const ctx = await signedInContext();
    const { writeFile, mkdtemp } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = await mkdtemp(join(tmpdir(), 'sub-'));
    const file = join(dir, 'report.pdf');
    await writeFile(file, 'pdf bytes');
    const folders = fixture('dropbox') as Record<string, unknown>[];
    let uploads = 0;
    let history: unknown[] = [];
    mockApi({
      '/submissions/mysubmissions/': (_url: URL, init?: RequestInit) => {
        if (init?.method === 'POST') {
          uploads++;
          expect(String(new Headers(init.headers).get('content-type'))).toMatch(
            /^multipart\/mixed; boundary=/,
          );
          history = fixture('mysubmissions') as unknown[];
          return json({});
        }
        return json(history);
      },
      '/dropbox/folders/3001': folders[0],
    });
    const preview = await prepareSubmission(ctx, { courseId: '774356', assignmentId: '3001', files: [file] });
    await expect(confirmSubmission(ctx, preview.confirmationToken, false as never)).rejects.toMatchObject({
      code: 'CONFIRMATION_REQUIRED',
    });
    const again = await prepareSubmission(ctx, { courseId: '774356', assignmentId: '3001', files: [file] });
    const result = await confirmSubmission(ctx, again.confirmationToken, true);
    expect(result.status).toBe('submitted');
    expect(uploads).toBe(1);
    await expect(confirmSubmission(ctx, again.confirmationToken, true)).rejects.toMatchObject({
      code: 'PREVIEW_EXPIRED',
    });
  });
});
