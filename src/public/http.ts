import { TudelftError } from '../errors.js';
import { readBounded } from '../util/http.js';

export const PUBLIC_MAX_BYTES = 2 * 1024 * 1024;
export const PUBLIC_PAGE_SIZE = 25;

/** Public university sites this server may read without a session, as origin plus path pattern. */
const ALLOWED: Array<{ origin: string; path: RegExp }> = [
  {
    origin: 'https://curriculum.tudelft.nl',
    path: /^\/publisher\/api\/v0\/courses\/items\/(?:search|[A-Za-z0-9_-]{1,100})$/,
  },
  { origin: 'https://spacefinder.tudelft.nl', path: /^\/en\/spaces\/$/ },
  { origin: 'https://esviewer.tudelft.nl', path: /^\/$/ },
  { origin: 'https://softwarefinder.tudelft.nl', path: /^\/(?:package\/[A-Za-z0-9_-]{1,100}\/)?$/ },
  { origin: 'https://meldingen-ict.tudelft.nl', path: /^\/api\/(?:incidents|maintenance|information)\/$/ },
];

export function publicUrl(input: string): URL {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new TudelftError('INVALID_URL', 'The public service URL is not valid.');
  }
  const ok = ALLOWED.some((entry) => entry.origin === url.origin && entry.path.test(url.pathname));
  if (!ok || url.username || url.password)
    throw new TudelftError('INVALID_ARGUMENT', 'This public service URL is not on the allowlist.', {
      origin: url.origin,
      path: url.pathname,
    });
  return url;
}

export interface PublicResponse {
  status: number;
  text: string;
  contentType: string;
}

export interface PublicRequest {
  method?: 'GET' | 'POST';
  body?: unknown;
  accept?: string;
  timeoutMs?: number;
  label?: string;
}

/** Fetch a public page or JSON document with a size cap. Never sends cookies or tokens. */
export async function fetchPublic(input: string, options: PublicRequest = {}): Promise<PublicResponse> {
  const url = publicUrl(input);
  const label = options.label ?? url.hostname;
  const headers: Record<string, string> = {
    accept: options.accept ?? 'application/json, text/html;q=0.9, */*;q=0.5',
    'accept-language': 'en',
  };
  const init: RequestInit = {
    method: options.method ?? 'GET',
    headers,
    redirect: 'manual',
    signal: AbortSignal.timeout(options.timeoutMs ?? 30_000),
  };
  if (options.body !== undefined) {
    headers['content-type'] = 'application/json';
    init.body = JSON.stringify(options.body);
  }
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch {
    throw new TudelftError(
      'UNAVAILABLE',
      `${label} could not be reached. Check your connection and try again.`,
    );
  }
  if (response.status === 404) {
    await response.body?.cancel().catch(() => undefined);
    throw new TudelftError('NOT_FOUND', `${label} has no such record.`);
  }
  if (response.status === 429 || response.status >= 500) {
    await response.body?.cancel().catch(() => undefined);
    throw new TudelftError('UNAVAILABLE', `${label} is busy or unavailable. Try again later.`, {
      status: response.status,
    });
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new TudelftError('UNAVAILABLE', `${label} returned an error.`, { status: response.status });
  }
  const text = await readBounded(response, PUBLIC_MAX_BYTES, `${label} response`);
  return { status: response.status, text, contentType: response.headers.get('content-type') ?? '' };
}

export async function fetchPublicJson(input: string, options: PublicRequest = {}): Promise<unknown> {
  const response = await fetchPublic(input, { accept: 'application/json', ...options });
  try {
    return JSON.parse(response.text) as unknown;
  } catch {
    throw new TudelftError(
      'FORMAT_CHANGED',
      `${options.label ?? 'The service'} returned an unreadable response.`,
    );
  }
}

export async function fetchPublicHtml(input: string, options: PublicRequest = {}): Promise<string> {
  const response = await fetchPublic(input, { accept: 'text/html, */*;q=0.5', ...options });
  return response.text;
}

/** Filter, then slice one page out of a list; used by every public search. */
export function pageOf<T>(
  items: T[],
  offset: number,
  size = PUBLIC_PAGE_SIZE,
): { items: T[]; offset: number; total: number; nextOffset?: number; complete: boolean } {
  const start = Math.max(0, Math.floor(offset));
  const page = items.slice(start, start + size);
  const hasMore = start + page.length < items.length;
  const out: { items: T[]; offset: number; total: number; nextOffset?: number; complete: boolean } = {
    items: page,
    offset: start,
    total: items.length,
    complete: !hasMore,
  };
  if (hasMore) out.nextOffset = start + page.length;
  return out;
}

/** Case-insensitive match of every query word against a haystack. */
export function matches(haystack: string, query: string | undefined): boolean {
  const words = (query ?? '').toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  if (!words.length) return true;
  const text = haystack.toLowerCase();
  return words.every((word) => text.includes(word));
}
