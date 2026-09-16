import { TIMEZONE } from '../config.js';
import { TudelftError } from '../errors.js';

const ISO = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,7})?)?(?:Z|[+-]\d{2}:\d{2})?)?$/i;

/** Parse an ISO date or datetime. Dates without a zone are read as Europe/Amsterdam local time. */
export function parseWhen(value: string, label = 'date'): Date {
  if (typeof value !== 'string' || !ISO.test(value.trim())) {
    throw new TudelftError(
      'INVALID_ARGUMENT',
      `${label} must be an ISO date such as 2026-03-01 or 2026-03-01T09:00:00+01:00.`,
    );
  }
  const text = value.trim();
  const hasZone = /(?:Z|[+-]\d{2}:\d{2})$/i.test(text);
  const hasTime = text.includes('T');
  if (hasZone) return checked(new Date(text), label);
  if (!hasTime) return checked(amsterdamToUtc(`${text}T00:00:00`), label);
  return checked(amsterdamToUtc(text), label);
}

function checked(date: Date, label: string): Date {
  if (!Number.isFinite(date.getTime()))
    throw new TudelftError('INVALID_ARGUMENT', `${label} is not a valid date.`);
  return date;
}

const partsFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

/** Interpret a wall-clock time in Amsterdam and return the UTC instant. */
export function amsterdamToUtc(local: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/.exec(local);
  if (!match) return new Date(NaN);
  const [, y, mo, d, h, mi, s] = match;
  const target = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s ?? 0));
  let guess = target;
  for (let i = 0; i < 3; i++) {
    const shown = Object.fromEntries(
      partsFormatter.formatToParts(guess).map((p) => [p.type, Number(p.value)]),
    );
    const shownUtc = Date.UTC(
      shown.year!,
      shown.month! - 1,
      shown.day!,
      shown.hour!,
      shown.minute!,
      shown.second!,
    );
    const diff = target - shownUtc;
    if (diff === 0) break;
    guess += diff;
  }
  return new Date(guess);
}

/** ISO 8601 in UTC with milliseconds, the format Brightspace requires. */
export function toApiIso(date: Date): string {
  return date.toISOString();
}

export function nowIso(): string {
  return new Date().toISOString();
}

const localFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: TIMEZONE,
  weekday: 'short',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** Human readable Amsterdam time such as "Mon 16 Sep 2026 13:45". */
export function toLocal(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value) return undefined;
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return undefined;
  const parts = Object.fromEntries(localFormatter.formatToParts(time).map((p) => [p.type, p.value]));
  return `${parts.weekday} ${Number(parts.day)} ${monthName(Number(parts.month))} ${parts.year} ${parts.hour}:${parts.minute}`;
}

function monthName(month: number): string {
  return (
    ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][month - 1] ?? ''
  );
}

export function timeOf(value: unknown): number | undefined {
  if (typeof value !== 'string' || !value) return undefined;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : undefined;
}

export function daysFromNow(days: number): { from: Date; to: Date } {
  const from = new Date();
  return { from, to: new Date(from.getTime() + days * 86_400_000) };
}
