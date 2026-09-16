import { z } from 'zod';
import type { AppContext } from '../context.js';
import { courseContent, readMaterial } from '../brightspace/content.js';
import { resolveCourse } from '../brightspace/courses.js';
import { listRecordings } from '../brightspace/recordings.js';
import { readPage } from '../brightspace/page.js';
import { LOCAL, READ, type ToolRegistry } from './registry.js';
import { courseRef } from './courses.js';

export const chunkArgs = {
  offset: z.number().int().min(0).default(0).describe('Character offset for long documents.'),
  maxChars: z.number().int().min(1).max(100_000).default(20_000),
};
export const numericIdArg = (label: string) =>
  z
    .string()
    .regex(/^\d{1,18}$/)
    .describe(`${label} from another tool.`);

export async function courseId(ctx: AppContext, ref: string): Promise<string> {
  return /^\d+$/.test(ref) ? ref : (await resolveCourse(ctx.brightspace, ref)).id;
}

export function registerContentTools(reg: ToolRegistry, _ctx: AppContext): void {
  reg.tool(
    'get_course_content',
    {
      title: 'Course content tree',
      description:
        'The full content outline of a course: modules and topics with ids, types (file, link, activity), file names, dates and whether text extraction is possible. Use topic ids with read_material.',
      input: {
        courseId: courseRef,
        module: z
          .string()
          .trim()
          .max(200)
          .optional()
          .describe('Only topics whose module path contains this text.'),
      },
      annotations: READ,
    },
    async (args, ctx) => {
      const id = await courseId(ctx, args.courseId);
      const result = await courseContent(ctx, id);
      const filter = args.module?.toLowerCase();
      const topics = filter
        ? result.topics.filter((topic) => topic.module.toLowerCase().includes(filter))
        : result.topics;
      return {
        courseId: id,
        moduleCount: result.modules.length,
        topicCount: topics.length,
        modules: result.modules,
        topics,
        url: `${ctx.config.brightspaceUrl}/d2l/le/content/${id}/Home`,
      };
    },
  );

  reg.tool(
    'read_material',
    {
      title: 'Read course material',
      description:
        'Download a content topic (PDF, DOCX, PPTX with speaker notes, XLSX, CSV, notebook, HTML, text, captions) and return its text in chunks, indexing it for search_materials. Links and activities return their description and target instead.',
      input: { courseId: courseRef, topicId: numericIdArg('Topic id'), ...chunkArgs },
      annotations: LOCAL,
    },
    async (args, ctx) =>
      readMaterial(ctx, await courseId(ctx, args.courseId), args.topicId, {
        offset: args.offset,
        maxChars: args.maxChars,
      }),
  );

  reg.tool(
    'download_material',
    {
      title: 'Download course material',
      description:
        'Save a content topic file under ~/.tudelft-mcp/downloads and return the local path plus extracted text.',
      input: { courseId: courseRef, topicId: numericIdArg('Topic id'), ...chunkArgs },
      annotations: LOCAL,
    },
    async (args, ctx) =>
      readMaterial(ctx, await courseId(ctx, args.courseId), args.topicId, {
        offset: args.offset,
        maxChars: args.maxChars,
        download: true,
      }),
  );

  reg.tool(
    'list_recordings',
    {
      title: 'Find lecture recordings',
      description:
        'Find lecture recording links (Collegerama, YouTube, Panopto, SharePoint, native video) and caption files referenced in the course content. Returns links only; nothing is played or transcribed.',
      input: { courseId: courseRef },
      annotations: READ,
    },
    async (args, ctx) => ({
      courseId: await courseId(ctx, args.courseId),
      ...(await listRecordings(ctx, await courseId(ctx, args.courseId))),
    }),
  );

  reg.tool(
    'read_page',
    {
      title: 'Read a Brightspace page',
      description:
        'Load a brightspace.tudelft.nl page in the signed-in headless browser and return its visible text and links. For content the API does not expose. Action URLs are refused.',
      input: { url: z.string().url(), maxChars: z.number().int().min(100).max(100_000).default(30_000) },
      annotations: READ,
    },
    async (args, ctx) => readPage(ctx, args.url, args.maxChars),
  );
}
