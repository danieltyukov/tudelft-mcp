import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StudyGuide, currentAcademicYear, localized } from '../../src/public/studyguide.js';

const page1 = JSON.parse(
  readFileSync(new URL('../fixtures/studyguide-search-page1.json', import.meta.url), 'utf8'),
);
const page2 = JSON.parse(
  readFileSync(new URL('../fixtures/studyguide-search-page2.json', import.meta.url), 'utf8'),
);
const detail = JSON.parse(
  readFileSync(new URL('../fixtures/studyguide-detail.json', import.meta.url), 'utf8'),
);

const guide = new StudyGuide({
  studyGuideApiUrl: 'https://curriculum.tudelft.nl',
  studyGuideUrl: 'https://studyguide.tudelft.nl',
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

afterEach(() => vi.restoreAllMocks());

describe('StudyGuide', () => {
  it('computes the academic year from September', () => {
    expect(currentAcademicYear(new Date('2026-09-16T00:00:00Z'))).toBe('2026-2027');
    expect(currentAcademicYear(new Date('2026-05-01T00:00:00Z'))).toBe('2025-2026');
    expect(localized({ en: 'Hello', nl: 'Hallo' }, 'nl')).toBe('Hallo');
    expect(localized({ nl: 'Hallo' }, 'en')).toBe('Hallo');
    expect(localized([{ en: 'Q1' }, { en: 'Q3' }], 'en')).toBe('Q1, Q3');
  });

  it('searches with the year filter and reports paging', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      expect(String(input)).toBe(
        'https://curriculum.tudelft.nl/publisher/api/v0/courses/items/search?size=30&offset=0',
      );
      expect(init?.method).toBe('POST');
      expect(JSON.parse(String(init?.body))).toEqual({
        query: 'EE4109',
        filters: { jaar: ['2025-2026'] },
        language: 'en',
      });
      expect(new Headers(init?.headers).get('cookie')).toBeNull();
      return json(page1);
    });
    const result = await guide.search('EE4109', { academicYear: '2025-2026' });
    expect(result).toMatchObject({ total: 2, count: 1, nextOffset: 1, complete: false });
    expect(result.items).toEqual([
      expect.objectContaining({
        id: '70001',
        code: 'EE4109-EXTRA',
        name: 'Signal Processing Extra',
        credits: 3,
        url: 'https://studyguide.tudelft.nl/courses/study-guide/educations/70001',
      }),
    ]);
    await expect(guide.search('x', { academicYear: '2025' })).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
    });
  });

  it('resolves the exact code across search pages and renders the detail', async () => {
    const urls: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      urls.push(url);
      if (url.includes('/search?size=30&offset=0')) return json(page1);
      if (url.includes('/search?size=30&offset=1')) return json(page2);
      if (url.endsWith('/courses/items/70002')) return json(detail);
      throw new Error(`unexpected ${url}`);
    });
    const course = await guide.course('ee4109', { academicYear: '2025-2026' });
    expect(urls).toHaveLength(3);
    expect(course.course).toMatchObject({
      id: '70002',
      code: 'EE4109',
      name: 'Signal Processing',
      credits: 5,
      academicYear: '2025-2026',
      level: 'MSc',
      periods: 'Q1, Q3',
      languages: 'English',
      url: 'https://studyguide.tudelft.nl/courses/study-guide/educations/70002',
    });
    const description = course.sections.find((section) => section.key === 'description')!;
    expect(description.text).toContain('Discrete-time signals and systems, the DFT');
    expect(description.text).not.toContain('token=secret123');
    expect(description.links).toEqual(['https://example.tudelft.nl/course']);
    expect(course.sections.map((section) => section.key)).toEqual([
      'description',
      'learningObjectives',
      'teachingMethod',
      'assessment',
      'literature',
      'priorKnowledge',
    ]);
    expect(course.lecturers).toEqual([
      { name: 'Dr. A. Example', email: 'a.example@tudelft.nl', role: 'responsible' },
      { name: 'B. Voorbeeld', email: 'b.voorbeeld@tudelft.nl' },
    ]);
    expect(course.programmes).toEqual(['MSc Electrical Engineering', 'MSc Computer Engineering']);
    expect(course.truncated).toBe(false);
  });

  it('reports NOT_FOUND when no exact code matches within three pages', async () => {
    let calls = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      calls++;
      return json({ ...page1, meta: { total: 500, offset: 0, size: 30 } });
    });
    await expect(guide.course('EE9999', { academicYear: '2025-2026' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(calls).toBe(3);
  });

  it('bounds the rendered output', () => {
    const data = structuredClone(detail.data.attributes.data) as Record<string, unknown>;
    data.vakbeschrijving = { en: `<p>${'word '.repeat(20_000)}</p>` };
    data.leerdoelen = { en: `<p>${'goal '.repeat(20_000)}</p>` };
    data.toetsing = { en: `<p>${'test '.repeat(20_000)}</p>` };
    const course = guide.render('70002', data, '2025-2026', 'en');
    const total = course.sections.reduce((sum, section) => sum + section.text.length, 0);
    expect(total).toBeLessThanOrEqual(48_000 + 200);
    expect(course.truncated).toBe(true);
  });
});
