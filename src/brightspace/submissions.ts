import { createHash, randomUUID } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import type { AppContext } from '../context.js';
import { TudelftError } from '../errors.js';
import { numericId } from '../util/text.js';
import { assignment, parseMySubmissions } from './assignments.js';

const MAX_FILES = 10;
const MAX_FILE = 25 * 1024 * 1024;
const MAX_TOTAL = 50 * 1024 * 1024;
const MAX_TEXT = 256 * 1024;

export interface SubmissionPlan {
  courseId: string;
  assignmentId: string;
  assignmentTitle: string;
  submissionType: string;
  groupAssignment: boolean;
  comment: string;
  text?: string;
  files: { path: string; name: string; size: number; sha256: string }[];
  priorSubmissions: number;
  dueDate: string | null;
  dueLocal?: string;
  closesAt: string | null;
}

/** Inspect files and the assignment, then store a one-use preview. Nothing is uploaded. */
export async function prepareSubmission(
  ctx: AppContext,
  input: { courseId: string; assignmentId: string; files?: string[]; text?: string; comment?: string },
) {
  const id = numericId(input.courseId, 'course id');
  const folder = numericId(input.assignmentId, 'assignment id');
  const files = input.files ?? [];
  const text = input.text?.trim() ?? '';
  if (!files.length && !text)
    throw new TudelftError('INVALID_ARGUMENT', 'Give files to upload or text to submit.');
  if (files.length > MAX_FILES)
    throw new TudelftError('INVALID_ARGUMENT', `At most ${MAX_FILES} files per submission.`);
  if (Buffer.byteLength(text, 'utf8') > MAX_TEXT)
    throw new TudelftError('INVALID_ARGUMENT', 'Text submissions are limited to 256 KiB.');
  const details = await assignment(ctx, id, folder);
  const submissionType = String(details.submissionType);
  if (files.length && !['file', 'file_or_text'].includes(submissionType))
    throw new TudelftError(
      'NOT_ALLOWED',
      `This assignment does not accept file uploads (type: ${submissionType}).`,
    );
  if (text && !files.length && !['text', 'file_or_text'].includes(submissionType))
    throw new TudelftError(
      'NOT_ALLOWED',
      `This assignment does not accept text submissions (type: ${submissionType}).`,
    );
  const closesAt = details.closesAt as string | null;
  if (closesAt && Date.parse(closesAt) < Date.now())
    throw new TudelftError('NOT_ALLOWED', 'This assignment is closed for submissions.');
  const inspected = [];
  let total = 0;
  for (const raw of files) {
    const path = resolve(raw);
    let info;
    try {
      info = await stat(path);
    } catch {
      throw new TudelftError('NOT_FOUND', `File not found: ${basename(path)}`);
    }
    if (!info.isFile()) throw new TudelftError('INVALID_ARGUMENT', `Not a regular file: ${basename(path)}`);
    if (info.size > MAX_FILE)
      throw new TudelftError('FILE_TOO_LARGE', `${basename(path)} is larger than 25 MB.`);
    total += info.size;
    if (total > MAX_TOTAL) throw new TudelftError('FILE_TOO_LARGE', 'The files together exceed 50 MB.');
    const bytes = await readFile(path);
    inspected.push({
      path,
      name: basename(path),
      size: info.size,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    });
  }
  const plan: SubmissionPlan = {
    courseId: id,
    assignmentId: folder,
    assignmentTitle: String(details.title),
    submissionType,
    groupAssignment: Boolean(details.groupAssignment),
    comment: (input.comment ?? '').trim(),
    ...(text ? { text } : {}),
    files: inspected,
    priorSubmissions: Number(details.submissionCount ?? 0),
    dueDate: (details.dueDate as string | null) ?? null,
    ...(details.dueLocal ? { dueLocal: String(details.dueLocal) } : {}),
    closesAt,
  };
  const identity = await ctx.brightspace.identity();
  const preview = ctx.previews.create('submission', identity.id, plan);
  return {
    confirmationToken: preview.token,
    expiresAt: new Date(preview.expiresAt).toISOString(),
    preview: plan,
    submittingAs: identity.name || identity.uniqueName,
    status: 'preview_only',
    warnings: [
      ...(plan.groupAssignment
        ? ['This is a group assignment: the submission counts for the whole group.']
        : []),
      ...(plan.priorSubmissions
        ? [
            `There are already ${plan.priorSubmissions} submission(s); a new one is added, earlier ones stay visible to the grader.`,
          ]
        : []),
    ],
    note: 'Nothing was uploaded. Show the files, hashes, comment and assignment to the student and call confirm_submission with confirmed: true only after explicit approval.',
  };
}

function multipart(parts: { headers: string; body: Buffer }[]): { body: Buffer; contentType: string } {
  const boundary = `----tudelftmcp${randomUUID().replace(/-/g, '')}`;
  const chunks: Buffer[] = [];
  for (const part of parts) {
    chunks.push(
      Buffer.from(`--${boundary}\r\n${part.headers}\r\n\r\n`, 'utf8'),
      part.body,
      Buffer.from('\r\n', 'utf8'),
    );
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`, 'utf8'));
  return { body: Buffer.concat(chunks), contentType: `multipart/mixed; boundary=${boundary}` };
}

/** Upload exactly once, then verify against the submission history. Never retried. */
export async function confirmSubmission(ctx: AppContext, token: string, confirmed: boolean) {
  const identity = await ctx.brightspace.identity();
  const { payload: plan } = ctx.previews.consume<SubmissionPlan>(token, 'submission', identity.id, confirmed);
  const before = parseMySubmissions(
    await ctx.brightspace.get(
      'le',
      `${plan.courseId}/dropbox/folders/${plan.assignmentId}/submissions/mysubmissions/`,
    ),
  ).flatMap((e) => e.submissions).length;
  if (before !== plan.priorSubmissions)
    throw new TudelftError(
      'PREVIEW_CHANGED',
      'The submission history changed since the preview. Prepare again.',
    );
  const parts: { headers: string; body: Buffer }[] = [];
  for (const file of plan.files) {
    const bytes = await readFile(file.path);
    if (createHash('sha256').update(bytes).digest('hex') !== file.sha256)
      throw new TudelftError(
        'PREVIEW_CHANGED',
        `${file.name} changed on disk since the preview. Prepare again.`,
      );
    parts.push({
      headers: `Content-Disposition: form-data; name=""; filename="${file.name.replace(/"/g, '')}"\r\nContent-Type: application/octet-stream`,
      body: bytes,
    });
  }
  let path: string;
  if (plan.files.length) {
    path = `${plan.courseId}/dropbox/folders/${plan.assignmentId}/submissions/mysubmissions/`;
    parts.unshift({
      headers: 'Content-Type: application/json',
      body: Buffer.from(JSON.stringify({ Text: plan.comment, Html: '' }), 'utf8'),
    });
    const { body, contentType } = multipart(parts);
    await ctx.brightspace.postMultipart('le', path, body, contentType);
  } else {
    path = `${plan.courseId}/dropbox/folders/${plan.assignmentId}/submissions/text`;
    await ctx.brightspace.send('POST', 'le', path, {
      Text: plan.text,
      Comment: { Content: plan.comment, Type: 'Text' },
    });
  }
  const after = parseMySubmissions(
    await ctx.brightspace
      .get('le', `${plan.courseId}/dropbox/folders/${plan.assignmentId}/submissions/mysubmissions/`)
      .catch(() => []),
  ).flatMap((e) => e.submissions);
  const latest = after.sort((a, b) => (b.submittedAt ?? '').localeCompare(a.submittedAt ?? ''))[0];
  if (after.length <= before || !latest)
    throw new TudelftError(
      'OUTCOME_UNKNOWN',
      'Brightspace accepted the upload but the new submission is not visible yet. Check the assignment page before submitting again.',
    );
  return {
    status: 'submitted',
    submission: latest,
    totalSubmissions: after.length,
    url: `${ctx.brightspace.origin}/d2l/lms/dropbox/user/folders_history.d2l?ou=${plan.courseId}&db=${plan.assignmentId}`,
  };
}
