import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  decodeDevalue,
  notices,
  parseRooms,
  parseSoftware,
  parseSoftwareDetail,
  parseSpaces,
  rooms,
  software,
  softwareDetail,
  spaces,
} from '../../src/public/campus.js';
import { fetchPublic, publicUrl } from '../../src/public/http.js';

const read = (name: string): string => readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8');

function html(body: string): Response {
  return new Response(body, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
}
function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

afterEach(() => vi.restoreAllMocks());

describe('public URL allowlist', () => {
  it('accepts the known sites and rejects everything else', () => {
    expect(publicUrl('https://esviewer.tudelft.nl/').href).toBe('https://esviewer.tudelft.nl/');
    expect(publicUrl('https://softwarefinder.tudelft.nl/package/matlab/').pathname).toBe('/package/matlab/');
    expect(() => publicUrl('https://esviewer.tudelft.nl/admin')).toThrow(/allowlist/);
    expect(() => publicUrl('https://example.com/')).toThrow(/allowlist/);
    expect(() => publicUrl('https://brightspace.tudelft.nl/d2l/home')).toThrow(/allowlist/);
    expect(() => publicUrl('not a url')).toThrow(/not valid/);
  });
  it('caps the body size', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('x', { status: 200, headers: { 'content-length': String(3 * 1024 * 1024) } }),
    );
    await expect(fetchPublic('https://esviewer.tudelft.nl/')).rejects.toMatchObject({
      code: 'FILE_TOO_LARGE',
    });
  });
});

describe('rooms', () => {
  it('parses the room viewer table', () => {
    const list = parseRooms(read('esviewer.html'));
    expect(list).toHaveLength(3);
    expect(list[0]).toEqual({
      id: 'EWI-Lecture-Hall-A',
      name: 'Lecture Hall A',
      building: 'EEMCS',
      type: 'Lecture hall',
      seats: 300,
      examSeats: 150,
      computers: 0,
      furniture: 'Fixed rows',
      presentation: 'Two beamers, whiteboard',
      facilities: 'Wifi, power sockets',
      software: 'None',
      buildingNumber: '36',
      url: 'https://esviewer.tudelft.nl/space/EWI-Lecture-Hall-A',
    });
  });
  it('filters and pages', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => html(read('esviewer.html')));
    const result = await rooms('library matlab');
    expect(result.items).toEqual([expect.objectContaining({ id: 'Library-PC-Room' })]);
    expect(result).toMatchObject({ total: 1, complete: true });
    const all = await rooms(undefined, 2);
    expect(all.items).toHaveLength(1);
    expect(all.offset).toBe(2);
  });
});

describe('software', () => {
  it('parses cards without duplicates and reads a package page', () => {
    const list = parseSoftware(read('softwarefinder.html'));
    expect(list.map((entry) => entry.id)).toEqual(['matlab', 'ltspice', 'solidworks']);
    expect(list[0]).toMatchObject({
      name: 'MATLAB',
      url: 'https://softwarefinder.tudelft.nl/package/matlab/',
    });
    const detail = parseSoftwareDetail(read('softwarefinder-package.html'), 'matlab');
    expect(detail.name).toBe('MATLAB');
    expect(String(detail.text)).toContain('campus licence');
    expect(String(detail.text)).not.toContain('token=abc123');
    expect(detail.links).toEqual(['https://software.tudelft.nl/matlab']);
  });
  it('searches and fetches details through the allowlist', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url === 'https://softwarefinder.tudelft.nl/') return html(read('softwarefinder.html'));
      if (url === 'https://softwarefinder.tudelft.nl/package/matlab/')
        return html(read('softwarefinder-package.html'));
      throw new Error(`unexpected ${url}`);
    });
    const result = await software('spice');
    expect(result.items).toEqual([expect.objectContaining({ id: 'ltspice' })]);
    expect((await softwareDetail('matlab')).name).toBe('MATLAB');
    await expect(softwareDetail('../etc')).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });
});

describe('spaces', () => {
  it('decodes devalue payloads', () => {
    expect(decodeDevalue([{ a: 1, b: 2 }, 'x', [3, 3], 42])).toEqual({ a: 'x', b: [42, 42] });
    expect(decodeDevalue([['Ref', 1], { n: -1 }])).toEqual({ n: undefined });
    const cyclic: unknown[] = [{ self: 0 }];
    const decoded = decodeDevalue(cyclic) as { self: unknown };
    expect(decoded.self).toBe(decoded);
  });
  it('parses the Nuxt store and resolves buildings', () => {
    const list = parseSpaces(read('spacefinder.html'));
    expect(list).toHaveLength(2);
    expect(list[0]).toMatchObject({
      id: 'sp-1',
      name: 'Library silent study',
      building: 'Library',
      capacity: 24,
      type: 'Silent',
      url: 'https://spacefinder.tudelft.nl/en/spaces/sp-1',
    });
    expect(list[1]).toMatchObject({ id: 'sp-2', name: 'Library group room', type: 'Group', capacity: 6 });
  });
  it('searches through the allowlist', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => html(read('spacefinder.html')));
    const result = await spaces('group');
    expect(result.items).toEqual([expect.objectContaining({ id: 'sp-2' })]);
  });
});

describe('ICT notices', () => {
  it('maps and pages through the incidents feed', async () => {
    const urls: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      urls.push(url);
      return json(
        url.includes('page=2')
          ? JSON.parse(read('ict-incidents-page2.json'))
          : JSON.parse(read('ict-incidents-page1.json')),
      );
    });
    const first = await notices('incidents', 1);
    expect(urls[0]).toBe('https://meldingen-ict.tudelft.nl/api/incidents/?format=json&page=1');
    expect(first).toMatchObject({
      kind: 'incidents',
      page: 1,
      count: 3,
      nextPage: 2,
      previousPage: undefined,
      complete: false,
    });
    expect(first.items).toEqual([
      {
        id: '9001',
        title: 'Brightspace slow to load',
        description: 'Brightspace pages load slowly for some users. See status.',
        closed: false,
        createdAt: '2026-09-15T08:12:00+02:00',
        from: '2026-09-15T08:00:00+02:00',
        period: 'Since 08:00',
        impact: 'Medium',
        updates: [
          {
            date: '2026-09-15T09:00:00+02:00',
            status: 'Investigating',
            description: 'We are investigating.',
          },
        ],
      },
      expect.objectContaining({ id: '9002', closed: true, impact: 'High', updates: [] }),
    ]);
    const second = await notices('incidents', 2);
    expect(second).toMatchObject({ page: 2, nextPage: undefined, previousPage: 1, complete: true });
    expect(second.items).toHaveLength(1);
  });
});
