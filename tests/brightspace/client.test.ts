import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SessionStore } from '../../src/auth/session.js';
import { BrightspaceClient } from '../../src/brightspace/client.js';
import { loadConfig } from '../../src/config.js';

const versions = [
  { ProductCode: 'lp', LatestVersion: '1.63' },
  { ProductCode: 'le', LatestVersion: '1.97' },
];

function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  });
}

async function makeClient(renewer = async () => false) {
  const dir = await mkdtemp(join(tmpdir(), 'tudelft-'));
  const config = loadConfig({ TUDELFT_MCP_HOME: dir });
  const store = new SessionStore(config.sessionFile, 'linux');
  await store.update((data) => {
    data.brightspace = {
      origin: config.brightspaceUrl,
      cookies: [
        {
          name: 'd2lSessionVal',
          value: 's',
          domain: 'brightspace.tudelft.nl',
          path: '/',
          expires: -1,
          httpOnly: true,
          secure: true,
        },
      ],
      bearer: 'bearer-1',
      identity: { id: '1', name: 'T', uniqueName: 't' },
      savedAt: new Date().toISOString(),
    };
  });
  return { client: new BrightspaceClient(config, store, renewer), store };
}

afterEach(() => vi.restoreAllMocks());

describe('BrightspaceClient', () => {
  it('sends cookies and bearer to API paths and follows bookmark pagination', async () => {
    const { client } = await makeClient();
    const calls: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith('/d2l/api/versions/')) return json(versions);
      const headers = new Headers(init?.headers);
      expect(headers.get('cookie')).toBe('d2lSessionVal=s');
      expect(headers.get('authorization')).toBe('Bearer bearer-1');
      if (url.includes('bookmark=b1'))
        return json({ PagingInfo: { Bookmark: 'b2', HasMoreItems: false }, Items: [{ n: 2 }] });
      return json({ PagingInfo: { Bookmark: 'b1', HasMoreItems: true }, Items: [{ n: 1 }] });
    });
    const result = await client.list('lp', 'enrollments/myenrollments/', { orgUnitTypeId: '3' });
    expect(result.items).toEqual([{ n: 1 }, { n: 2 }]);
    expect(result.complete).toBe(true);
    expect(calls.filter((c) => c.includes('myenrollments')).length).toBe(2);
  });

  it('follows Objects/Next pagination', async () => {
    const { client } = await makeClient();
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith('/d2l/api/versions/')) return json(versions);
      if (url.includes('page=2')) return json({ Objects: [{ id: 2 }], Next: null });
      return json({
        Objects: [{ id: 1 }],
        Next: 'https://brightspace.tudelft.nl/d2l/api/le/1.97/1/quizzes/?page=2',
      });
    });
    const result = await client.list('le', '1/quizzes/');
    expect(result.items.map((i) => (i as { id: number }).id)).toEqual([1, 2]);
  });

  it('renews once on 401 and retries with the new session', async () => {
    let renewed = false;
    const { client, store } = await makeClient(async () => {
      renewed = true;
      await store.update((data) => {
        data.brightspace!.bearer = 'bearer-2';
      });
      return true;
    });
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith('/d2l/api/versions/')) return json(versions);
      const auth = new Headers(init?.headers).get('authorization');
      if (auth === 'Bearer bearer-1') return new Response('', { status: 401 });
      return json({ Identifier: '1' });
    });
    expect(await client.get('lp', 'users/whoami')).toEqual({ Identifier: '1' });
    expect(renewed).toBe(true);
  });

  it('reports AUTH_REQUIRED when renewal fails', async () => {
    const { client } = await makeClient(async () => false);
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith('/d2l/api/versions/')) return json(versions);
      return new Response('<html><input type="password"></html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      });
    });
    await expect(client.get('lp', 'users/whoami')).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
  });

  it('retries 5xx with backoff and maps 403/404', async () => {
    const { client } = await makeClient();
    let attempts = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith('/d2l/api/versions/')) return json(versions);
      if (url.includes('flaky'))
        return ++attempts < 2 ? new Response('', { status: 503 }) : json({ ok: true });
      if (url.includes('forbidden')) return new Response('', { status: 403 });
      return new Response('', { status: 404 });
    });
    expect(await client.get('le', '1/flaky')).toEqual({ ok: true });
    await expect(client.get('le', '1/forbidden')).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    await expect(client.get('le', '1/missing')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('rejects paths outside the API', async () => {
    const { client } = await makeClient();
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => json(versions));
    await expect(client.get('lp', '../../d2l/home')).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    await expect(client.getUrl('https://brightspace.tudelft.nl/d2l/home')).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
    });
  });
});

describe('403 handling', () => {
  it('renews when a 403 comes with a dead session, but reports PERMISSION_DENIED when the session is alive', async () => {
    let renewals = 0;
    const { client, store } = await makeClient(async () => {
      renewals++;
      await store.update((data) => {
        data.brightspace!.bearer = 'bearer-2';
      });
      return true;
    });
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith('/d2l/api/versions/')) return json(versions);
      const auth = new Headers(init?.headers).get('authorization');
      if (url.endsWith('/users/whoami'))
        return auth === 'Bearer bearer-2' ? json({ Identifier: '1' }) : new Response('', { status: 403 });
      if (url.includes('/courses/')) return new Response('', { status: 403 });
      return json({ ok: true });
    });
    expect(await client.get('lp', 'users/whoami')).toEqual({ Identifier: '1' });
    expect(renewals).toBe(1);
    await expect(client.get('lp', 'courses/5')).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    expect(renewals).toBe(1);
  });
});
