import type { BrowserContext, Page } from 'playwright-core';
import type { Config } from '../config.js';
import { TudelftError } from '../errors.js';
import { debug } from '../context.js';
import { record, str } from '../util/text.js';
import type { BrightspaceSession, Cookie, Identity } from './session.js';

export function isBrightspaceHome(url: string, origin: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.origin === origin && /^\/d2l\/home(?:\/|$)/.test(parsed.pathname);
  } catch {
    return false;
  }
}

export function extractIdentity(value: unknown): Identity | undefined {
  const row = record(value);
  const id = str(row.Identifier);
  if (!/^\d{1,18}$/.test(id)) return undefined;
  const name = [row.FirstName, row.LastName]
    .filter((part) => typeof part === 'string')
    .join(' ')
    .trim();
  const identity: Identity = { id, name, uniqueName: str(row.UniqueName) };
  const orgDefinedId = str(row.OrgDefinedId);
  if (orgDefinedId) identity.orgDefinedId = orgDefinedId;
  return identity;
}

export async function discoverVersions(
  origin: string,
  timeoutMs = 20_000,
): Promise<{ lp: string; le: string }> {
  let payload: unknown;
  try {
    const response = await fetch(`${origin}/d2l/api/versions/`, {
      signal: AbortSignal.timeout(timeoutMs),
      redirect: 'error',
    });
    if (!response.ok) throw new Error('unavailable');
    payload = await response.json();
  } catch {
    throw new TudelftError('UNAVAILABLE', 'Brightspace API discovery is unavailable. Check your connection.');
  }
  if (!Array.isArray(payload))
    throw new TudelftError('FORMAT_CHANGED', 'Brightspace did not return recognised API versions.');
  const version = (code: string): string => {
    const entry = payload.find((item) => record(item).ProductCode === code);
    const latest = str(record(entry).LatestVersion);
    if (!/^\d+\.\d+$/.test(latest))
      throw new TudelftError('FORMAT_CHANGED', `Brightspace did not publish a ${code} API version.`);
    return latest;
  };
  return { lp: version('lp'), le: version('le') };
}

export async function hasSessionCookie(context: BrowserContext, origin: string): Promise<boolean> {
  const cookies = await context.cookies(origin);
  const now = Date.now() / 1000;
  return cookies.some(
    (cookie) =>
      cookie.name === 'd2lSessionVal' && cookie.value && (cookie.expires < 0 || cookie.expires > now),
  );
}

async function passwordVisible(page: Page): Promise<boolean> {
  return page
    .locator('input[type="password"]')
    .first()
    .isVisible()
    .catch(() => false);
}

export interface WaitOptions {
  timeoutMs: number;
  silent: boolean;
  isCancelled?: () => boolean;
}

/**
 * Wait until the page has landed on the Brightspace home page with a session
 * cookie. In silent mode a password prompt means the university needs the
 * student, so we stop instead of waiting.
 */
export async function waitForBrightspace(page: Page, origin: string, options: WaitOptions): Promise<void> {
  const deadline = Date.now() + options.timeoutMs;
  while (Date.now() < deadline) {
    if (options.isCancelled?.() || page.isClosed()) {
      throw new TudelftError(
        'LOGIN_CANCELLED',
        'The sign-in window was closed before it finished. The previous session was kept.',
      );
    }
    const url = page.url();
    if (isBrightspaceHome(url, origin) && (await hasSessionCookie(page.context(), origin))) return;
    if (options.silent && (await passwordVisible(page))) {
      throw new TudelftError(
        'AUTH_REQUIRED',
        'The university asks for a password or MFA. Run "tudelft-mcp login" once to sign in again.',
      );
    }
    if (/engine\.surfconext\.nl\/authentication\/sp\/consume-assertion/.test(url)) {
      const text = await page
        .evaluate(() => (document.body?.innerText ?? '').slice(0, 20_000))
        .catch(() => '');
      if (/unsupported idp[- ]initiated/i.test(text) || /\bec\s*:?\s*66571\b/i.test(text)) {
        throw new TudelftError(
          'LOGIN_CANCELLED',
          'SURFconext rejected the sign-in. Close the window and run "tudelft-mcp login --fresh" to start clean from Brightspace.',
        );
      }
    }
    await page.waitForTimeout(600);
  }
  throw new TudelftError(
    options.silent ? 'AUTH_REQUIRED' : 'LOGIN_TIMEOUT',
    options.silent
      ? 'The saved university session has expired. Run "tudelft-mcp login" to sign in again.'
      : 'Sign-in timed out. Run "tudelft-mcp login" again when ready.',
  );
}

export async function mintBearer(
  context: BrowserContext,
  origin: string,
  xsrf: string | undefined,
  timeoutMs: number,
): Promise<string | undefined> {
  if (!xsrf) return undefined;
  try {
    const response = await context.request.post(`${origin}/d2l/lp/auth/oauth2/token`, {
      form: { scope: '*:*:*' },
      headers: { 'x-csrf-token': xsrf },
      timeout: timeoutMs,
      maxRedirects: 0,
      maxRetries: 0,
    });
    try {
      if (!response.ok() || !(response.headers()['content-type'] ?? '').includes('json')) return undefined;
      const body = record(await response.json());
      const token = str(body.access_token);
      return token || undefined;
    } finally {
      await response.dispose();
    }
  } catch {
    return undefined;
  }
}

/** Read the signed-in Brightspace state out of the browser profile. */
export async function captureBrightspace(
  context: BrowserContext,
  page: Page,
  config: Config,
): Promise<BrightspaceSession> {
  const origin = config.brightspaceUrl;
  await page.waitForLoadState('domcontentloaded').catch(() => undefined);
  const material = await page
    .evaluate(() => {
      let xsrf: string | undefined;
      const raw = localStorage.getItem('XSRF.Token');
      if (raw) {
        try {
          const parsed: unknown = JSON.parse(raw);
          xsrf = typeof parsed === 'string' ? parsed : undefined;
        } catch {
          xsrf = raw;
        }
      }
      if (!xsrf) {
        const d2l = (
          window as unknown as {
            D2L?: { LP?: { Web?: { Authentication?: { Xsrf?: { GetXsrfToken?: () => string } } } } };
          }
        ).D2L;
        try {
          xsrf = d2l?.LP?.Web?.Authentication?.Xsrf?.GetXsrfToken?.();
        } catch {
          /* optional */
        }
      }
      xsrf ||= document.querySelector('meta[name="d2l-xsrf-token"]')?.getAttribute('content') ?? undefined;
      return { xsrf: typeof xsrf === 'string' && xsrf.trim() ? xsrf.trim() : undefined };
    })
    .catch(() => ({ xsrf: undefined as string | undefined }));
  const bearer = await mintBearer(context, origin, material.xsrf, config.timeoutMs);
  const versions = await discoverVersions(origin, config.timeoutMs);
  const response = await context.request.get(`${origin}/d2l/api/lp/${versions.lp}/users/whoami`, {
    headers: bearer ? { authorization: `Bearer ${bearer}` } : {},
    maxRedirects: 0,
    timeout: config.timeoutMs,
  });
  let identity: Identity | undefined;
  try {
    if (response.ok() && (response.headers()['content-type'] ?? '').includes('json'))
      identity = extractIdentity(await response.json());
  } finally {
    await response.dispose();
  }
  if (!identity)
    throw new TudelftError(
      'AUTH_REQUIRED',
      'Brightspace signed in, but the account could not be verified through its API. Try again.',
    );
  // Keep every domain: the IdP and SURFconext cookies are session cookies that Chrome
  // drops on exit, so they are seeded back into later headless launches from here.
  const cookies = (await context.cookies()).map(toCookie);
  debug(
    `captured cookies: ${cookies.map((c) => `${c.domain}:${c.name}${c.expires < 0 ? '' : '(p)'}`).join(' ')}`,
  );
  const session: BrightspaceSession = { origin, cookies, identity, savedAt: new Date().toISOString() };
  if (material.xsrf) session.xsrf = material.xsrf;
  if (bearer) session.bearer = bearer;
  return session;
}

export function toCookie(cookie: {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite?: 'Strict' | 'Lax' | 'None';
}): Cookie {
  const out: Cookie = {
    name: cookie.name,
    value: cookie.value,
    domain: cookie.domain,
    path: cookie.path,
    expires: cookie.expires,
    httpOnly: cookie.httpOnly,
    secure: cookie.secure,
  };
  if (cookie.sameSite) out.sameSite = cookie.sameSite;
  return out;
}
