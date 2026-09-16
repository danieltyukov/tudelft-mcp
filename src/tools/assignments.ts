import { z } from 'zod';
import type { AppContext } from '../context.js';
import {
  assignment,
  assignments,
  readAssignmentAttachment,
  readFeedbackFile,
  readMySubmissionFile,
} from '../brightspace/assignments.js';
import { confirmSubmission, prepareSubmission } from '../brightspace/submissions.js';
import { LOCAL, READ, WRITE, type ToolRegistry } from './registry.js';
import { chunkArgs, courseId, numericIdArg } from './content.js';
import { courseRef } from './courses.js';

export const confirmArgs = {
  confirmationToken: z.string().min(16).max(200),
  confirmed: z.literal(true).describe('Must be true. Confirms the student approved the exact preview.'),
};

export function registerAssignmentTools(reg: ToolRegistry, _ctx: AppContext): void {
  reg.tool(
    'list_assignments',
    {
      title: 'Assignments',
      description:
        'Assignments (dropbox folders) of a course with instructions, due dates, availability, submission type, group flag, attachments and whether something was submitted.',
      input: { courseId: courseRef },
      annotations: READ,
    },
    async (args, ctx) => {
      const id = await courseId(ctx, args.courseId);
      const result = await assignments(ctx, id);
      return {
        courseId: id,
        count: result.items.length,
        items: result.items,
        complete: result.complete,
        note: 'Due dates and closing times are separate. Instructions may contain other deadlines.',
      };
    },
  );

  reg.tool(
    'get_assignment',
    {
      title: 'Assignment details',
      description:
        'One assignment with full instructions, your submission history (files, comments, dates) and published feedback (score, text, rubric, feedback files).',
      input: { courseId: courseRef, assignmentId: numericIdArg('Assignment id') },
      annotations: READ,
    },
    async (args, ctx) => assignment(ctx, await courseId(ctx, args.courseId), args.assignmentId),
  );

  reg.tool(
    'read_assignment_attachment',
    {
      title: 'Read assignment attachment',
      description: 'Extract text from (or download) a file attached to the assignment instructions.',
      input: {
        courseId: courseRef,
        assignmentId: numericIdArg('Assignment id'),
        fileId: numericIdArg('File id'),
        download: z.boolean().default(false),
        ...chunkArgs,
      },
      annotations: LOCAL,
    },
    async (args, ctx) =>
      readAssignmentAttachment(ctx, await courseId(ctx, args.courseId), args.assignmentId, args.fileId, args),
  );

  reg.tool(
    'read_my_submission_file',
    {
      title: 'Read my submitted file',
      description:
        'Extract text from (or download) a file you submitted earlier. Ids come from get_assignment.',
      input: {
        courseId: courseRef,
        assignmentId: numericIdArg('Assignment id'),
        submissionId: numericIdArg('Submission id'),
        fileId: numericIdArg('File id'),
        download: z.boolean().default(false),
        ...chunkArgs,
      },
      annotations: LOCAL,
    },
    async (args, ctx) =>
      readMySubmissionFile(
        ctx,
        await courseId(ctx, args.courseId),
        args.assignmentId,
        args.submissionId,
        args.fileId,
        args,
      ),
  );

  reg.tool(
    'read_feedback_file',
    {
      title: 'Read feedback file',
      description: 'Extract text from (or download) a feedback file the grader attached to your submission.',
      input: {
        courseId: courseRef,
        assignmentId: numericIdArg('Assignment id'),
        fileId: numericIdArg('File id'),
        download: z.boolean().default(false),
        ...chunkArgs,
      },
      annotations: LOCAL,
    },
    async (args, ctx) =>
      readFeedbackFile(ctx, await courseId(ctx, args.courseId), args.assignmentId, args.fileId, args),
  );

  reg.tool(
    'prepare_submission',
    {
      title: 'Preview a submission',
      description:
        'Prepare a file or text submission to an assignment: checks the assignment accepts it, hashes the local files, and returns an exact preview plus a one-use token. Nothing is uploaded. Show the preview to the student before confirm_submission.',
      input: {
        courseId: courseRef,
        assignmentId: numericIdArg('Assignment id'),
        files: z
          .array(z.string().min(1).max(4000))
          .max(10)
          .optional()
          .describe('Absolute or relative paths of local files.'),
        text: z.string().max(262_144).optional().describe('Literal text for text assignments.'),
        comment: z.string().max(20_000).optional(),
      },
      annotations: READ,
    },
    async (args, ctx) => prepareSubmission(ctx, { ...args, courseId: await courseId(ctx, args.courseId) }),
  );

  reg.tool(
    'confirm_submission',
    {
      title: 'Submit (after approval)',
      description:
        'Upload the previewed submission exactly once, then verify it appears in the submission history. Only call after the student explicitly approved the preview. Never retry if the outcome is unknown.',
      input: confirmArgs,
      annotations: WRITE,
    },
    async (args, ctx) => confirmSubmission(ctx, args.confirmationToken, args.confirmed),
  );
}
