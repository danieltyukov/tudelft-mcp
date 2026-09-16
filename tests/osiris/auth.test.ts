import { readFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  assertSameStudent,
  parseStoredToken,
  parseTokenResponse,
  renewOsiris,
  verifyUser,
} from '../../src/auth/osiris-auth.js';
import { loadConfig } from '../../src/config.js';
import { createContext } from '../../src/context.js';
import { TudelftError } from '../../src/errors.js';
import { installExtensions } from '../../src/extensions.js';
import { sha256 } from '../../src/util/text.js';

const user = JSON.parse(readFileSync(new URL('../fixtures/osiris-gebruiker.json', import.meta.url), 'utf8'));

function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  });
}

async function makeContext(withCookies = true) {
  const dir = await mkdtemp(join(tmpdir(), 'tudelft-'));
  const ctx = createContext(loadConfig({ TUDELFT_MCP_HOME: dir }));
  installExtensions(ctx);
  await ctx.session.update((data) => {
    data.brightspace = {
      origin: ctx.config.brightspaceUrl,
      cookies: [],
      identity: { id: '1', name: 'Test Student', uniqueName: 'tstudent', orgDefinedId: '1234567' },
      savedAt: new Date().toISOString(),
    };
    data.osiris = {
      origin: ctx.config.osirisUrl,
      token: 'old-token',
      expiresAt: null,
      cookies: withCookies
        ? [
            {
              name: 'sessionCookie',
              value: 'abc',
              domain: 'my.tudelft.nl',
              path: '/',
              expires: -1,
              httpOnly: true,
              secure: true,
            },
          ]
        : [],
      studentHash: sha256('1234567'),
      savedAt: new Date().toISOString(),
    };
  });
  return ctx;
}

afterEach(() => vi.restoreAllMocks());

describe('token capture parsing', () => {
  it('parses the token endpoint response', () => {
    const grant = parseTokenResponse(
      { access_token: 'abc.def', expires_in: 3600, token_type: 'Bearer' },
      1000,
    );
    expect(grant).toEqual({ token: 'abc.def', expiresAt: 3_601_000 });
    expect(parseTokenResponse({ access_token: 'abc' })?.expiresAt).toBeNull();
    expect(parseTokenResponse({ token_type: 'Bearer' })).toBeUndefined();
    expect(parseTokenResponse('nope')).toBeUndefined();
  });
  it('reads sessionStorage values stored bare or as JSON', () => {
    expect(parseStoredToken('abc.def')).toBe('abc.def');
    expect(parseStoredToken('"abc.def"')).toBe('abc.def');
    expect(parseStoredToken('{"access_token":"abc.def"}')).toBe('abc.def');
    expect(parseStoredToken('')).toBeUndefined();
    expect(parseStoredToken(null)).toBeUndefined();
    expect(parseStoredToken('{broken')).toBeUndefined();
  });
  it('verifies the user record', () => {
    expect(verifyUser(user)).toEqual({
      studentNumber: '1234567',
      name: 'Test Student',
      email: 't.student@student.tudelft.nl',
    });
    expect(() => verifyUser({ ...user, toegang_applicatie: 'N' })).toThrow(TudelftError);
    expect(() => verifyUser({ studentnummer: 'abc' })).toThrow(/student number/);
    expect(verifyUser({ studentnummer: 4567 }).studentNumber).toBe('4567');
  });
  it('detects a different student than the Brightspace account', () => {
    expect(() => assertSameStudent('1234567', '1234567')).not.toThrow();
    expect(() => assertSameStudent('netid', '1234567')).not.toThrow();
    expect(() => assertSameStudent(undefined, '1234567')).not.toThrow();
    expect(() => assertSameStudent('7654321', '1234567')).toThrow(/different|not the same/);
  });
});

describe('renewOsiris', () => {
  it('renews through the cookie POST and keeps the new cookies', async () => {
    const ctx = await makeContext();
    const calls: Array<{ url: string; method: string; cookie: string | null; body: string | undefined }> = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      const headers = new Headers(init?.headers);
      calls.push({
        url,
        method: init?.method ?? 'GET',
        cookie: headers.get('cookie'),
        body: typeof init?.body === 'string' ? init.body : undefined,
      });
      if (url.endsWith('/student/osiris/token')) {
        return json(
          { access_token: 'new-token', expires_in: 900, token_type: 'Bearer' },
          {
            headers: {
              'content-type': 'application/json',
              'set-cookie': 'sessionCookie=def; Path=/; Secure; HttpOnly',
            },
          },
        );
      }
      if (url.endsWith('/student/osiris/gebruiker')) {
        expect(headers.get('authorization')).toBe('Bearer new-token');
        return json(user);
      }
      throw new Error(`unexpected ${url}`);
    });
    const withContext = vi.spyOn(ctx.browser, 'withContext');
    expect(await renewOsiris(ctx)).toBe(true);
    expect(withContext).not.toHaveBeenCalled();
    expect(calls[0]).toMatchObject({
      url: 'https://my.tudelft.nl/student/osiris/token',
      method: 'POST',
      cookie: 'sessionCookie=abc',
      body: '{}',
    });
    const saved = (await ctx.session.load()).osiris!;
    expect(saved.token).toBe('new-token');
    expect(saved.expiresAt).toBeGreaterThan(Date.now());
    expect(saved.cookies.find((c) => c.name === 'sessionCookie')?.value).toBe('def');
    expect(saved.studentHash).toBe(sha256('1234567'));
  });

  it('throws ACCOUNT_CHANGED when another student appears', async () => {
    const ctx = await makeContext();
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith('/token')) return json({ access_token: 'new-token' });
      return json({ ...user, studentnummer: '7654321' });
    });
    await expect(renewOsiris(ctx)).rejects.toMatchObject({ code: 'ACCOUNT_CHANGED' });
  });

  it('falls back to the browser and reports false when that is unavailable', async () => {
    const ctx = await makeContext(false);
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    const withContext = vi
      .spyOn(ctx.browser, 'withContext')
      .mockRejectedValue(new TudelftError('BROWSER_NOT_FOUND', 'no browser'));
    expect(await renewOsiris(ctx)).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(withContext).toHaveBeenCalledTimes(1);
    expect((await ctx.session.load()).osiris?.token).toBe('old-token');
  });

  it('returns false without a saved OSIRIS session', async () => {
    const ctx = await makeContext();
    await ctx.session.update((data) => {
      delete data.osiris;
    });
    expect(await renewOsiris(ctx)).toBe(false);
  });
});
