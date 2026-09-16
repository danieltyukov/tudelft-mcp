import { z } from 'zod';
import type { AppContext } from '../context.js';
import { listCourses } from '../brightspace/courses.js';
import { READ, type ToolRegistry } from './registry.js';

export const courseRef = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .describe('Course id from list_courses, or a course code such as EE4109.');

export function registerCourseTools(reg: ToolRegistry, _ctx: AppContext): void {
  reg.tool(
    'list_courses',
    {
      title: 'List courses',
      description:
        'List the Brightspace courses this account is enrolled in, with ids, codes, academic year, period and access dates. Defaults to active courses only. Organisation units (faculty pages) are hidden unless requested.',
      input: {
        query: z.string().trim().max(200).optional().describe('Filter by name or code.'),
        activeOnly: z.boolean().default(true),
        includeOrganisations: z.boolean().default(false),
      },
      annotations: READ,
    },
    async (args, ctx) => {
      const result = await listCourses(ctx.brightspace, args);
      return {
        count: result.items.length,
        complete: result.complete,
        items: result.items,
        source: `${ctx.config.brightspaceUrl}/d2l/home`,
      };
    },
  );
}
