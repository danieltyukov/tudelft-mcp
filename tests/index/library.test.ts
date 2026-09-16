import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { chunkText, Library, readTarget } from '../../src/index/library.js';

describe('Library', () => {
  it('indexes, searches, persists and clears', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tudelft-'));
    const file = join(dir, 'index.json');
    const library = new Library(file);
    await library.put({
      id: '1:topic:10',
      courseId: '1',
      kind: 'file',
      title: 'Lecture 3 Nyquist',
      url: 'https://x/1',
      text: 'The Nyquist stability criterion relates the open-loop frequency response to closed-loop poles. '.repeat(
        30,
      ),
      fetchedAt: '2026-09-16T00:00:00.000Z',
    });
    await library.put({
      id: '2:news:5',
      courseId: '2',
      kind: 'announcement',
      title: 'Room change',
      url: 'https://x/2',
      text: 'The exam moved to hall B.',
      fetchedAt: '2026-09-16T00:00:00.000Z',
    });
    const hits = await library.search('nyquist stability');
    expect(hits[0]?.id).toBe('1:topic:10');
    expect(hits[0]?.snippet).toMatch(/Nyquist/);
    expect(hits[0]?.readWith).toEqual({ tool: 'read_material', arguments: { courseId: '1', topicId: '10' } });
    expect((await library.search('nyquist', { courseId: '2' })).length).toBe(0);
    expect((await library.search('exam moved')).map((h) => h.id)).toEqual(['2:news:5']);
    const reloaded = new Library(file);
    expect((await reloaded.search('nyquist')).length).toBe(1);
    expect((await reloaded.coverage()).map((c) => `${c.courseId}:${c.kind}`)).toEqual([
      '1:file',
      '2:announcement',
    ]);
    expect(await reloaded.clear('1')).toBe(1);
    expect((await reloaded.search('nyquist')).length).toBe(0);
    expect(await reloaded.has('2:news:5')).toBe(true);
  });
  it('replaces a document on re-index', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tudelft-'));
    const library = new Library(join(dir, 'i.json'));
    await library.put({
      id: 'a:topic:1',
      courseId: 'a',
      kind: 'file',
      title: 't',
      url: 'u',
      text: 'alpha beta',
      fetchedAt: '2026-01-01T00:00:00.000Z',
    });
    await library.put({
      id: 'a:topic:1',
      courseId: 'a',
      kind: 'file',
      title: 't',
      url: 'u',
      text: 'gamma delta',
      fetchedAt: '2026-01-02T00:00:00.000Z',
    });
    expect((await library.search('alpha')).length).toBe(0);
    expect((await library.search('gamma')).length).toBe(1);
    expect(library.size).toBe(1);
  });
});

describe('chunkText', () => {
  it('splits long text with overlap on line boundaries', () => {
    const text = Array.from({ length: 200 }, (_, i) => `line ${i} `.padEnd(40, 'x')).join('\n');
    const chunks = chunkText(text);
    expect(chunks.length).toBeGreaterThan(3);
    expect(chunks.every((c) => c.length <= 1400)).toBe(true);
    expect(chunks[1]).toContain(chunks[0]!.slice(-30).trim().split('\n').at(-1)!);
  });
  it('maps ids to read tools', () => {
    expect(readTarget('5:newsfile:7:9', '5')).toEqual({
      tool: 'read_announcement_attachment',
      arguments: { courseId: '5', announcementId: '7', fileId: '9' },
    });
    expect(readTarget('5:topic:7', '6')).toBeUndefined();
  });
});
