import type { Config } from '../config.js';
import { cookieHeader, type OsirisSession, type SessionStore } from '../auth/session.js';
import { TudelftError } from '../errors.js';
import { isJson, readBounded } from '../util/http.js';
import { Single, sleep } from '../util/paging.js';
import { array, num, record } from '../util/text.js';

export type Method = 'GET' | 'POST' | 'PUT' | 'DELETE';
export type Renewer = () => Promise<boolean>;

export interface PageOptions {
  offset?: number;
  limit?: number;
}

export interface PageResult {
  items: unknown[];
  offset: number;
  limit: number;
  hasMore: boolean;
  nextOffset?: number;
  count?: number;
}

/** OSIRIS ids may contain letters, digits, colons, underscores and hyphens (for example sopl:12:exty:9). */
export const OSIRIS_ID = /^[a-zA-Z0-9_:-]{1,100}$/;
const ID = '[a-zA-Z0-9_:-]{1,100}';
const REG_KINDS = '(?:cursussen|toetsen|opleidingen|minoren|specialisaties)';
const WRITE_KINDS = '(?:cursussen|toetsen)';
const CATALOGUE = '(?:cursussen_voor_cursusinschrijving|cursussen_voor_toetsinschrijving)';

interface Route {
  method: Method;
  pattern: RegExp;
}

const route = (method: Method, source: string): Route => ({ method, pattern: new RegExp(`^${source}$`) });

/**
 * Every path the client may call, mirrored from the OSIRIS Student web app.
 * The list is deliberately narrow; anything else is rejected before a request is made.
 */
const ROUTES: Route[] = [
  route('GET', '/gebruiker'),
  route('GET', '/student/personalia'),
  route('GET', '/student/contactgegevens'),
  route('GET', '/student/resultaten'),
  route('GET', `/student/resultaten/${ID}`),
  route('GET', '/student/voortgang/per_opleiding/?'),
  route('GET', `/student/voortgang/${ID}/onderwijsprogramma`),
  route('GET', `/student/voortgang/${ID}/studieadviezen`),
  route('GET', `/student/inschrijvingen/${REG_KINDS}`),
  route('GET', `/student/inschrijvingen/${WRITE_KINDS}/${ID}`),
  route('GET', `/student/${CATALOGUE}/te_volgen_onderwijs/open_voor_inschrijving/?`),
  route('GET', `/student/${CATALOGUE}/gepland_onderwijs/?`),
  route('GET', `/student/${CATALOGUE}/${ID}`),
  route('GET', `/student/${CATALOGUE}/${ID}/controleren`),
  route('GET', `/student/${CATALOGUE}/${ID}/blokken_voor_cursusinschrijving`),
  route('POST', `/student/${CATALOGUE}/zoeken`),
  route('PUT', `/student/inschrijvingen/cursussen/${ID}`),
  route('POST', '/student/inschrijvingen/toetsen/'),
  route('DELETE', `/student/inschrijvingen/${WRITE_KINDS}/${ID}`),
  route('GET', '/student/rooster'),
  route('GET', '/student/nieuws'),
];

const QUERY_KEYS = new Set(['offset', 'limit', 'toon_historie', 'zoekstring']);
const MAX_BODY = 2 * 1024 * 1024;
const BASE = '/student/osiris';

export interface RequestOptions {
  /** Send without a token (only the public news endpoint). */
  anonymous?: boolean;
}

/**
 * HTTP client for the OSIRIS Student JSON API on my.tudelft.nl. Reads the
 * bearer token from the session store, renews it once through the renewer
 * when the server answers 401, and maps every failure to a TudelftError.
 */
export class OsirisClient {
  private renewal = new Single<boolean>();
  private lastRenewFailure = 0;

  constructor(
    readonly config: Config,
    private readonly store: SessionStore,
    private readonly renewer: Renewer,
  ) {}

  get origin(): string {
    return this.config.osirisUrl;
  }

  async session(): Promise<OsirisSession> {
    const data = await this.store.load();
    if (!data.osiris || data.osiris.origin !== this.origin) {
      throw new TudelftError(
        'OSIRIS_AUTH_REQUIRED',
        'OSIRIS (my.tudelft.nl) is not connected. Run "tudelft-mcp login" or ask the student to sign in with auth_login.',
      );
    }
    return data.osiris;
  }

  /** Validate a relative API path against the allowlist and return the absolute URL. */
  resolve(path: string, method: Method = 'GET'): URL {
    if (
      typeof path !== 'string' ||
      !path.startsWith('/') ||
      /[#\\]|\.\.|\/\//.test(path) ||
      /\s/.test(path)
    ) {
      throw new TudelftError('INVALID_ARGUMENT', 'The OSIRIS path is not valid.');
    }
    let url: URL;
    try {
      url = new URL(BASE + path, this.origin);
    } catch {
      throw new TudelftError('INVALID_ARGUMENT', 'The OSIRIS path is not valid.');
    }
    if (url.origin !== this.origin || !url.pathname.startsWith(`${BASE}/`))
      throw new TudelftError('INVALID_ARGUMENT', 'The OSIRIS path is not valid.');
    const relative = url.pathname.slice(BASE.length);
    if (!ROUTES.some((entry) => entry.method === method && entry.pattern.test(relative)))
      throw new TudelftError('INVALID_ARGUMENT', 'This OSIRIS endpoint is not supported.', {
        method,
        path: relative,
      });
    for (const key of url.searchParams.keys()) {
      if (!QUERY_KEYS.has(key))
        throw new TudelftError('INVALID_ARGUMENT', `Query parameter "${key}" is not supported for OSIRIS.`);
    }
    return url;
  }

  private async renew(): Promise<boolean> {
    if (Date.now() - this.lastRenewFailure < 60_000) return false;
    let ok = false;
    try {
      ok = await this.renewal.run(() => this.renewer());
    } catch (error) {
      if (error instanceof TudelftError && error.code === 'ACCOUNT_CHANGED') throw error;
      ok = false;
    }
    if (!ok) this.lastRenewFailure = Date.now();
    return ok;
  }

  private headers(url: URL, session: OsirisSession | undefined, hasBody: boolean): Record<string, string> {
    const headers: Record<string, string> = {
      accept: 'application/json',
      taal: 'EN',
      client_type: 'web',
    };
    if (hasBody) headers['content-type'] = 'application/json';
    if (session) {
      headers.authorization = `Bearer ${session.token}`;
      const cookie = cookieHeader(session.cookies, url);
      if (cookie) headers.cookie = cookie;
    }
    return headers;
  }

  private isWrite(method: Method, url: URL): boolean {
    if (method === 'GET') return false;
    if (method === 'POST' && url.pathname.endsWith('/zoeken')) return false;
    return true;
  }

  /**
   * Perform one API call. Reads are retried after a silent token renewal and
   * on transient server errors; writes are sent exactly once.
   */
  async request(
    path: string,
    method: Method = 'GET',
    body?: unknown,
    options: RequestOptions = {},
  ): Promise<unknown> {
    const url = this.resolve(path, method);
    const write = this.isWrite(method, url);
    let renewed = false;
    const attempts = write ? 1 : 4;
    for (let attempt = 0; attempt < attempts; attempt++) {
      let session: OsirisSession | undefined;
      if (!options.anonymous) {
        session = await this.session();
        if (
          !renewed &&
          session.expiresAt !== null &&
          session.expiresAt <= Date.now() + 30_000 &&
          (await this.renew())
        ) {
          renewed = true;
          session = await this.session();
        }
      }
      const init: RequestInit = {
        method,
        headers: this.headers(url, session, body !== undefined),
        redirect: 'manual',
        signal: AbortSignal.timeout(this.config.timeoutMs),
      };
      if (body !== undefined) init.body = JSON.stringify(body);
      let response: Response;
      try {
        response = await fetch(url, init);
      } catch {
        throw new TudelftError(
          write ? 'OUTCOME_UNKNOWN' : 'UNAVAILABLE',
          write
            ? 'The OSIRIS request ended without a response. Check your registrations in OSIRIS before trying again.'
            : 'OSIRIS (my.tudelft.nl) could not be reached. Check your connection and try again.',
        );
      }
      const status = response.status;
      if (status === 401 || (status >= 300 && status < 400)) {
        await response.body?.cancel().catch(() => undefined);
        if (options.anonymous)
          throw new TudelftError('UNAVAILABLE', 'OSIRIS did not serve this public resource.', { status });
        if (!write && !renewed) {
          renewed = true;
          if (await this.renew()) continue;
        }
        throw new TudelftError(
          'OSIRIS_AUTH_REQUIRED',
          write
            ? 'OSIRIS rejected the session before the request was processed. Nothing was sent twice; sign in and prepare the action again.'
            : 'The OSIRIS session has expired and could not be renewed silently. Run "tudelft-mcp login".',
          { status },
        );
      }
      if (!write && (status === 429 || status === 502 || status === 503 || status === 504)) {
        await response.body?.cancel().catch(() => undefined);
        if (attempt === attempts - 1)
          throw new TudelftError('UNAVAILABLE', 'OSIRIS is busy or unavailable. Try again in a moment.', {
            status,
          });
        const retryAfter = Number(response.headers.get('retry-after'));
        await sleep(
          Number.isFinite(retryAfter) && retryAfter > 0
            ? Math.min(retryAfter * 1000, 10_000)
            : 400 * 2 ** attempt,
        );
        continue;
      }
      if (status === 501) {
        await response.body?.cancel().catch(() => undefined);
        throw new TudelftError('UNAVAILABLE', 'OSIRIS does not offer this function at TU Delft.', {
          status: 501,
          reason: 'not implemented by the university',
        });
      }
      if (status === 403) {
        await response.body?.cancel().catch(() => undefined);
        throw new TudelftError('PERMISSION_DENIED', 'OSIRIS does not allow this account to do that.', {
          status,
        });
      }
      if (status === 404) {
        await response.body?.cancel().catch(() => undefined);
        throw new TudelftError('NOT_FOUND', 'OSIRIS has no such record for this account.', { status });
      }
      const text = await readBounded(response, MAX_BODY, 'OSIRIS response');
      if (status >= 500) {
        throw new TudelftError(
          write ? 'OUTCOME_UNKNOWN' : 'UNAVAILABLE',
          write
            ? 'OSIRIS did not confirm the request. Check your registrations in OSIRIS before trying again.'
            : 'OSIRIS returned a server error. Try again later.',
          { status },
        );
      }
      if (!response.ok) {
        throw new TudelftError(
          write ? 'NOT_ALLOWED' : 'UNAVAILABLE',
          write ? 'OSIRIS rejected the request.' : 'OSIRIS returned an error.',
          { status, messages: statusMessages(safeJson(text)) },
        );
      }
      if (status === 204 || !text.trim()) return null;
      if (!isJson(response) && /^\s*</.test(text)) {
        if (!options.anonymous && !write && !renewed) {
          renewed = true;
          if (await this.renew()) continue;
        }
        throw new TudelftError(
          write ? 'OUTCOME_UNKNOWN' : 'OSIRIS_AUTH_REQUIRED',
          write
            ? 'OSIRIS answered with a page instead of a result. Check your registrations in OSIRIS.'
            : 'OSIRIS answered with a sign-in page. Run "tudelft-mcp login".',
        );
      }
      try {
        return JSON.parse(text) as unknown;
      } catch {
        throw new TudelftError('FORMAT_CHANGED', 'OSIRIS returned an unreadable response.');
      }
    }
    throw new TudelftError('UNAVAILABLE', 'OSIRIS could not complete the request.');
  }

  /** One page of an offset/limit list. */
  async page(
    path: string,
    options: PageOptions = {},
    requestOptions: RequestOptions = {},
  ): Promise<PageResult> {
    const offset = clampInt(options.offset ?? 0, 0, 1_000_000);
    const limit = clampInt(options.limit ?? 50, 1, 100);
    const url = new URL(path, 'https://placeholder.invalid');
    url.searchParams.set('offset', String(offset));
    url.searchParams.set('limit', String(limit));
    const payload = await this.request(`${url.pathname}${url.search}`, 'GET', undefined, requestOptions);
    return parsePage(payload, offset, limit);
  }

  /** Follow hasMore until the list ends or max items were collected. */
  async all(
    path: string,
    max = 1000,
    requestOptions: RequestOptions = {},
  ): Promise<{ items: unknown[]; complete: boolean; count?: number }> {
    const items: unknown[] = [];
    let offset = 0;
    let count: number | undefined;
    for (let pageNo = 0; pageNo < 100; pageNo++) {
      const result = await this.page(path, { offset, limit: 100 }, requestOptions);
      items.push(...result.items);
      if (result.count !== undefined) count = result.count;
      if (!result.hasMore || result.items.length === 0)
        return count === undefined ? { items, complete: true } : { items, complete: true, count };
      if (items.length >= max) break;
      offset = result.nextOffset ?? offset + result.items.length;
    }
    return count === undefined ? { items, complete: false } : { items, complete: false, count };
  }
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

export interface StatusMessage {
  type: string;
  text: string;
}

/** Extract OSIRIS statusmeldingen ({type: E|W|I, tekst|melding|omschrijving}) from a response. */
export function statusMessages(payload: unknown): StatusMessage[] {
  const row = record(payload);
  return array(row.statusmeldingen)
    .map((entry) => {
      const item = record(entry);
      const type = String(item.type ?? item.soort ?? '').toUpperCase();
      const text = String(
        item.tekst ?? item.melding ?? item.omschrijving ?? item.message ?? item.text ?? item.boodschap ?? '',
      );
      return { type, text };
    })
    .filter((message) => message.type || message.text);
}

export function parsePage(payload: unknown, offset: number, limit: number): PageResult {
  if (Array.isArray(payload)) return { items: payload, offset, limit, hasMore: false };
  const row = record(payload);
  if (!Array.isArray(row.items))
    throw new TudelftError('FORMAT_CHANGED', 'OSIRIS returned an unfamiliar list format.');
  const hasMore = row.hasMore === true;
  const result: PageResult = {
    items: row.items,
    offset: num(row.offset) ?? offset,
    limit: num(row.limit) ?? limit,
    hasMore,
  };
  if (hasMore) result.nextOffset = result.offset + row.items.length;
  const count = num(row.count);
  if (count !== undefined) result.count = count;
  return result;
}
