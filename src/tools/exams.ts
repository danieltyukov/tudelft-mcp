import { z } from 'zod';
import type { AppContext } from '../context.js';
import { toSafeError, type SafeError } from '../errors.js';
import { osirisClient } from '../osiris/install.js';
import { allRegistrations, availableCourses, type Summary } from '../osiris/records.js';
import type { CalendarItem } from '../timetable/ical.js';
import { timetableService } from '../timetable/install.js';
import { MAX_WINDOW_DAYS } from '../timetable/service.js';
import { READ, type ToolRegistry } from './registry.js';
import { COVERAGE_NOTE, resolveWindow } from './timetable.js';

const EXAM_WORDS = /exam|tentamen|toets/i;

interface Section<T> {
  items: T[];
  complete: boolean;
  error?: SafeError;
}

async function section<T>(task: () => Promise<{ items: T[]; complete: boolean }>): Promise<Section<T>> {
  try {
    return await task();
  } catch (error) {
    return { items: [], complete: false, error: toSafeError(error) };
  }
}

export interface Overlap {
  first: { id: string; title: string; start: string; end: string };
  second: { id: string; title: string; start: string; end: string };
  overlapMinutes: number;
}

/** Pairwise overlaps between timed (not all-day, not cancelled) events. */
export function findOverlaps(items: CalendarItem[], max = 100): Overlap[] {
  const timed = items
    .filter((item) => !item.allDay && !item.cancelled)
    .sort((a, b) => a.start.localeCompare(b.start));
  const overlaps: Overlap[] = [];
  for (let i = 0; i < timed.length && overlaps.length < max; i++) {
    const a = timed[i]!;
    const aEnd = Date.parse(a.end);
    for (let j = i + 1; j < timed.length && overlaps.length < max; j++) {
      const b = timed[j]!;
      const bStart = Date.parse(b.start);
      if (bStart >= aEnd) break;
      const minutes = Math.round((Math.min(aEnd, Date.parse(b.end)) - bStart) / 60_000);
      if (minutes <= 0) continue;
      overlaps.push({
        first: { id: a.id, title: a.title, start: a.start, end: a.end },
        second: { id: b.id, title: b.title, start: b.start, end: b.end },
        overlapMinutes: minutes,
      });
    }
  }
  return overlaps;
}

function inWindow(row: Summary, from: Date, to: Date): boolean {
  const date = row.assessmentDate ? Date.parse(row.assessmentDate) : NaN;
  if (!Number.isFinite(date)) return true;
  return date >= from.getTime() - 86_400_000 && date <= to.getTime() + 86_400_000;
}

export function registerExamTools(reg: ToolRegistry, _ctx: AppContext): void {
  reg.tool(
    'exam_overview',
    {
      title: 'Exam overview',
      description: `Combine three sources for a date window (default the next 60 days): exam registrations in OSIRIS, courses currently open for exam registration in OSIRIS, and exam-like activities in the MyTimetable feed, plus pairwise clashes between timed timetable events. Each section reports its own completeness and error so one unavailable source does not hide the others. OSIRIS rows are official records; timetable rows are schedule entries. ${COVERAGE_NOTE}`,
      input: {
        from: z.string().trim().optional().describe('ISO date, default today.'),
        to: z.string().trim().optional().describe('ISO date, default from + days.'),
        days: z.number().int().min(1).max(MAX_WINDOW_DAYS).default(60),
      },
      annotations: READ,
    },
    async (args, ctx) => {
      const window = resolveWindow(args);
      const [registrations, openForRegistration, timetable] = await Promise.all([
        section(async () => {
          const result = await allRegistrations(osirisClient(ctx), 'exam');
          return {
            items: result.items.filter((row) => inWindow(row, window.from, window.to)),
            complete: result.complete,
          };
        }),
        section(async () => {
          const result = await availableCourses(osirisClient(ctx), 'exam', { offset: 0, limit: 100 });
          return { items: result.items, complete: result.complete };
        }),
        section(async () => {
          const result = await timetableService(ctx).events(
            window.from.toISOString(),
            window.to.toISOString(),
          );
          return { items: result.items, complete: result.complete };
        }),
      ]);
      const examEvents = timetable.items.filter(
        (item) => EXAM_WORDS.test(item.activityType ?? '') || EXAM_WORDS.test(item.title),
      );
      const summaries = (rows: Summary[]): Omit<Summary, 'data'>[] =>
        rows.map(({ data: _data, ...rest }) => rest);
      return {
        from: window.from.toISOString(),
        to: window.to.toISOString(),
        osirisExamRegistrations: {
          items: summaries(registrations.items),
          complete: registrations.complete,
          error: registrations.error,
        },
        osirisOpenForExamRegistration: {
          items: summaries(openForRegistration.items),
          complete: openForRegistration.complete,
          error: openForRegistration.error,
        },
        timetableExams: {
          items: examEvents,
          complete: timetable.complete,
          error: timetable.error,
        },
        clashes: findOverlaps(timetable.items),
        coverage: COVERAGE_NOTE,
      };
    },
  );
}
