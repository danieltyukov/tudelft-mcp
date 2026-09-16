import type { AppContext } from '../context.js';
import { TudelftError } from '../errors.js';
import { getLibrary } from '../index/install.js';
import { toLocal } from '../util/dates.js';
import { array, numericId, record, str } from '../util/text.js';
import { describe, readFileResource, richLinks } from './content.js';

export const SUBMISSION_TYPES: Record<number, string> = {
  0: 'file',
  1: 'text',
  2: 'on_paper',
  3: 'observed',
  4: 'file_or_text',
};

export interface Assignment {
  id: string;
  courseId: string;
  title: string;
  instructions: string;
  links: { title: string; url: string }[];
  attachments: { fileId: string; fileName: string; size: number }[];
  dueDate: string | null;
  dueLocal?: string;
  opensAt: string | null;
  closesAt: string | null;
  submissionType: string;
  groupAssignment: boolean;
  maxScore: number | null;
  hasRubric: boolean;
  submitted: boolean | null;
  url: string;
}

export function parseAssignment(raw: unknown, courseId: string, origin: string): Assignment | undefined {
  const item = record(raw);
  const id = str(item.Id);
  if (!/^\d+$/.test(id) || item.IsHidden === true) return undefined;
  const availability = record(item.Availability);
  const assessment = record(item.Assessment);
  const dueDate = typeof item.DueDate === 'string' ? item.DueDate : null;
  const dueLocal = toLocal(dueDate);
  return {
    id,
    courseId,
    title: str(item.Name).trim(),
    instructions: describe(item.CustomInstructions),
    links: [
      ...richLinks(item.CustomInstructions, origin),
      ...array(item.LinkAttachments)
        .map(record)
        .flatMap((link) =>
          str(link.Url) ? [{ title: str(link.Name) || str(link.Url), url: str(link.Url) }] : [],
        ),
    ],
    attachments: array(item.Attachments)
      .map(record)
      .filter((file) => /^\d+$/.test(str(file.FileId)))
      .map((file) => ({
        fileId: str(file.FileId),
        fileName: str(file.FileName),
        size: Number(file.Size) || 0,
      })),
    dueDate,
    ...(dueLocal ? { dueLocal } : {}),
    opensAt: typeof availability.StartDate === 'string' ? availability.StartDate : null,
    closesAt: typeof availability.EndDate === 'string' ? availability.EndDate : null,
    submissionType: SUBMISSION_TYPES[Number(item.SubmissionType)] ?? `type_${str(item.SubmissionType)}`,
    groupAssignment:
      Number(item.DropboxType) === 1 || (item.GroupTypeId !== null && item.GroupTypeId !== undefined),
    maxScore: typeof assessment.ScoreDenominator === 'number' ? assessment.ScoreDenominator : null,
    hasRubric: array(assessment.Rubrics).length > 0,
    submitted: typeof item.TotalFiles === 'number' ? item.TotalFiles > 0 : null,
    url: `${origin}/d2l/lms/dropbox/user/folder_submit_files.d2l?db=${id}&ou=${courseId}`,
  };
}

export async function assignments(
  ctx: AppContext,
  courseId: string,
): Promise<{ items: Assignment[]; complete: boolean }> {
  const id = numericId(courseId, 'course id');
  const result = await ctx.brightspace.list('le', `${id}/dropbox/folders/`);
  const items = result.items
    .map((raw) => parseAssignment(raw, id, ctx.brightspace.origin))
    .filter((item): item is Assignment => Boolean(item));
  const library = await getLibrary(ctx);
  const fetchedAt = new Date().toISOString();
  await library.putMany(
    items
      .filter((item) => item.instructions)
      .map((item) => ({
        id: `${id}:assignment:${item.id}`,
        courseId: id,
        kind: 'assignment',
        title: item.title,
        text: item.instructions,
        url: item.url,
        fetchedAt,
      })),
  );
  return { items, complete: result.complete };
}

export interface SubmissionFile {
  fileId: string;
  fileName: string;
  size: number;
}
export interface Submission {
  id: string;
  submittedAt: string | null;
  submittedLocal?: string;
  comment: string;
  files: SubmissionFile[];
}
export interface Feedback {
  score: number | null;
  displayedGrade?: string;
  text: string;
  files: SubmissionFile[];
  rubricAssessments?: unknown;
  gradedAt?: string | null;
}

export function parseMySubmissions(raw: unknown): {
  entityType: string;
  entityId: string;
  status: number | null;
  completedAt: string | null;
  submissions: Submission[];
  feedback: Feedback | null;
}[] {
  return array(raw).map((row) => {
    const entry = record(row);
    const entity = record(entry.Entity);
    const feedbackRow = entry.Feedback ? record(entry.Feedback) : null;
    const feedback: Feedback | null = feedbackRow
      ? {
          score: typeof feedbackRow.Score === 'number' ? feedbackRow.Score : null,
          ...(str(feedbackRow.DisplayedGrade) ? { displayedGrade: str(feedbackRow.DisplayedGrade) } : {}),
          text: describe(feedbackRow.Feedback),
          files: array(feedbackRow.Files)
            .map(record)
            .map((file) => ({
              fileId: str(file.FileId),
              fileName: str(file.FileName),
              size: Number(file.Size) || 0,
            })),
          rubricAssessments: feedbackRow.RubricAssessments,
          gradedAt: typeof feedbackRow.GradedDate === 'string' ? feedbackRow.GradedDate : null,
        }
      : null;
    return {
      entityType: str(entity.EntityType) || (entity.GroupId ? 'Group' : 'User'),
      entityId: str(entity.EntityId ?? entity.UserId ?? entity.GroupId),
      status: typeof entry.Status === 'number' ? entry.Status : null,
      completedAt: typeof entry.CompletionDate === 'string' ? entry.CompletionDate : null,
      submissions: array(entry.Submissions)
        .map(record)
        .map((submission) => {
          const submittedAt =
            typeof submission.SubmissionDate === 'string' ? submission.SubmissionDate : null;
          const local = toLocal(submittedAt);
          return {
            id: str(submission.Id),
            submittedAt,
            ...(local ? { submittedLocal: local } : {}),
            comment: describe(submission.Comment),
            files: array(submission.Files)
              .map(record)
              .map((file) => ({
                fileId: str(file.FileId),
                fileName: str(file.FileName),
                size: Number(file.Size) || 0,
              })),
          };
        }),
      feedback,
    };
  });
}

export async function assignment(
  ctx: AppContext,
  courseId: string,
  assignmentId: string,
): Promise<Record<string, unknown>> {
  const id = numericId(courseId, 'course id');
  const folder = numericId(assignmentId, 'assignment id');
  const details = parseAssignment(
    await ctx.brightspace.get('le', `${id}/dropbox/folders/${folder}`),
    id,
    ctx.brightspace.origin,
  );
  if (!details) throw new TudelftError('NOT_FOUND', 'This assignment is not visible to the account.');
  let history: ReturnType<typeof parseMySubmissions> = [];
  let historyError: string | undefined;
  try {
    history = parseMySubmissions(
      await ctx.brightspace.get('le', `${id}/dropbox/folders/${folder}/submissions/mysubmissions/`),
    );
  } catch (error) {
    historyError = error instanceof TudelftError ? error.code : 'INTERNAL_ERROR';
  }
  const submissions = history.flatMap((entry) => entry.submissions);
  const feedback = history.find((entry) => entry.feedback)?.feedback ?? null;
  return {
    ...details,
    submissionCount: submissions.length,
    submissions,
    feedback,
    history,
    ...(historyError ? { historyError } : {}),
    fetchedAt: new Date().toISOString(),
  };
}

export async function readAssignmentAttachment(
  ctx: AppContext,
  courseId: string,
  assignmentId: string,
  fileId: string,
  options: { download?: boolean; offset?: number; maxChars?: number },
) {
  const id = numericId(courseId, 'course id');
  const folder = numericId(assignmentId, 'assignment id');
  const file = numericId(fileId, 'file id');
  const details = parseAssignment(
    await ctx.brightspace.get('le', `${id}/dropbox/folders/${folder}`),
    id,
    ctx.brightspace.origin,
  );
  const attachment = details?.attachments.find((a) => a.fileId === file);
  if (!details || !attachment)
    throw new TudelftError('NOT_FOUND', 'This file is not attached to that assignment.');
  return readFileResource(ctx, {
    apiPath: `${id}/dropbox/folders/${folder}/attachments/${file}`,
    indexId: `${id}:assignmentfile:${folder}:${file}`,
    courseId: id,
    kind: 'assignment_file',
    title: `${details.title} / ${attachment.fileName}`,
    sourceUrl: details.url,
    filename: attachment.fileName,
    ...options,
  });
}

export async function readMySubmissionFile(
  ctx: AppContext,
  courseId: string,
  assignmentId: string,
  submissionId: string,
  fileId: string,
  options: { download?: boolean; offset?: number; maxChars?: number },
) {
  const id = numericId(courseId, 'course id');
  const folder = numericId(assignmentId, 'assignment id');
  const submission = numericId(submissionId, 'submission id');
  const file = numericId(fileId, 'file id');
  const history = parseMySubmissions(
    await ctx.brightspace.get('le', `${id}/dropbox/folders/${folder}/submissions/mysubmissions/`),
  );
  const own = history.flatMap((entry) => entry.submissions).find((entry) => entry.id === submission);
  const found = own?.files.find((entry) => entry.fileId === file);
  if (!own || !found)
    throw new TudelftError('NOT_FOUND', 'This file is not part of one of your own submissions.');
  return readFileResource(ctx, {
    apiPath: `${id}/dropbox/folders/${folder}/submissions/${submission}/files/${file}`,
    indexId: `${id}:submissionfile:${folder}:${submission}:${file}`,
    courseId: id,
    kind: 'submission_file',
    title: found.fileName,
    sourceUrl: `${ctx.brightspace.origin}/d2l/lms/dropbox/user/folders_history.d2l?ou=${id}&db=${folder}`,
    filename: found.fileName,
    ...options,
  });
}

export async function readFeedbackFile(
  ctx: AppContext,
  courseId: string,
  assignmentId: string,
  fileId: string,
  options: { download?: boolean; offset?: number; maxChars?: number },
) {
  const id = numericId(courseId, 'course id');
  const folder = numericId(assignmentId, 'assignment id');
  const file = numericId(fileId, 'file id');
  const history = parseMySubmissions(
    await ctx.brightspace.get('le', `${id}/dropbox/folders/${folder}/submissions/mysubmissions/`),
  );
  const entry = history.find((item) => item.feedback?.files.some((f) => f.fileId === file));
  const found = entry?.feedback?.files.find((f) => f.fileId === file);
  if (!entry || !found)
    throw new TudelftError('NOT_FOUND', 'This file is not part of your published feedback.');
  const entityType = /group/i.test(entry.entityType) ? 'group' : 'user';
  const entityId = entry.entityId || (await ctx.brightspace.identity()).id;
  return readFileResource(ctx, {
    apiPath: `${id}/dropbox/folders/${folder}/feedback/${entityType}/${entityId}/attachments/${file}`,
    indexId: `${id}:feedbackfile:${folder}:${file}`,
    courseId: id,
    kind: 'feedback_file',
    title: found.fileName,
    sourceUrl: `${ctx.brightspace.origin}/d2l/lms/dropbox/user/folders_history.d2l?ou=${id}&db=${folder}`,
    filename: found.fileName,
    ...options,
  });
}
