import { randomUUID } from 'node:crypto';
import type { AppContext } from '../context.js';
import { toSafeError, TudelftError } from '../errors.js';
import { getLibrary } from '../index/install.js';
import { announcements } from './news.js';
import { assignments } from './assignments.js';
import { courseContent, readMaterial } from './content.js';

export interface SyncJob {
  id: string;
  courseId: string;
  state: 'queued' | 'running' | 'completed' | 'failed';
  startedAt: string;
  finishedAt?: string;
  progress: { total: number; done: number; indexed: number; skipped: number; failed: number };
  current?: string;
  errors: { topicId: string; title: string; error: ReturnType<typeof toSafeError> }[];
  result?: Record<string, unknown>;
  error?: ReturnType<typeof toSafeError>;
}

const jobs = new Map<string, SyncJob>();
let running = false;

export function syncStatus(jobId?: string): SyncJob | SyncJob[] {
  if (!jobId) return [...jobs.values()].slice(-10);
  const job = jobs.get(jobId);
  if (!job) throw new TudelftError('NOT_FOUND', 'No sync job with that id in this process.');
  return job;
}

/** Index every readable file in a course in the background. Returns the job immediately. */
export async function startSync(
  ctx: AppContext,
  courseId: string,
  options: { maxFiles?: number; refresh?: boolean } = {},
): Promise<SyncJob> {
  if (running)
    throw new TudelftError(
      'SYNC_BUSY',
      'A sync is already running. Poll get_sync_status and start another when it finishes.',
    );
  await ctx.brightspace.identity();
  const job: SyncJob = {
    id: randomUUID(),
    courseId,
    state: 'queued',
    startedAt: new Date().toISOString(),
    progress: { total: 0, done: 0, indexed: 0, skipped: 0, failed: 0 },
    errors: [],
  };
  if (jobs.size >= 20) jobs.delete(jobs.keys().next().value!);
  jobs.set(job.id, job);
  running = true;
  void (async () => {
    job.state = 'running';
    try {
      const library = await getLibrary(ctx);
      const [content] = await Promise.all([
        courseContent(ctx, courseId),
        announcements(ctx, courseId).catch(() => undefined),
        assignments(ctx, courseId).catch(() => undefined),
      ]);
      const candidates = content.topics.filter(
        (topic) => topic.type === 'file' && topic.extractable && !topic.broken && !topic.locked,
      );
      const limit = Math.max(0, Math.min(500, options.maxFiles ?? 200));
      const batch = candidates.slice(0, limit);
      job.progress.total = batch.length;
      for (const topic of batch) {
        job.current = topic.title;
        try {
          if (!options.refresh && (await library.has(`${courseId}:topic:${topic.id}`))) {
            job.progress.skipped++;
          } else {
            const result = await readMaterial(ctx, courseId, topic.id, { maxChars: 1 });
            if (result.indexed) job.progress.indexed++;
            else job.progress.skipped++;
          }
        } catch (error) {
          if (error instanceof TudelftError && ['AUTH_REQUIRED', 'ACCOUNT_CHANGED'].includes(error.code))
            throw error;
          job.progress.failed++;
          if (job.errors.length < 50)
            job.errors.push({ topicId: topic.id, title: topic.title, error: toSafeError(error) });
        }
        job.progress.done++;
      }
      job.state = 'completed';
      job.result = {
        candidateFiles: candidates.length,
        processed: batch.length,
        remaining: candidates.length - batch.length,
        coverage: await library.coverage(courseId),
      };
    } catch (error) {
      job.state = 'failed';
      job.error = toSafeError(error);
    } finally {
      delete job.current;
      job.finishedAt = new Date().toISOString();
      running = false;
    }
  })();
  return job;
}
