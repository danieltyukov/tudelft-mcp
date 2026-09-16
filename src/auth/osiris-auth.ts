import type { BrowserContext, Page, Response as PlaywrightResponse } from 'playwright-core';
import type { AppContext, Logger, LoginConnector } from '../context.js';
import { TudelftError } from '../errors.js';
import { isJson, mergeCookies, parseSetCookie, readBounded } from '../util/http.js';
import { record, sha256, str } from '../util/text.js';
import { toCookie } from './brightspace-auth.js';
import { cookieHeader, type Cookie, type OsirisSession } from './session.js';

const TOKEN_PATH = '/student/osiris/token';
const USER_PATH = '/student/osiris/gebruiker';
const POLL_MS = 750;

export interface TokenGrant {
  token: string;
  expiresAt: number | null;
}

/** Parse the JSON body of POST /student/osiris/token. */
export function parseTokenResponse(value: unknown, now = Date.now()): TokenGrant | undefined {
  const row = record(value);
  const token = str(row.access_token).trim();
  if (!token || /\s/.test(token)) return undefined;
  const expiresIn = Number(row.expires_in);
  const expiresAt = Number.isFinite(expiresIn) && expiresIn > 0 ? now + Math.floor(expiresIn) * 1000 : null;
  return { token, expiresAt };
}

/** The SPA stores the token in sessionStorage as a bare string or a JSON string. */
export function parseStoredToken(raw: string | null | undefined): string | undefined {
  if (typeof raw !== 'string') return undefined;
  let value = raw.trim();
  if (!value) return undefined;
  if (value.startsWith('"') || value.startsWith('{')) {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (typeof parsed === 'string') value = parsed.trim();
      else {
        const row = record(parsed);
        value = str(row.access_token ?? row.token ?? row.value).trim();
      }
    } catch {
      return undefined;
    }
  }
  return value && !/\s/.test(value) ? value : undefined;
}

export interface OsirisUser {
  studentNumber: string;
  name?: string;
  email?: string;
}

/** Validate GET /gebruiker: the account must have access and a numeric student number. */
export function verifyUser(value: unknown): OsirisUser {
  const row = record(value);
  const access = row.toegang_applicatie;
  if (access !== undefined && access !== null && str(access).toUpperCase() !== 'J') {
    throw new TudelftError(
      'PERMISSION_DENIED',
      'OSIRIS reports that this account has no access to the student application.',
    );
  }
  const studentNumber = str(row.studentnummer).trim();
  if (!/^\d{1,12}$/.test(studentNumber))
    throw new TudelftError('FORMAT_CHANGED', 'OSIRIS did not return a recognisable student number.');
  const user: OsirisUser = { studentNumber };
  const name = [row.roepnaam, row.voorvoegsels, row.achternaam]
    .map((part) => str(part).trim())
    .filter(Boolean)
    .join(' ');
  if (name) user.name = name;
  const email = str(row.e_mailadres).trim();
  if (email) user.email = email;
  return user;
}

function osirisHeaders(token: string, cookies: Cookie[], url: URL): Record<string, string> {
  const headers: Record<string, string> = {
    authorization: `Bearer ${token}`,
    accept: 'application/json',
    taal: 'EN',
    client_type: 'web',
  };
  const cookie = cookieHeader(cookies, url);
  if (cookie) headers.cookie = cookie;
  return headers;
}

/** Fetch and validate the signed-in user for a token. */
export async function fetchUser(
  origin: string,
  token: string,
  cookies: Cookie[],
  timeoutMs: number,
): Promise<OsirisUser> {
  const url = new URL(USER_PATH, origin);
  let response: Response;
  try {
    response = await fetch(url, {
      headers: osirisHeaders(token, cookies, url),
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new TudelftError('UNAVAILABLE', 'OSIRIS (my.tudelft.nl) could not be reached.');
  }
  if (response.status === 401 || (response.status >= 300 && response.status < 400)) {
    await response.body?.cancel().catch(() => undefined);
    throw new TudelftError('OSIRIS_AUTH_REQUIRED', 'OSIRIS did not accept the token.');
  }
  if (!response.ok || !isJson(response)) {
    await response.body?.cancel().catch(() => undefined);
    throw new TudelftError('UNAVAILABLE', 'OSIRIS did not return the signed-in user.', {
      status: response.status,
    });
  }
  const text = await readBounded(response, 256 * 1024, 'OSIRIS user');
  try {
    return verifyUser(JSON.parse(text));
  } catch (error) {
    if (error instanceof TudelftError) throw error;
    throw new TudelftError('FORMAT_CHANGED', 'OSIRIS returned an unreadable user record.');
  }
}

/** Throw when the Brightspace identity carries a different student number. */
export function assertSameStudent(brightspaceOrgId: string | undefined, studentNumber: string): void {
  const org = (brightspaceOrgId ?? '').trim();
  if (!/^\d{1,12}$/.test(org)) return;
  if (org !== studentNumber) {
    throw new TudelftError(
      'ACCOUNT_CHANGED',
      'The OSIRIS account is not the same student as the Brightspace account. Run "tudelft-mcp logout" and sign in again with one account.',
    );
  }
}

export function buildSession(
  origin: string,
  grant: TokenGrant,
  cookies: Cookie[],
  studentNumber: string,
): OsirisSession {
  return {
    origin,
    token: grant.token,
    expiresAt: grant.expiresAt,
    cookies,
    studentHash: sha256(studentNumber),
    savedAt: new Date().toISOString(),
  };
}

async function passwordVisible(page: Page): Promise<boolean> {
  return page
    .locator('input[type="password"]')
    .first()
    .isVisible()
    .catch(() => false);
}

export interface CaptureOptions {
  timeoutMs: number;
  silent: boolean;
}

/**
 * Open my.tudelft.nl in the shared browser context and wait for the SPA to
 * obtain its token: either the JSON body of POST /student/osiris/token or the
 * ACCESS_TOKEN entry in sessionStorage.
 */
export async function captureOsirisToken(
  context: BrowserContext,
  origin: string,
  options: CaptureOptions,
): Promise<TokenGrant> {
  const page = await context.newPage();
  let captured: TokenGrant | undefined;
  const tokenUrl = `${origin}${TOKEN_PATH}`;
  const onResponse = (response: PlaywrightResponse): void => {
    if (captured || response.status() !== 200 || response.request().method() !== 'POST') return;
    if (response.url() !== tokenUrl) return;
    void response
      .json()
      .then((body: unknown) => {
        captured ??= parseTokenResponse(body);
      })
      .catch(() => undefined);
  };
  page.on('response', onResponse);
  try {
    await page.goto(`${origin}/`, {
      waitUntil: 'domcontentloaded',
      timeout: Math.min(options.timeoutMs, 60_000),
    });
    const deadline = Date.now() + options.timeoutMs;
    while (Date.now() < deadline) {
      if (captured) return captured;
      if (page.isClosed())
        throw new TudelftError('LOGIN_CANCELLED', 'The sign-in window was closed before OSIRIS connected.');
      const stored = await page
        .evaluate(() => {
          try {
            return sessionStorage.getItem('ACCESS_TOKEN');
          } catch {
            return null;
          }
        })
        .catch(() => null);
      const token = parseStoredToken(stored);
      if (token) return { token, expiresAt: null };
      if (options.silent && (await passwordVisible(page))) {
        throw new TudelftError(
          'OSIRIS_AUTH_REQUIRED',
          'OSIRIS asks for a password or MFA. Run "tudelft-mcp login" once to sign in again.',
        );
      }
      await page.waitForTimeout(POLL_MS);
    }
    if (captured) return captured;
    throw new TudelftError(
      options.silent ? 'OSIRIS_AUTH_REQUIRED' : 'LOGIN_TIMEOUT',
      options.silent
        ? 'The OSIRIS session could not be renewed silently. Run "tudelft-mcp login".'
        : 'OSIRIS did not finish signing in within the time limit.',
    );
  } finally {
    page.off('response', onResponse);
    await page.close().catch(() => undefined);
  }
}

async function contextCookies(context: BrowserContext, origin: string): Promise<Cookie[]> {
  return (await context.cookies(origin)).map(toCookie);
}

/** Login connector: runs inside the interactive sign-in after Brightspace succeeded. */
export const osirisConnector: LoginConnector = {
  name: 'osiris',
  async connect(context: BrowserContext, ctx: AppContext, log: Logger): Promise<Record<string, unknown>> {
    const origin = ctx.config.osirisUrl;
    log(`Opening ${origin} to connect OSIRIS.`);
    const grant = await captureOsirisToken(context, origin, { timeoutMs: 90_000, silent: false });
    const cookies = await contextCookies(context, origin);
    const user = await fetchUser(origin, grant.token, cookies, ctx.config.timeoutMs);
    const data = await ctx.session.load();
    assertSameStudent(data.brightspace?.identity.orgDefinedId, user.studentNumber);
    const session = buildSession(origin, grant, cookies, user.studentNumber);
    await ctx.session.update((current) => {
      current.osiris = session;
    });
    const summary: Record<string, unknown> = {
      connected: true,
      studentNumberHash: session.studentHash.slice(0, 8),
    };
    if (user.name) summary.name = user.name;
    return summary;
  },
};

/** Try the cookie based renewal: POST {} to the token endpoint with the saved my.tudelft.nl cookies. */
async function renewWithCookies(ctx: AppContext, saved: OsirisSession): Promise<OsirisSession | undefined> {
  const url = new URL(TOKEN_PATH, ctx.config.osirisUrl);
  const cookie = cookieHeader(saved.cookies, url);
  if (!cookie) return undefined;
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        taal: 'EN',
        client_type: 'web',
        cookie,
      },
      body: '{}',
      redirect: 'manual',
      signal: AbortSignal.timeout(ctx.config.timeoutMs),
    });
  } catch {
    return undefined;
  }
  if (response.status !== 200 || !isJson(response)) {
    await response.body?.cancel().catch(() => undefined);
    return undefined;
  }
  let grant: TokenGrant | undefined;
  try {
    grant = parseTokenResponse(JSON.parse(await readBounded(response, 64 * 1024, 'OSIRIS token')));
  } catch {
    return undefined;
  }
  if (!grant) return undefined;
  const received = response.headers
    .getSetCookie()
    .map((header) => parseSetCookie(header, url))
    .filter((entry): entry is Cookie => Boolean(entry));
  const cookies = mergeCookies(saved.cookies, received);
  const user = await fetchUser(ctx.config.osirisUrl, grant.token, cookies, ctx.config.timeoutMs);
  return buildSession(ctx.config.osirisUrl, grant, cookies, user.studentNumber);
}

/**
 * Silent renewal of the OSIRIS token. First the cookie based token refresh,
 * then a headless pass through the browser profile. Returns false when the
 * student has to sign in again; throws ACCOUNT_CHANGED when another student
 * appears.
 */
export async function renewOsiris(ctx: AppContext): Promise<boolean> {
  const data = await ctx.session.load();
  const saved = data.osiris;
  if (!saved || saved.origin !== ctx.config.osirisUrl) return false;
  const accept = async (session: OsirisSession): Promise<boolean> => {
    if (session.studentHash !== saved.studentHash) {
      throw new TudelftError(
        'ACCOUNT_CHANGED',
        'The renewed OSIRIS session belongs to a different student. Run "tudelft-mcp login".',
      );
    }
    await ctx.session.update((current) => {
      current.osiris = session;
    });
    return true;
  };
  try {
    const viaCookies = await renewWithCookies(ctx, saved);
    if (viaCookies) return await accept(viaCookies);
  } catch (error) {
    if (error instanceof TudelftError && error.code === 'ACCOUNT_CHANGED') throw error;
  }
  if (ctx.browser.interactiveLoginRunning) return false;
  try {
    return await ctx.browser.withContext({ headless: true }, async (context) => {
      const origin = ctx.config.osirisUrl;
      const grant = await captureOsirisToken(context, origin, {
        timeoutMs: Math.min(ctx.config.silentLoginTimeoutMs, 45_000),
        silent: true,
      });
      const cookies = await contextCookies(context, origin);
      const user = await fetchUser(origin, grant.token, cookies, ctx.config.timeoutMs);
      return accept(buildSession(origin, grant, cookies, user.studentNumber));
    });
  } catch (error) {
    if (error instanceof TudelftError && error.code === 'ACCOUNT_CHANGED') throw error;
    return false;
  }
}
