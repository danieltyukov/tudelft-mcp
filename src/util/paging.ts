import { TudelftError } from '../errors.js';
import { record, str } from './text.js';

export interface Page {
  items: unknown[];
  hasMore: boolean;
  bookmark?: string;
  nextUrl?: string;
}

/** Brightspace returns arrays, {PagingInfo, Items} or {Objects, Next}. */
export function pageItems(payload: unknown): Page {
  if (Array.isArray(payload)) return { items: payload, hasMore: false };
  const row = record(payload);
  if (Array.isArray(row.Items)) {
    const paging = record(row.PagingInfo);
    const bookmark = str(paging.Bookmark);
    return bookmark
      ? { items: row.Items, hasMore: paging.HasMoreItems === true, bookmark }
      : { items: row.Items, hasMore: paging.HasMoreItems === true };
  }
  if (Array.isArray(row.Objects)) {
    const next = typeof row.Next === 'string' ? row.Next.trim() : '';
    return next
      ? { items: row.Objects, hasMore: true, nextUrl: next }
      : { items: row.Objects, hasMore: false };
  }
  throw new TudelftError('FORMAT_CHANGED', 'Brightspace returned an unfamiliar list format.');
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Serialize async work through a single lane. */
export class Lane {
  private tail: Promise<unknown> = Promise.resolve();
  run<T>(task: () => Promise<T>): Promise<T> {
    const next = this.tail.then(task, task);
    this.tail = next.catch(() => undefined);
    return next;
  }
}

/** Share one in-flight promise between concurrent callers. */
export class Single<T> {
  private inflight?: Promise<T>;
  run(task: () => Promise<T>): Promise<T> {
    this.inflight ??= task().finally(() => {
      this.inflight = undefined;
    });
    return this.inflight;
  }
}
