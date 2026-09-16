import { z } from 'zod';
import type { AppContext } from '../context.js';
import { startSync, syncStatus } from '../brightspace/sync.js';
import { getLibrary } from '../index/install.js';
import { DESTRUCTIVE, LOCAL, READ, type ToolRegistry } from './registry.js';
import { courseId } from './content.js';
import { courseRef } from './courses.js';

export function registerSearchTools(reg: ToolRegistry, _ctx: AppContext): void {
  reg.tool(
    'search_materials',
    {
      title: 'Search course materials',
      description:
        'Full-text search over everything read so far: lecture files, announcements, assignment instructions, submissions and feedback. Returns snippets and the tool call that re-reads the live source. Run sync_course first to index a whole course.',
      input: {
        query: z.string().trim().min(1).max(300),
        courseId: courseRef.optional(),
        kind: z
          .enum([
            'file',
            'announcement',
            'assignment',
            'topic',
            'module',
            'announcement_file',
            'assignment_file',
            'submission_file',
            'feedback_file',
            'locker_file',
          ])
          .optional(),
        limit: z.number().int().min(1).max(50).default(10),
      },
      annotations: LOCAL,
    },
    async (args, ctx) => {
      const library = await getLibrary(ctx);
      const id = args.courseId ? await courseId(ctx, args.courseId) : undefined;
      const hits = await library.search(args.query, { courseId: id, kind: args.kind, limit: args.limit });
      return {
        query: args.query,
        count: hits.length,
        hits,
        coverage: await library.coverage(id),
        note: 'Results come from the local index, which contains only material that was read or synced. Re-read the source for the full text.',
      };
    },
  );

  reg.tool(
    'sync_course',
    {
      title: 'Index a course',
      description:
        'Start a background job that downloads and indexes every readable file in a course (skipping files already indexed unless refresh is true). Poll get_sync_status with the returned jobId.',
      input: {
        courseId: courseRef,
        maxFiles: z.number().int().min(1).max(500).default(200),
        refresh: z.boolean().default(false),
      },
      annotations: LOCAL,
    },
    async (args, ctx) =>
      startSync(ctx, await courseId(ctx, args.courseId), { maxFiles: args.maxFiles, refresh: args.refresh }),
  );

  reg.tool(
    'get_sync_status',
    {
      title: 'Sync status',
      description: 'Progress of a background index job, or the recent jobs when jobId is omitted.',
      input: { jobId: z.string().uuid().optional() },
      annotations: READ,
    },
    (args) => syncStatus(args.jobId),
  );

  reg.tool(
    'index_status',
    {
      title: 'Index coverage',
      description: 'What the local search index contains, per course and kind.',
      input: { courseId: courseRef.optional() },
      annotations: READ,
    },
    async (args, ctx) => {
      const library = await getLibrary(ctx);
      return {
        documents: library.size,
        coverage: await library.coverage(args.courseId ? await courseId(ctx, args.courseId) : undefined),
        file: library.file,
      };
    },
  );

  reg.tool(
    'clear_index',
    {
      title: 'Clear index',
      description: 'Remove indexed text for one course or everything. Downloads and sessions stay.',
      input: { courseId: courseRef.optional() },
      annotations: DESTRUCTIVE,
    },
    async (args, ctx) => {
      const library = await getLibrary(ctx);
      return { removed: await library.clear(args.courseId ? await courseId(ctx, args.courseId) : undefined) };
    },
  );
}
