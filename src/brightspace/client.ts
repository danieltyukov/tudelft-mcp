import type { Config } from '../config.js';
import { TudelftError } from '../errors.js';
import { discoverVersions } from '../auth/brightspace-auth.js';
import { cookieHeader, type BrightspaceSession, type Identity, type SessionStore } from '../auth/session.js';
import { pageItems, Single, sleep } from '../util/paging.js';
import { sameOrigin } from '../util/url.js';

export type Product = 'lp' | 'le';
export interface ListResult {
  items: unknown[];
  complete: boolean;
  nextBookmark?: string;
}
export interface Download {
  bytes: Buffer;
  contentType: string;
  filename?: string;
  url: string;
}
export type Renewer = () => Promise<boolean>;

const MAX_PAGES = 30;

/**
 * Thin HTTP client for the Brightspace learning APIs. It reads cookies and the
 * bearer token from the session store, renews silently through the browser
 * profile when the session expires, and handles both pagination styles.
 */
export class BrightspaceClient {
  private versionsPromise?: Promise<{ lp: string; le: string }>;
  private renewal = new Single<boolean>();
  private lastRenewFailure = 0;

  constructor(
    readonly config: Config,
    private readonly store: SessionStore,
    private readonly renewer: Renewer,
  ) {}

  get origin(): string {
    return this.config.brightspaceUrl;
  }

  async session(): Promise<BrightspaceSession> {
    const data = await this.store.load();
    if (!data.brightspace || data.brightspace.origin !== this.origin) {
      throw new TudelftError(
        'AUTH_REQUIRED',
        'Not signed in to Brightspace. Run "tudelft-mcp login" (or the auth_login tool) first.',
      );
    }
    return data.brightspace;
  }

  async identity(): Promise<Identity> {
    return (await this.session()).identity;
  }

  async versions(): Promise<{ lp: string; le: string }> {
    this.versionsPromise ??= discoverVersions(this.origin, this.config.timeoutMs).catch((error: unknown) => {
      this.versionsPromise = undefined;
      throw error;
    });
    return this.versionsPromise;
  }

  async apiUrl(product: Product, path: string, params: Record<string, string> = {}): Promise<string> {
    const versions = await this.versions();
    if (/[?#\\]/.test(path) || path.split('/').some((part) => part === '.' || part === '..')) {
      throw new TudelftError('INVALID_ARGUMENT', 'The API path is not valid.');
    }
    const prefix = `/d2l/api/${product}/${versions[product]}/`;
    const url = new URL(prefix + path.replace(/^\//, ''), this.origin);
    if (!url.pathname.startsWith(prefix))
      throw new TudelftError('INVALID_ARGUMENT', 'The API path is not valid.');
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    return url.href;
  }

  private async renew(): Promise<boolean> {
    if (Date.now() - this.lastRenewFailure < 60_000) return false;
    const ok = await this.renewal.run(() => this.renewer());
    if (!ok) this.lastRenewFailure = Date.now();
    return ok;
  }

  private async headers(
    url: URL,
    session: BrightspaceSession,
    extra: Record<string, string> = {},
  ): Promise<Record<string, string>> {
    const headers: Record<string, string> = { accept: 'application/json', ...extra };
    const cookie = cookieHeader(session.cookies, url);
    if (cookie) headers.cookie = cookie;
    if (session.bearer && url.pathname.startsWith('/d2l/api/'))
      headers.authorization = `Bearer ${session.bearer}`;
    return headers;
  }

  private looksSignedOut(response: Response): boolean {
    if (response.status === 401) return true;
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location') ?? '';
      return (
        /\/d2l\/(?:login|lp\/auth)/.test(location) ||
        location.includes('surfconext') ||
        location.includes('login.tudelft.nl')
      );
    }
    return false;
  }

  /** True when the saved session still answers the current-user endpoint. */
  private async sessionAlive(session: BrightspaceSession): Promise<boolean> {
    try {
      const versions = await this.versions();
      const url = new URL(`/d2l/api/lp/${versions.lp}/users/whoami`, this.origin);
      const response = await fetch(url, {
        headers: await this.headers(url, session),
        redirect: 'manual',
        signal: AbortSignal.timeout(this.config.timeoutMs),
      });
      await response.body?.cancel().catch(() => undefined);
      return response.status === 200 && (response.headers.get('content-type') ?? '').includes('json');
    } catch {
      return false;
    }
  }

  /** GET JSON from an absolute API URL. */
  async getUrl(input: string): Promise<unknown> {
    const url = sameOrigin(input, this.origin);
    if (!/^\/d2l\/api\/(?:lp|le)\/\d+\.\d+\//.test(url.pathname))
      throw new TudelftError('INVALID_ARGUMENT', 'Only Brightspace API paths are allowed.');
    let renewed = false;
    for (let attempt = 0; attempt < 5; attempt++) {
      const session = await this.session();
      let response: Response;
      try {
        response = await fetch(url, {
          headers: await this.headers(url, session),
          redirect: 'manual',
          signal: AbortSignal.timeout(this.config.timeoutMs),
        });
      } catch {
        throw new TudelftError(
          'UNAVAILABLE',
          'Brightspace could not be reached. Check your connection and try again.',
        );
      }
      const type = response.headers.get('content-type') ?? '';
      if (response.status === 429 || response.status >= 500) {
        await response.body?.cancel().catch(() => undefined);
        if (attempt === 4)
          throw new TudelftError(
            'UNAVAILABLE',
            'Brightspace is busy or unavailable. Try again in a moment.',
            { status: response.status },
          );
        const retryAfter = Number(response.headers.get('retry-after'));
        await sleep(
          Number.isFinite(retryAfter) && retryAfter > 0
            ? Math.min(retryAfter * 1000, 10_000)
            : 400 * 2 ** attempt,
        );
        continue;
      }
      if (this.looksSignedOut(response) || (response.status === 200 && !type.includes('json'))) {
        await response.body?.cancel().catch(() => undefined);
        if (!renewed) {
          renewed = true;
          if (await this.renew()) continue;
        }
        throw new TudelftError(
          'AUTH_REQUIRED',
          'The Brightspace session has expired and could not be renewed silently. Run "tudelft-mcp login".',
        );
      }
      if (response.status === 403 && !renewed) {
        // Brightspace answers 403 both for a missing session and for a real permission
        // denial. Probe the session cheaply before deciding which one this is.
        await response.body?.cancel().catch(() => undefined);
        renewed = true;
        if (!(await this.sessionAlive(session))) {
          if (await this.renew()) continue;
          throw new TudelftError(
            'AUTH_REQUIRED',
            'The Brightspace session has expired and could not be renewed silently. Run "tudelft-mcp login".',
          );
        }
        throw new TudelftError('PERMISSION_DENIED', 'Brightspace does not allow this account to read that.', {
          status: 403,
        });
      }
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        const code =
          response.status === 403
            ? 'PERMISSION_DENIED'
            : response.status === 404
              ? 'NOT_FOUND'
              : 'UNAVAILABLE';
        throw new TudelftError(
          code,
          response.status === 404
            ? 'Brightspace has no such resource for this account.'
            : response.status === 403
              ? 'Brightspace does not allow this account to read that.'
              : 'Brightspace returned an error.',
          { status: response.status },
        );
      }
      if (response.status === 204) return null;
      try {
        return await response.json();
      } catch {
        throw new TudelftError('FORMAT_CHANGED', 'Brightspace returned an unreadable response.');
      }
    }
    throw new TudelftError('UNAVAILABLE', 'Brightspace could not complete the request.');
  }

  async get(product: Product, path: string, params: Record<string, string> = {}): Promise<unknown> {
    return this.getUrl(await this.apiUrl(product, path, params));
  }

  /** Follow bookmark or Next pagination and collect items. */
  async list(
    product: Product,
    path: string,
    params: Record<string, string> = {},
    maxPages = MAX_PAGES,
  ): Promise<ListResult> {
    const items: unknown[] = [];
    const seen = new Set<string>();
    let url = await this.apiUrl(product, path, params);
    let bookmark: string | undefined;
    for (let page = 0; page < maxPages; page++) {
      if (seen.has(url))
        throw new TudelftError('FORMAT_CHANGED', 'Brightspace repeated a pagination cursor.');
      seen.add(url);
      const result = pageItems(await this.getUrl(url));
      items.push(...result.items);
      if (!result.hasMore) return { items, complete: true };
      if (result.nextUrl) {
        url = sameOrigin(new URL(result.nextUrl, url).href, this.origin).href;
        bookmark = undefined;
      } else if (result.bookmark) {
        bookmark = result.bookmark;
        url = await this.apiUrl(product, path, { ...params, bookmark });
      } else throw new TudelftError('FORMAT_CHANGED', 'Brightspace did not provide a pagination cursor.');
    }
    return bookmark ? { items, complete: false, nextBookmark: bookmark } : { items, complete: false };
  }

  /** Send a JSON body (POST/PUT/DELETE). Used by previewed write actions. */
  async send(
    method: 'POST' | 'PUT' | 'DELETE',
    product: Product,
    path: string,
    body?: unknown,
  ): Promise<{ status: number; data: unknown }> {
    const url = new URL(await this.apiUrl(product, path));
    const session = await this.session();
    const headers = await this.headers(
      url,
      session,
      body === undefined ? {} : { 'content-type': 'application/json' },
    );
    if (session.xsrf) headers['x-csrf-token'] = session.xsrf;
    let response: Response;
    try {
      const init: RequestInit = {
        method,
        headers,
        redirect: 'manual',
        signal: AbortSignal.timeout(this.config.timeoutMs),
      };
      if (body !== undefined) init.body = JSON.stringify(body);
      response = await fetch(url, init);
    } catch {
      throw new TudelftError(
        'OUTCOME_UNKNOWN',
        'The request ended without a response. Check the result in Brightspace before retrying.',
      );
    }
    return this.finishWrite(response);
  }

  /** Upload a multipart body exactly once. Never retried. */
  async postMultipart(
    product: Product,
    path: string,
    body: Buffer,
    contentType: string,
  ): Promise<{ status: number; data: unknown }> {
    const url = new URL(await this.apiUrl(product, path));
    const session = await this.session();
    const headers = await this.headers(url, session, {
      'content-type': contentType,
      'content-length': String(body.byteLength),
    });
    if (session.xsrf) headers['x-csrf-token'] = session.xsrf;
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers,
        body: body as unknown as BodyInit,
        redirect: 'manual',
        signal: AbortSignal.timeout(120_000),
      });
    } catch {
      throw new TudelftError(
        'OUTCOME_UNKNOWN',
        'The upload connection ended without a receipt. Check the submission in Brightspace before retrying.',
      );
    }
    return this.finishWrite(response);
  }

  private async finishWrite(response: Response): Promise<{ status: number; data: unknown }> {
    const status = response.status;
    if (status === 401) {
      await response.body?.cancel().catch(() => undefined);
      throw new TudelftError(
        'AUTH_REQUIRED',
        'Brightspace rejected the session for this write. Sign in again; nothing was sent twice.',
        { status },
      );
    }
    if (status >= 300 && status < 400) {
      await response.body?.cancel().catch(() => undefined);
      throw new TudelftError(
        'OUTCOME_UNKNOWN',
        'Brightspace redirected the request without confirming the outcome. Check Brightspace before retrying.',
        { status },
      );
    }
    if (status >= 500) {
      await response.body?.cancel().catch(() => undefined);
      throw new TudelftError(
        'OUTCOME_UNKNOWN',
        'Brightspace did not confirm the request. Check Brightspace before retrying.',
        { status },
      );
    }
    const text = await response.text().catch(() => '');
    if (!response.ok) {
      throw new TudelftError(
        status === 403 ? 'PERMISSION_DENIED' : 'NOT_ALLOWED',
        'Brightspace rejected the request.',
        { status, detail: text.slice(0, 300) },
      );
    }
    if (!text.trim()) return { status, data: null };
    try {
      return { status, data: JSON.parse(text) };
    } catch {
      return { status, data: null };
    }
  }

  /** Download a same-origin file, following same-origin redirects. */
  async download(input: string, maxBytes = this.config.maxFileBytes): Promise<Download> {
    let url = sameOrigin(input, this.origin);
    let renewed = false;
    for (let hop = 0; hop < 8; hop++) {
      const session = await this.session();
      const headers = await this.headers(url, session, { accept: '*/*' });
      let response: Response;
      try {
        response = await fetch(url, { headers, redirect: 'manual', signal: AbortSignal.timeout(120_000) });
      } catch {
        throw new TudelftError('UNAVAILABLE', 'Brightspace could not be reached to download this file.');
      }
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        await response.body?.cancel().catch(() => undefined);
        if (!location)
          throw new TudelftError('UNAVAILABLE', 'Brightspace returned a redirect without a destination.');
        const next = new URL(location, url);
        if (/\/d2l\/(?:login|lp\/auth)/.test(next.pathname) || next.origin !== this.origin) {
          if (!renewed && (await this.renew())) {
            renewed = true;
            continue;
          }
          throw new TudelftError('AUTH_REQUIRED', 'Sign in again to download this file.');
        }
        url = next;
        continue;
      }
      if (response.status === 401) {
        await response.body?.cancel().catch(() => undefined);
        if (!renewed && (await this.renew())) {
          renewed = true;
          continue;
        }
        throw new TudelftError('AUTH_REQUIRED', 'Sign in again to download this file.');
      }
      if (response.status === 403 && !renewed) {
        await response.body?.cancel().catch(() => undefined);
        renewed = true;
        if (!(await this.sessionAlive(session)) && (await this.renew())) continue;
        throw new TudelftError('PERMISSION_DENIED', 'Brightspace did not provide this file.', {
          status: 403,
        });
      }
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        throw new TudelftError(
          response.status === 404
            ? 'NOT_FOUND'
            : response.status === 403
              ? 'PERMISSION_DENIED'
              : 'UNAVAILABLE',
          'Brightspace did not provide this file.',
          { status: response.status },
        );
      }
      const declared = Number(response.headers.get('content-length') ?? 0);
      if (declared > maxBytes) {
        await response.body?.cancel().catch(() => undefined);
        throw new TudelftError(
          'FILE_TOO_LARGE',
          `This file is larger than the ${Math.round(maxBytes / 1048576)} MB limit.`,
        );
      }
      const reader = response.body?.getReader();
      if (!reader) throw new TudelftError('UNAVAILABLE', 'Brightspace returned an empty response.');
      const chunks: Uint8Array[] = [];
      let length = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > maxBytes) {
          await reader.cancel().catch(() => undefined);
          throw new TudelftError(
            'FILE_TOO_LARGE',
            `This file is larger than the ${Math.round(maxBytes / 1048576)} MB limit.`,
          );
        }
        chunks.push(value);
      }
      const bytes = Buffer.concat(chunks);
      const head = bytes.subarray(0, 4000).toString('utf8');
      if (/<input\b[^>]*type=["']password["']/i.test(head) || head.includes('/d2l/login?sessionExpired')) {
        throw new TudelftError('AUTH_REQUIRED', 'Sign in again to download this file.');
      }
      const disposition = response.headers.get('content-disposition') ?? '';
      let filename =
        /filename\*=(?:UTF-8'')([^;]+)/i.exec(disposition)?.[1] ??
        /filename="?([^";]+)/i.exec(disposition)?.[1];
      if (filename) {
        try {
          filename = decodeURIComponent(filename);
        } catch {
          /* keep literal */
        }
      }
      const out: Download = { bytes, contentType: response.headers.get('content-type') ?? '', url: url.href };
      if (filename) out.filename = filename;
      return out;
    }
    throw new TudelftError('UNAVAILABLE', 'This file redirected too many times.');
  }
}
