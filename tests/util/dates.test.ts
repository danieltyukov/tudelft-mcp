import { describe, expect, it } from 'vitest';
import { amsterdamToUtc, parseWhen, toLocal } from '../../src/util/dates.js';

describe('dates', () => {
  it('reads Amsterdam wall-clock time in winter and summer', () => {
    expect(amsterdamToUtc('2026-01-15T09:00:00').toISOString()).toBe('2026-01-15T08:00:00.000Z');
    expect(amsterdamToUtc('2026-07-15T09:00:00').toISOString()).toBe('2026-07-15T07:00:00.000Z');
  });
  it('parses dates without a zone as local Amsterdam midnight', () => {
    expect(parseWhen('2026-03-01').toISOString()).toBe('2026-02-28T23:00:00.000Z');
    expect(parseWhen('2026-03-01T10:30:00Z').toISOString()).toBe('2026-03-01T10:30:00.000Z');
  });
  it('rejects garbage', () => {
    expect(() => parseWhen('next tuesday')).toThrow(/ISO date/);
  });
  it('renders local time', () => {
    expect(toLocal('2026-09-16T11:45:00.000Z')).toBe('Wed 16 Sep 2026 13:45');
    expect(toLocal(null)).toBeUndefined();
  });
});
