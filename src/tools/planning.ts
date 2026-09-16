import { z } from 'zod';
import type { AppContext } from '../context.js';
import { calendarEvents, windowFrom } from '../brightspace/calendar.js';
import { whatsNew } from '../brightspace/changes.js';
import { selectCourses, upcoming } from '../brightspace/planning.js';
import { checklists, quizzes } from '../brightspace/quizzes.js';
import { LOCAL, READ, type ToolRegistry } from './registry.js';
import { courseId } from './content.js';
import { courseRef } from './courses.js';

const courseIds = z
  .array(z.string().trim().min(1))
  .max(40)
  .optional()
  .describe('Course ids or codes. Omit for all active courses.');

export function registerPlanningTools(reg: ToolRegistry, _ctx: AppContext): void {
  reg.tool(
    'get_upcoming',
    {
      title: 'What is due',
      description:
        'Everything with a date in the coming days across your courses: assignment due dates, quizzes, calendar events and closing times, sorted by time, plus recent announcements and items without a published date. Start here for "what do I need to do this week".',
      input: {
        courseIds,
        days: z.number().int().min(1).max(180).default(14),
        includeAnnouncements: z.boolean().default(true),
        includeCalendar: z.boolean().default(true),
      },
      annotations: READ,
    },
    async (args, ctx) => upcoming(ctx, args),
  );

  reg.tool(
    'get_calendar',
    {
      title: 'Brightspace calendar',
      description:
        'Calendar events (with recurring occurrences expanded) for courses in a date window of at most 366 days. Due-date events carry the related assignment or quiz id.',
      input: {
        courseIds,
        from: z.string().optional().describe('ISO date, default now.'),
        to: z.string().optional(),
        days: z.number().int().min(1).max(366).default(14),
      },
      annotations: READ,
    },
    async (args, ctx) => {
      const courses = await selectCourses(ctx, args.courseIds);
      const { from, to } = windowFrom(args);
      const result = await calendarEvents(
        ctx,
        courses.map((course) => course.id),
        from,
        to,
      );
      return {
        from: from.toISOString(),
        to: to.toISOString(),
        count: result.items.length,
        items: result.items,
        complete: result.complete,
      };
    },
  );

  reg.tool(
    'list_quizzes',
    {
      title: 'Quizzes',
      description:
        'Quiz metadata for a course: dates, attempts allowed, time limit, instructions. No attempt is started.',
      input: { courseId: courseRef },
      annotations: READ,
    },
    async (args, ctx) => {
      const id = await courseId(ctx, args.courseId);
      const result = await quizzes(ctx, id);
      return { courseId: id, count: result.items.length, items: result.items, complete: result.complete };
    },
  );

  reg.tool(
    'get_checklists',
    {
      title: 'Checklists',
      description:
        'Course checklists with categories, items, due dates and completion state where Brightspace reports it.',
      input: { courseId: courseRef },
      annotations: READ,
    },
    async (args, ctx) => {
      const id = await courseId(ctx, args.courseId);
      return { courseId: id, items: await checklists(ctx, id) };
    },
  );

  reg.tool(
    'whats_new',
    {
      title: 'What changed',
      description:
        'Compare your courses with the last time this was called and report new announcements, new or updated content, new assignments, changed due dates and newly released grades. The first call for a course records a baseline and reports nothing new.',
      input: {
        courseIds,
        peek: z.boolean().default(false).describe('Compare without advancing the saved snapshot.'),
      },
      annotations: LOCAL,
    },
    async (args, ctx) => whatsNew(ctx, args),
  );
}
