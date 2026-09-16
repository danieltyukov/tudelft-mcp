import { readFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SessionStore } from '../../src/auth/session.js';
import { connectTimetable, disconnectTimetable, timetableFeedUrl } from '../../src/auth/timetable-auth.js';
import { loadConfig } from '../../src/config.js';
import { createContext } from '../../src/context.js';
import { installExtensions } from '../../src/extensions.js';
import { TimetableService } from '../../src/timetable/service.js';

const ics = readFileSync(new URL('../fixtures/mytimetable.ics', import.meta.url), 'utf8');
const FEED = 'https://mytimetable.tudelft.nl/ical?eu=ZXU=&h=aGFzaA==&t=0f0a0b0c-1111-2222-3333-444455556666';

function calendarResponse(): Response {
  return new Response(ics, { status: 200, headers: { 'content-type': 'text/calendar; charset=utf-8' } });
}

async function makeService() {
  const dir = await mkdtemp(join(tmpdir(), 'tudelft-'));
  const config = loadConfig({ TUDELFT_MCP_HOME: dir });
  const store = new SessionStore(config.sessionFile, 'linux');
  await store.update((data) => {
    data.timetable = { icalUrl: FEED, connectedAt: '2026-09-01T00:00:00.000Z' };
  });
  return { service: new TimetableService(config, store), store, config };
}

afterEach(() => vi.restoreAllMocks());

describe('timetableFeedUrl', () => {
  const origin = 'https://mytimetable.tudelft.nl';
  it('accepts the personal subscription link', () => {
    expect(timetableFeedUrl(FEED, origin).href).toBe(FEED);
    expect(timetableFeedUrl(`  ${FEED}#x `, origin).href).toBe(FEED);
  });
  it('rejects other origins, paths, credentials and links without parameters', () => {
    expect(() => timetableFeedUrl('https://evil.example/ical?eu=1', origin)).toThrow(/must start with/);
    expect(() => timetableFeedUrl('https://mytimetable.tudelft.nl/m/?eu=1', origin)).toThrow(/ical feed/);
    expect(() => timetableFeedUrl('https://mytimetable.tudelft.nl/ical', origin)).toThrow(/parameters/);
    expect(() => timetableFeedUrl('https://user:pw@mytimetable.tudelft.nl/ical?eu=1', origin)).toThrow(
      /must start with/,
    );
    expect(() => timetableFeedUrl('https://mytimetable.tudelft.nl/ical?eu=1\nX', origin)).toThrow(/one line/);
    expect(() => timetableFeedUrl('nope', origin)).toThrow(/valid URL/);
  });
});

describe('TimetableService', () => {
  it('reports status without exposing the link', async () => {
    const { service } = await makeService();
    const status = await service.status();
    expect(status).toEqual({ configured: true, connectedAt: '2026-09-01T00:00:00.000Z' });
    expect(JSON.stringify(status)).not.toContain('ical?');
  });

  it('downloads once, caches, and expands the window in-process', async () => {
    const { service } = await makeService();
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      expect(String(input)).toBe(FEED);
      const headers = new Headers(init?.headers);
      expect(headers.get('cookie')).toBeNull();
      expect(headers.get('authorization')).toBeNull();
      return calendarResponse();
    });
    const first = await service.events('2026-03-01T00:00:00Z', '2026-04-30T00:00:00Z');
    expect(first.items.length).toBeGreaterThan(5);
    expect(first.from).toBe('2026-03-01T00:00:00.000Z');
    const second = await service.events('2026-04-14T00:00:00Z', '2026-04-17T00:00:00Z');
    expect(second.items.map((item) => item.uid)).toEqual(['exam@fixture', 'utc@fixture']);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('enforces the window limits and the connection requirement', async () => {
    const { service, store } = await makeService();
    await expect(service.events('2026-01-01T00:00:00Z', '2026-06-01T00:00:00Z')).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
    });
    await expect(service.events('2026-02-01T00:00:00Z', '2026-01-01T00:00:00Z')).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
    });
    await store.update((data) => {
      delete data.timetable;
    });
    await expect(service.events()).rejects.toMatchObject({ code: 'TIMETABLE_NOT_CONNECTED' });
  });

  it('maps a rejected link to TIMETABLE_NOT_CONNECTED and a non-calendar body to FORMAT_CHANGED', async () => {
    const { service } = await makeService();
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('{"error":"nope"}', { status: 404 }));
    await expect(service.events()).rejects.toMatchObject({ code: 'TIMETABLE_NOT_CONNECTED' });
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('<html>login</html>', { status: 200, headers: { 'content-type': 'text/html' } }),
    );
    await expect(service.events()).rejects.toMatchObject({ code: 'FORMAT_CHANGED' });
  });
});

describe('connectTimetable', () => {
  it('validates, probes and stores the link, then disconnects', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tudelft-'));
    const ctx = createContext(loadConfig({ TUDELFT_MCP_HOME: dir }));
    installExtensions(ctx);
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => calendarResponse());
    const result = await connectTimetable(ctx, FEED);
    expect(result.connected).toBe(true);
    expect(typeof result.eventsNext14Days).toBe('number');
    expect(JSON.stringify(result)).not.toContain('ical?');
    expect((await ctx.session.load()).timetable?.icalUrl).toBe(FEED);
    await expect(connectTimetable(ctx, 'https://mytimetable.tudelft.nl/ical')).rejects.toMatchObject({
      code: 'INVALID_URL',
    });
    expect(await disconnectTimetable(ctx)).toEqual({ connected: false, removed: true });
    expect((await ctx.session.load()).timetable).toBeUndefined();
  });
});
