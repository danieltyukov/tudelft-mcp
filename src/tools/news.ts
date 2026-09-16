import { z } from 'zod';
import type { AppContext } from '../context.js';
import { announcements, readAnnouncementAttachment } from '../brightspace/news.js';
import { selectCourses } from '../brightspace/planning.js';
import { toSafeError } from '../errors.js';
import { parseWhen } from '../util/dates.js';
import { LOCAL, READ, type ToolRegistry } from './registry.js';
import { chunkArgs, courseId, numericIdArg } from './content.js';
import { courseRef } from './courses.js';

export function registerNewsTools(reg: ToolRegistry, _ctx: AppContext): void {
  reg.tool(
    'get_announcements',
    {
      title: 'Announcements',
      description:
        'Course announcements with text, links and attachment ids, newest first. Give a courseId for one course, or omit it to read recent announcements across all active courses.',
      input: {
        courseId: courseRef.optional(),
        since: z.string().optional().describe('ISO date; only announcements published or edited after it.'),
        limit: z.number().int().min(1).max(100).default(20).describe('Per course.'),
      },
      annotations: READ,
    },
    async (args, ctx) => {
      const since = args.since ? parseWhen(args.since, 'since') : undefined;
      if (args.courseId) {
        const id = await courseId(ctx, args.courseId);
        const result = await announcements(ctx, id, { since, limit: args.limit });
        return { courseId: id, count: result.items.length, items: result.items, complete: result.complete };
      }
      const courses = await selectCourses(ctx);
      const results = await Promise.allSettled(
        courses.map((course) =>
          announcements(ctx, course.id, {
            since: since ?? new Date(Date.now() - 14 * 86_400_000),
            limit: args.limit,
          }),
        ),
      );
      const items = results.flatMap((result, index) =>
        result.status === 'fulfilled'
          ? result.value.items.map((item) => ({
              ...item,
              courseCode: courses[index]!.courseCode ?? courses[index]!.code,
              courseName: courses[index]!.name,
            }))
          : [],
      );
      items.sort((a, b) => (b.publishedAt ?? '').localeCompare(a.publishedAt ?? ''));
      const errors = results.flatMap((result, index) =>
        result.status === 'rejected'
          ? [{ courseId: courses[index]!.id, error: toSafeError(result.reason) }]
          : [],
      );
      return {
        since: (since ?? new Date(Date.now() - 14 * 86_400_000)).toISOString(),
        count: items.length,
        items,
        errors,
        complete: errors.length === 0,
      };
    },
  );

  reg.tool(
    'read_announcement_attachment',
    {
      title: 'Read announcement attachment',
      description:
        'Extract text from (or download) a file attached to an announcement. Ids come from get_announcements.',
      input: {
        courseId: courseRef,
        announcementId: numericIdArg('Announcement id'),
        fileId: numericIdArg('File id'),
        download: z.boolean().default(false),
        ...chunkArgs,
      },
      annotations: LOCAL,
    },
    async (args, ctx) =>
      readAnnouncementAttachment(
        ctx,
        await courseId(ctx, args.courseId),
        args.announcementId,
        args.fileId,
        args,
      ),
  );
}
