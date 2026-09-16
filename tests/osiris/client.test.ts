import { readFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SessionStore } from '../../src/auth/session.js';
import { loadConfig } from '../../src/config.js';
import { OsirisClient, parsePage, statusMessages } from '../../src/osiris/client.js';
import { sha256 } from '../../src/util/text.js';

const page1 = JSON.parse(
  readFileSync(new URL('../fixtures/osiris-resultaten-page1.json', import.meta.url), 'utf8'),
);
const page2 = JSON.parse(
  readFileSync(new URL('../fixtures/osiris-resultaten-page2.json', import.meta.url), 'utf8'),
);
const news = JSON.parse(readFileSync(new URL('../fixtures/osiris-nieuws.json', import.meta.url), 'utf8'));

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
    data.osiris = {
      origin: config.osirisUrl,
      token: 'token-1',
      expiresAt: null,
      cookies: [
        {
          name: 'sessionCookie',
          value: 's',
          domain: 'my.tudelft.nl',
          path: '/',
          expires: -1,
          httpOnly: true,
          secure: true,
        },
      ],
      studentHash: sha256('1234567'),
      savedAt: new Date().toISOString(),
    };
  });
  return { client: new OsirisClient(config, store, renewer), store };
}

afterEach(() => vi.restoreAllMocks());

describe('OsirisClient', () => {
  it('rejects paths outside the allowlist before any request', async () => {
    const { client } = await makeClient();
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    for (const path of [
      '/token',
      '/student/osiris/token',
      '/../gebruiker',
      '/gebruiker/../student/personalia',
      'student/resultaten',
      '/student/resultaten?foo=1',
      '/student/inschrijvingen/cursussen/../x',
      '/student/whatever',
      '/student/inschrijvingen/cursussen/scbl:1/extra',
    ]) {
      await expect(client.request(path)).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    }
    await expect(client.request('/student/resultaten', 'POST', {})).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
    });
    await expect(client.request('/student/inschrijvingen/toetsen/', 'PUT', {})).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('accepts every documented route', async () => {
    const { client } = await makeClient();
    for (const [method, path] of [
      ['GET', '/gebruiker'],
      ['GET', '/student/personalia'],
      ['GET', '/student/resultaten/sres:1'],
      ['GET', '/student/voortgang/per_opleiding/?offset=0&limit=50'],
      ['GET', '/student/voortgang/sopl:12:exty:9/onderwijsprogramma'],
      ['GET', '/student/voortgang/sopl:12:exty:9/studieadviezen?offset=0&limit=10'],
      ['GET', '/student/inschrijvingen/specialisaties?toon_historie=J&zoekstring=EE'],
      ['GET', '/student/inschrijvingen/toetsen/scto:123'],
      ['GET', '/student/cursussen_voor_toetsinschrijving/te_volgen_onderwijs/open_voor_inschrijving/'],
      ['GET', '/student/cursussen_voor_cursusinschrijving/gepland_onderwijs/'],
      ['GET', '/student/cursussen_voor_cursusinschrijving/scbl:900/controleren'],
      ['GET', '/student/cursussen_voor_cursusinschrijving/scur:77/blokken_voor_cursusinschrijving'],
      ['POST', '/student/cursussen_voor_toetsinschrijving/zoeken'],
      ['PUT', '/student/inschrijvingen/cursussen/scbl:900'],
      ['POST', '/student/inschrijvingen/toetsen/'],
      ['DELETE', '/student/inschrijvingen/toetsen/scto:123'],
      ['GET', '/student/rooster'],
      ['GET', '/student/nieuws'],
    ] as const) {
      expect(client.resolve(path, method).href).toBe(`https://my.tudelft.nl/student/osiris${path}`);
    }
  });

  it('sends the OSIRIS headers with the token and cookies', async () => {
    const { client } = await makeClient();
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      expect(String(input)).toBe('https://my.tudelft.nl/student/osiris/gebruiker');
      const headers = new Headers(init?.headers);
      expect(headers.get('authorization')).toBe('Bearer token-1');
      expect(headers.get('accept')).toBe('application/json');
      expect(headers.get('taal')).toBe('EN');
      expect(headers.get('client_type')).toBe('web');
      expect(headers.get('cookie')).toBe('sessionCookie=s');
      return json({ studentnummer: '1234567' });
    });
    expect(await client.request('/gebruiker')).toEqual({ studentnummer: '1234567' });
  });

  it('renews once on 401 and retries with the new token', async () => {
    let renewed = 0;
    const { client, store } = await makeClient(async () => {
      renewed++;
      await store.update((data) => {
        data.osiris!.token = 'token-2';
      });
      return true;
    });
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      const auth = new Headers(init?.headers).get('authorization');
      if (auth === 'Bearer token-1') return new Response('', { status: 401 });
      return json({ ok: true });
    });
    expect(await client.request('/gebruiker')).toEqual({ ok: true });
    expect(renewed).toBe(1);
  });

  it('reports OSIRIS_AUTH_REQUIRED when renewal fails and rate limits further attempts', async () => {
    let attempts = 0;
    const { client } = await makeClient(async () => {
      attempts++;
      return false;
    });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 401 }));
    await expect(client.request('/gebruiker')).rejects.toMatchObject({ code: 'OSIRIS_AUTH_REQUIRED' });
    await expect(client.request('/gebruiker')).rejects.toMatchObject({ code: 'OSIRIS_AUTH_REQUIRED' });
    expect(attempts).toBe(1);
  });

  it('maps 403, 404 and 501', async () => {
    const { client } = await makeClient();
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith('/student/rooster')) return new Response('', { status: 501 });
      if (url.endsWith('/student/personalia')) return new Response('', { status: 403 });
      return new Response('', { status: 404 });
    });
    await expect(client.request('/student/rooster')).rejects.toMatchObject({
      code: 'UNAVAILABLE',
      details: { status: 501, reason: 'not implemented by the university' },
    });
    await expect(client.request('/student/personalia')).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    await expect(client.request('/student/contactgegevens')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('never retries writes and reports OUTCOME_UNKNOWN on network failure', async () => {
    const { client } = await makeClient();
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('socket hang up'));
    await expect(
      client.request('/student/inschrijvingen/toetsen/', 'POST', { toetsen: [] }),
    ).rejects.toMatchObject({ code: 'OUTCOME_UNKNOWN' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fetchMock.mockResolvedValue(new Response('', { status: 503 }));
    await expect(client.request('/student/inschrijvingen/toetsen/scto:1', 'DELETE')).rejects.toMatchObject({
      code: 'OUTCOME_UNKNOWN',
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('caps responses at 2 MB', async () => {
    const { client } = await makeClient();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('x', {
        status: 200,
        headers: { 'content-type': 'application/json', 'content-length': String(3 * 1024 * 1024) },
      }),
    );
    await expect(client.request('/gebruiker')).rejects.toMatchObject({ code: 'FILE_TOO_LARGE' });
  });

  it('pages and follows hasMore', async () => {
    const { client } = await makeClient();
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = new URL(String(input));
      expect(url.pathname).toBe('/student/osiris/student/resultaten');
      return json(url.searchParams.get('offset') === '0' ? page1 : page2);
    });
    const page = await client.page('/student/resultaten', { offset: 0, limit: 2 });
    expect(page).toMatchObject({ offset: 0, limit: 2, hasMore: true, nextOffset: 2, count: 3 });
    expect(page.items).toHaveLength(2);
    const all = await client.all('/student/resultaten');
    expect(all.items).toHaveLength(3);
    expect(all.complete).toBe(true);
  });

  it('reads public news without a token or session', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tudelft-'));
    const config = loadConfig({ TUDELFT_MCP_HOME: dir });
    const client = new OsirisClient(config, new SessionStore(config.sessionFile, 'linux'), async () => false);
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      expect(String(input)).toBe('https://my.tudelft.nl/student/osiris/student/nieuws?offset=0&limit=50');
      expect(new Headers(init?.headers).get('authorization')).toBeNull();
      return json(news);
    });
    const page = await client.page('/student/nieuws', {}, { anonymous: true });
    expect(page.items).toHaveLength(1);
    await expect(client.request('/gebruiker')).rejects.toMatchObject({ code: 'OSIRIS_AUTH_REQUIRED' });
  });

  it('parses list envelopes and status messages', () => {
    expect(parsePage([1, 2], 0, 10)).toEqual({ items: [1, 2], offset: 0, limit: 10, hasMore: false });
    expect(() => parsePage({ nope: true }, 0, 10)).toThrow(/unfamiliar/);
    expect(
      statusMessages({
        statusmeldingen: [
          { type: 'E', tekst: 'Too late' },
          { type: 'I', melding: 'Info' },
        ],
      }),
    ).toEqual([
      { type: 'E', text: 'Too late' },
      { type: 'I', text: 'Info' },
    ]);
  });
});
