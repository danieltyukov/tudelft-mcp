import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cookieHeader, SessionStore, type BrightspaceSession } from '../../src/auth/session.js';

const session: BrightspaceSession = {
  origin: 'https://brightspace.tudelft.nl',
  cookies: [
    {
      name: 'd2lSessionVal',
      value: 'abc',
      domain: 'brightspace.tudelft.nl',
      path: '/',
      expires: -1,
      httpOnly: true,
      secure: true,
    },
    {
      name: 'old',
      value: 'x',
      domain: 'brightspace.tudelft.nl',
      path: '/',
      expires: 1,
      httpOnly: true,
      secure: true,
    },
    {
      name: 'surf',
      value: 'y',
      domain: '.surfconext.nl',
      path: '/',
      expires: -1,
      httpOnly: true,
      secure: true,
    },
    {
      name: 'scoped',
      value: 'z',
      domain: 'brightspace.tudelft.nl',
      path: '/d2l/api',
      expires: -1,
      httpOnly: false,
      secure: true,
    },
  ],
  identity: { id: '123', name: 'Test Student', uniqueName: 'tstudent' },
  savedAt: '2026-09-16T00:00:00.000Z',
};

describe('SessionStore', () => {
  it('round-trips data with owner-only permissions', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tudelft-'));
    const store = new SessionStore(join(dir, 'session.json'), 'linux');
    expect((await store.load()).brightspace).toBeUndefined();
    await store.update((data) => {
      data.brightspace = session;
    });
    const fresh = new SessionStore(join(dir, 'session.json'), 'linux');
    expect((await fresh.load()).brightspace?.identity.id).toBe('123');
    if (process.platform !== 'win32') {
      const mode = (await stat(join(dir, 'session.json'))).mode & 0o777;
      expect(mode).toBe(0o600);
    }
    const raw = JSON.parse(await readFile(join(dir, 'session.json'), 'utf8')) as { format: string };
    expect(raw.format).toBe('plain-v1');
    await fresh.clear();
    expect((await fresh.load()).brightspace).toBeUndefined();
  });
  it('rejects a damaged file with a clear error', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tudelft-'));
    const file = join(dir, 'session.json');
    const { writeFile } = await import('node:fs/promises');
    await writeFile(file, '{"format":"dpapi-v1","value":"x"}');
    await expect(new SessionStore(file, 'linux').load()).rejects.toThrow(/damaged/);
  });
});

describe('cookieHeader', () => {
  it('sends only matching, unexpired cookies', () => {
    expect(cookieHeader(session.cookies, new URL('https://brightspace.tudelft.nl/d2l/home'))).toBe(
      'd2lSessionVal=abc',
    );
    expect(
      cookieHeader(session.cookies, new URL('https://brightspace.tudelft.nl/d2l/api/lp/1.63/users/whoami')),
    ).toBe('d2lSessionVal=abc; scoped=z');
    expect(cookieHeader(session.cookies, new URL('https://engine.surfconext.nl/x'))).toBe('surf=y');
  });
});
