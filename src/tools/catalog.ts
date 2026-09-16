import { z } from 'zod';
import type { AppContext } from '../context.js';
import { confirmEnrollment, prepareEnrollment, searchCatalog } from '../brightspace/catalog.js';
import { READ, WRITE, type ToolRegistry } from './registry.js';
import { numericIdArg } from './content.js';
import { confirmArgs } from './assignments.js';

export function registerCatalogTools(reg: ToolRegistry, _ctx: AppContext): void {
  reg.tool(
    'search_catalog',
    {
      title: 'Search the course catalogue',
      description:
        'Search the Brightspace Discover catalogue (courses you can self-enrol in for Brightspace access) by name or code. Uses the signed-in headless browser. Discover enrolment is not an OSIRIS course registration.',
      input: { query: z.string().trim().min(1).max(200) },
      annotations: READ,
    },
    async (args, ctx) => {
      const result = await searchCatalog(ctx, args.query);
      return {
        ...result,
        count: result.items.length,
        note: 'Use prepare_course_enrollment with a courseId to preview joining a course.',
      };
    },
  );

  reg.tool(
    'prepare_course_enrollment',
    {
      title: 'Preview Brightspace enrolment',
      description:
        'Read a Discover course page (title, code, semester, description) and return a one-use preview token if self-enrolment is offered. Nothing is changed.',
      input: { courseId: numericIdArg('Discover course id from search_catalog') },
      annotations: READ,
    },
    async (args, ctx) => prepareEnrollment(ctx, args.courseId),
  );

  reg.tool(
    'confirm_course_enrollment',
    {
      title: 'Enrol (after approval)',
      description:
        'Enrol in the previewed Discover course exactly once after the student explicitly approved it, then verify membership through the API.',
      input: confirmArgs,
      annotations: WRITE,
    },
    async (args, ctx) => confirmEnrollment(ctx, args.confirmationToken, args.confirmed),
  );
}
