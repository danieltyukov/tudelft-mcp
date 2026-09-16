import { z } from 'zod';
import { connectTimetable, disconnectTimetable } from '../auth/timetable-auth.js';
import type { AppContext } from '../context.js';
import { TudelftError } from '../errors.js';
import { timetableService } from '../timetable/install.js';
import { MAX_WINDOW_DAYS } from '../timetable/service.js';
import { parseWhen } from '../util/dates.js';
import { DESTRUCTIVE, READ, WRITE, type ToolRegistry } from './registry.js';

export const COVERAGE_NOTE =
  'The list covers only activities present in the personal MyTimetable feed for this window. An empty result or a gap does not mean free time: exams, tutorials and rescheduled sessions may be published elsewhere or added later.';

export function resolveWindow(args: { from?: string; to?: string; days: number }): { from: Date; to: Date } {
  const from = args.from ? parseWhen(args.from, 'from') : new Date();
  const to = args.to ? parseWhen(args.to, 'to') : new Date(from.getTime() + args.days * 86_400_000);
  if (to <= from) throw new TudelftError('INVALID_ARGUMENT', 'The "to" date must be after "from".');
  return { from, to };
}

export function registerTimetableTools(reg: ToolRegistry, _ctx: AppContext): void {
  reg.tool(
    'get_timetable',
    {
      title: 'Personal timetable',
      description: `Lectures, labs, exams and other scheduled activities from the student's personal MyTimetable feed for a date window (default the next 7 days, at most ${MAX_WINDOW_DAYS} days). Times are UTC with an Amsterdam rendering; cancelled sessions are flagged, not hidden. ${COVERAGE_NOTE}`,
      input: {
        from: z.string().trim().optional().describe('ISO date or date-time, default now.'),
        to: z.string().trim().optional().describe('ISO date or date-time, default from + days.'),
        days: z
          .number()
          .int()
          .min(1)
          .max(MAX_WINDOW_DAYS)
          .default(7)
          .describe('Window length when "to" is absent.'),
      },
      annotations: READ,
    },
    async (args, ctx) => {
      const window = resolveWindow(args);
      const result = await timetableService(ctx).events(window.from.toISOString(), window.to.toISOString());
      return {
        from: result.from,
        to: result.to,
        count: result.items.length,
        complete: result.complete,
        truncated: result.truncated,
        items: result.items,
        warnings: result.warnings,
        coverage: COVERAGE_NOTE,
        source: `${ctx.config.timetableUrl}/`,
      };
    },
  );

  reg.tool(
    'timetable_status',
    {
      title: 'MyTimetable connection status',
      description:
        'Report whether a personal MyTimetable calendar link is stored locally and when it was connected. The link itself is never shown.',
      input: {},
      annotations: READ,
    },
    (_args, ctx) => timetableService(ctx).status(),
  );

  reg.tool(
    'connect_timetable',
    {
      title: 'Connect MyTimetable by link',
      description:
        'Store the personal calendar link copied from MyTimetable (mytimetable.tudelft.nl, menu "Connect calendar" or "Connect to calendar app"). The link is validated, fetched once, stored locally in the tudelft-mcp data directory and never shown or returned again. Use this when the automatic connection during sign-in did not work.',
      input: {
        icalUrl: z
          .string()
          .trim()
          .min(20)
          .max(2000)
          .describe('The https://mytimetable.tudelft.nl/ical?... link.'),
      },
      annotations: WRITE,
    },
    (args, ctx) => connectTimetable(ctx, args.icalUrl),
  );

  reg.tool(
    'disconnect_timetable',
    {
      title: 'Disconnect MyTimetable',
      description:
        'Remove the stored MyTimetable calendar link from this machine. The subscription itself stays valid in MyTimetable until the student regenerates it there.',
      input: {},
      annotations: DESTRUCTIVE,
    },
    (_args, ctx) => disconnectTimetable(ctx),
  );
}
