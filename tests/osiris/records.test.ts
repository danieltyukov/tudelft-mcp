import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { clock, mapGrade, mapNews, sanitize, summarise } from '../../src/osiris/records.js';

const page1 = JSON.parse(
  readFileSync(new URL('../fixtures/osiris-resultaten-page1.json', import.meta.url), 'utf8'),
);
const exam = JSON.parse(
  readFileSync(new URL('../fixtures/osiris-exam-details.json', import.meta.url), 'utf8'),
);
const news = JSON.parse(readFileSync(new URL('../fixtures/osiris-nieuws.json', import.meta.url), 'utf8'));
const user = JSON.parse(readFileSync(new URL('../fixtures/osiris-gebruiker.json', import.meta.url), 'utf8'));

describe('OSIRIS records', () => {
  it('maps results to English field names', () => {
    expect(mapGrade(page1.items[0])).toEqual({
      id: 'sres:501',
      courseCode: 'EE4790',
      courseName: 'Circuit Fundamentals',
      courseId: 'scur:77',
      assessment: 'Written exam',
      assessmentCode: 'WEX',
      result: '8.5',
      resultDescription: '8.5',
      score: 85,
      weight: 70,
      assessmentDate: '2026-04-15',
      updatedAt: '2026-04-28',
      academicYear: '2025',
      credits: 5,
    });
    const pass = mapGrade(page1.items[1]);
    expect(pass.score).toBeUndefined();
    expect(pass.result).toBe('V');
    expect(pass.resultDescription).toBe('Pass');
  });

  it('renders decimal clock values', () => {
    expect(clock(13.3)).toBe('13:30');
    expect(clock(9)).toBe('09:00');
    expect(clock(9.05)).toBe('09:05');
    expect(clock('13.45')).toBe('13:45');
    expect(clock('8:15')).toBe('08:15');
    expect(clock(25)).toBeUndefined();
    expect(clock('later')).toBeUndefined();
    expect(clock(null)).toBeUndefined();
  });

  it('summarises exam opportunities with times and keeps the raw data', () => {
    const summary = summarise(exam.toetsen[0], ['id_toets_gelegenheid']);
    expect(summary).toMatchObject({
      id: 'scto:123',
      assessment: 'Written exam',
      assessmentCode: 'WEX',
      assessmentDate: '2026-10-28',
      startTime: '13:30',
      endTime: '16:00',
      location: 'Aula',
      registered: false,
      openForRegistration: true,
      registrationAllowed: true,
      availablePlaces: 40,
    });
    expect(summary.data.id_toets_gelegenheid).toBe('scto:123');
  });

  it('strips photos, credentials and blobs', () => {
    const cleaned = sanitize({
      ...user,
      wachtwoord: 'x',
      nested: { access_token: 'y', keep: 'z' },
      blob: 'a'.repeat(5000),
    }) as Record<string, unknown>;
    expect(cleaned.pasfoto).toBeUndefined();
    expect(cleaned.wachtwoord).toBeUndefined();
    expect((cleaned.nested as Record<string, unknown>).access_token).toBeUndefined();
    expect((cleaned.nested as Record<string, unknown>).keep).toBe('z');
    expect(String(cleaned.blob)).toMatch(/characters omitted/);
    expect(cleaned.studentnummer).toBe('1234567');
  });

  it('maps news to plain text with safe links', () => {
    const item = mapNews(news.items[0]);
    expect(item.id).toBe('41');
    expect(item.title).toBe('Registration period Q2 opens');
    expect(item.body).toContain('Course registration for Q2 opens');
    expect(item.body).not.toContain('token=abc');
    expect(item.url).toBe('https://www.tudelft.nl/news/41');
    expect(item.source).toBe('Education and Student Affairs');
  });
});
