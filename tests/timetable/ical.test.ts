import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { expandCalendar } from '../../src/timetable/ical.js';

const ics = readFileSync(new URL('../fixtures/mytimetable.ics', import.meta.url), 'utf8');

describe('expandCalendar', () => {
  const calendar = expandCalendar(ics, '2026-03-01T00:00:00Z', '2026-04-30T00:00:00Z');
  const byUid = (uid: string) => calendar.items.filter((item) => item.uid === uid);

  it('expands a weekly rule across the DST change with EXDATE and RECURRENCE-ID', () => {
    const lectures = byUid('weekly-lecture@fixture');
    expect(lectures.map((item) => item.start)).toEqual([
      '2026-03-16T12:45:00.000Z',
      '2026-03-23T12:45:00.000Z',
      '2026-04-06T13:45:00.000Z',
      '2026-04-13T11:45:00.000Z',
    ]);
    const moved = lectures.find((item) => item.start.startsWith('2026-04-06'));
    expect(moved?.title).toBe('EE4790 - Circuit Fundamentals (moved)');
    expect(moved?.location).toBe('EEMCS - Lecture Hall B');
    expect(moved?.end).toBe('2026-04-06T15:30:00.000Z');
    expect(moved?.startLocal).toBe('Mon 06 Apr 2026 15:45');
    expect(lectures.every((item) => item.recurring)).toBe(true);
    const first = lectures[0]!;
    expect(first.startLocal).toBe('Mon 16 Mar 2026 13:45');
    expect(first.endLocal).toBe('Mon 16 Mar 2026 15:30');
  });

  it('parses course code, activity type and staff', () => {
    const first = byUid('weekly-lecture@fixture')[0]!;
    expect(first.courseCode).toBe('EE4790');
    expect(first.activityType).toBe('Lecture');
    expect(first.staff).toEqual(['Dr. A. Example', 'B. Voorbeeld']);
    const exam = byUid('exam@fixture')[0]!;
    expect(exam.activityType).toBe('Exam');
    expect(exam.start).toBe('2026-04-15T07:00:00.000Z');
  });

  it('flags cancelled events instead of hiding them', () => {
    const cancelled = byUid('cancelled-lab@fixture')[0]!;
    expect(cancelled.cancelled).toBe(true);
    expect(cancelled.start).toBe('2026-04-01T07:00:00.000Z');
  });

  it('handles all-day and UTC events and excludes events outside the window', () => {
    const allDay = byUid('allday@fixture')[0]!;
    expect(allDay.allDay).toBe(true);
    expect(allDay.start).toBe('2026-04-09T22:00:00.000Z');
    expect(allDay.end).toBe('2026-04-10T22:00:00.000Z');
    const utc = byUid('utc@fixture')[0]!;
    expect(utc.start).toBe('2026-04-16T08:00:00.000Z');
    expect(utc.courseCode).toBe('CESE5040');
    expect(byUid('outside@fixture')).toHaveLength(0);
    expect(calendar.complete).toBe(true);
    expect(calendar.truncated).toBe(false);
  });

  it('sorts by start and yields stable ids', () => {
    const starts = calendar.items.map((item) => item.start);
    expect([...starts].sort()).toEqual(starts);
    expect(new Set(calendar.items.map((item) => item.id)).size).toBe(calendar.items.length);
  });

  it('returns nothing for a window without events and validates the window', () => {
    expect(expandCalendar(ics, '2027-01-01T00:00:00Z', '2027-01-10T00:00:00Z').items).toEqual([]);
    expect(() => expandCalendar(ics, '2026-04-30T00:00:00Z', '2026-03-01T00:00:00Z')).toThrow(/after/);
    expect(() => expandCalendar(ics, 'soon', '2026-03-01T00:00:00Z')).toThrow(/ISO 8601/);
  });

  it('treats a TZID without VTIMEZONE as Amsterdam time', () => {
    const text = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//x//EN',
      'BEGIN:VEVENT',
      'UID:naked@fixture',
      'DTSTART;TZID=Europe/Amsterdam:20260720T100000',
      'DTEND;TZID=Europe/Amsterdam:20260720T110000',
      'SUMMARY:Summer session',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');
    const result = expandCalendar(text, '2026-07-01T00:00:00Z', '2026-08-01T00:00:00Z');
    expect(result.items[0]?.start).toBe('2026-07-20T08:00:00.000Z');
  });

  it('applies output, event and step limits', () => {
    const limited = expandCalendar(ics, '2026-03-01T00:00:00Z', '2026-04-30T00:00:00Z', { maxItems: 2 });
    expect(limited.items).toHaveLength(2);
    expect(limited.truncated).toBe(true);
    expect(limited.complete).toBe(false);
    const fewEvents = expandCalendar(ics, '2026-03-01T00:00:00Z', '2026-04-30T00:00:00Z', { maxEvents: 1 });
    expect(fewEvents.complete).toBe(false);
    expect(fewEvents.warnings.some((w) => /first 1 events/.test(w))).toBe(true);
    const fewSteps = expandCalendar(ics, '2026-03-01T00:00:00Z', '2026-04-30T00:00:00Z', { maxSteps: 2 });
    expect(fewSteps.complete).toBe(false);
    expect(() =>
      expandCalendar(ics, '2026-03-01T00:00:00Z', '2026-04-30T00:00:00Z', { maxInputBytes: 10 }),
    ).toThrow(/larger/);
    expect(() => expandCalendar('not a calendar', '2026-03-01T00:00:00Z', '2026-04-30T00:00:00Z')).toThrow(
      /parsed|calendar/,
    );
  });

  it('stops when the wall-clock budget is exhausted', () => {
    const endless = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//x//EN',
      'BEGIN:VEVENT',
      'UID:endless@fixture',
      'DTSTART:20000101T080000Z',
      'DTEND:20000101T090000Z',
      'RRULE:FREQ=MINUTELY',
      'SUMMARY:Endless',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');
    expect(() =>
      expandCalendar(endless, '2026-03-01T00:00:00Z', '2026-03-02T00:00:00Z', {
        budgetMs: 0,
        maxSteps: 1_000_000,
      }),
    ).toThrow(/too long/);
  });
});
