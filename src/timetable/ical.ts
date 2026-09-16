import ICAL from 'ical.js';
import { TIMEZONE } from '../config.js';
import { TudelftError } from '../errors.js';
import { toLocal } from '../util/dates.js';
import { plainText, str } from '../util/text.js';

export interface CalendarItem {
  id: string;
  uid: string;
  title: string;
  courseCode?: string;
  description: string;
  location: string;
  /** UTC instants. */
  start: string;
  end: string;
  /** Europe/Amsterdam renderings such as "Mon 16 Sep 2026 13:45". */
  startLocal: string;
  endLocal: string;
  allDay: boolean;
  cancelled: boolean;
  recurring: boolean;
  activityType?: string;
  staff?: string[];
}

export interface ExpandedCalendar {
  items: CalendarItem[];
  /** False when a limit cut the expansion short. */
  complete: boolean;
  truncated: boolean;
  warnings: string[];
}

export interface ExpandLimits {
  maxItems?: number;
  maxInputBytes?: number;
  maxEvents?: number;
  maxSteps?: number;
  /** Wall-clock budget for the whole expansion, checked every 500 iterator steps. */
  budgetMs?: number;
}

export const EXPAND_DEFAULTS: Required<ExpandLimits> = {
  maxItems: 2000,
  maxInputBytes: 4 * 1024 * 1024,
  maxEvents: 20_000,
  maxSteps: 100_000,
  budgetMs: 8_000,
};

const BUDGET_CHECK_STEPS = 500;

/** How far past the window the recurrence iterator keeps looking for moved occurrences. */
const LOOKAHEAD_MS = 35 * 86_400_000;
const COURSE_CODE = /^([A-Z]{2,6}\d{3,5}[A-Z0-9-]*)\s*(?:[-:]|\u2013|\u2014)\s*/;
const ACTIVITY_LINE = /^(?:activity ?type|activity|type|soort|werkvorm)\s*:\s*(.+)$/i;
const STAFF_LINE = /^(?:staff|lecturers?|teachers?|instructors?|docenten?|medewerkers?)\s*:\s*(.+)$/i;

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat | undefined {
  const cached = formatters.get(timeZone);
  if (cached) return cached;
  try {
    const created = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    formatters.set(timeZone, created);
    return created;
  } catch {
    return undefined;
  }
}

/** Interpret a wall-clock time in an IANA zone and return the UTC instant. */
export function zonedToUtc(
  parts: { year: number; month: number; day: number; hour: number; minute: number; second: number },
  timeZone: string,
): Date | undefined {
  const format = formatter(timeZone);
  if (!format) return undefined;
  const target = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  let guess = target;
  for (let i = 0; i < 3; i++) {
    const shown = Object.fromEntries(format.formatToParts(guess).map((p) => [p.type, Number(p.value)]));
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

function timeParts(time: ICAL.Time): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
} {
  return {
    year: time.year,
    month: time.month,
    day: time.day,
    hour: time.isDate ? 0 : time.hour,
    minute: time.isDate ? 0 : time.minute,
    second: time.isDate ? 0 : time.second,
  };
}

/** Convert an ICAL.Time to a UTC instant, using Intl for named zones and Amsterdam for floating times. */
export function toUtc(time: ICAL.Time): Date {
  const zone = time.zone as { tzid?: string } | undefined;
  const tzid = zone?.tzid ?? '';
  if (time.isDate) return zonedToUtc(timeParts(time), TIMEZONE) ?? new Date(NaN);
  if (zone === ICAL.Timezone.utcTimezone || tzid === 'UTC' || tzid === 'Z') return time.toJSDate();
  if (zone === ICAL.Timezone.localTimezone || !tzid || tzid === 'floating') {
    return zonedToUtc(timeParts(time), TIMEZONE) ?? new Date(NaN);
  }
  return zonedToUtc(timeParts(time), tzid) ?? time.toJSDate();
}

function parseInstant(value: string, label: string): number {
  const time = typeof value === 'string' ? Date.parse(value) : NaN;
  if (!Number.isFinite(time))
    throw new TudelftError('INVALID_ARGUMENT', `${label} must be an ISO 8601 date-time.`);
  return time;
}

interface Group {
  main?: ICAL.Component;
  exceptions: ICAL.Component[];
}

function parseDescription(text: string): { activityType?: string; staff?: string[] } {
  const out: { activityType?: string; staff?: string[] } = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const activity = ACTIVITY_LINE.exec(line);
    if (activity && !out.activityType) out.activityType = activity[1]!.trim();
    const staff = STAFF_LINE.exec(line);
    if (staff && !out.staff) {
      const names = staff[1]!
        .split(/[;,]/)
        .map((name) => name.trim())
        .filter(Boolean);
      if (names.length) out.staff = names.slice(0, 20);
    }
  }
  return out;
}

function componentText(component: ICAL.Component, name: string): string {
  return str(component.getFirstPropertyValue(name));
}

function buildItem(
  event: ICAL.Event,
  component: ICAL.Component,
  start: Date,
  end: Date,
  allDay: boolean,
  recurring: boolean,
): CalendarItem {
  const uid = str(event.uid).slice(0, 200);
  const title = plainText(str(event.summary)).slice(0, 300);
  const description = plainText(str(event.description)).slice(0, 4000);
  const item: CalendarItem = {
    id: `${uid}#${start.toISOString()}`,
    uid,
    title,
    description,
    location: plainText(str(event.location)).slice(0, 300),
    start: start.toISOString(),
    end: end.toISOString(),
    startLocal: toLocal(start.toISOString()) ?? '',
    endLocal: toLocal(end.toISOString()) ?? '',
    allDay,
    cancelled: componentText(component, 'status').toUpperCase() === 'CANCELLED',
    recurring,
  };
  const code = COURSE_CODE.exec(title);
  if (code) item.courseCode = code[1]!.toUpperCase();
  const extra = parseDescription(description);
  if (extra.activityType) item.activityType = extra.activityType;
  if (extra.staff) item.staff = extra.staff;
  return item;
}

function registerZones(root: ICAL.Component): void {
  for (const zone of root.getAllSubcomponents('vtimezone')) {
    const tzid = componentText(zone, 'tzid');
    if (!tzid || ICAL.TimezoneService.has(tzid)) continue;
    try {
      ICAL.TimezoneService.register(zone, tzid);
    } catch {
      /* an unusable VTIMEZONE falls back to Intl conversion */
    }
  }
}

function calendars(icsText: string): ICAL.Component[] {
  let parsed: unknown;
  try {
    parsed = ICAL.parse(icsText);
  } catch {
    throw new TudelftError('DOCUMENT_PARSE_FAILED', 'The calendar feed could not be parsed.');
  }
  // One calendar parses to ["vcalendar", props, components]; several parse to a list of those.
  const jcals: unknown[] = Array.isArray(parsed) ? (typeof parsed[0] === 'string' ? [parsed] : parsed) : [];
  const roots: ICAL.Component[] = [];
  for (const jcal of jcals) {
    try {
      const component = new ICAL.Component(jcal as never);
      if (component.name === 'vcalendar') roots.push(component);
      else roots.push(...component.getAllSubcomponents('vcalendar'));
    } catch {
      /* skip unreadable component */
    }
  }
  if (!roots.length) throw new TudelftError('DOCUMENT_PARSE_FAILED', 'The feed does not contain a calendar.');
  return roots;
}

/**
 * Expand every event of an iCalendar text that overlaps [from, to], including
 * recurrences with EXDATE and RECURRENCE-ID overrides. Pure and bounded.
 */
export function expandCalendar(
  icsText: string,
  fromIso: string,
  toIso: string,
  limits: ExpandLimits = {},
): ExpandedCalendar {
  const config = { ...EXPAND_DEFAULTS, ...limits };
  const startedAt = Date.now();
  if (typeof icsText !== 'string')
    throw new TudelftError('DOCUMENT_PARSE_FAILED', 'The calendar feed is not text.');
  if (Buffer.byteLength(icsText, 'utf8') > config.maxInputBytes)
    throw new TudelftError('FILE_TOO_LARGE', 'The calendar feed is larger than the size limit.');
  const from = parseInstant(fromIso, 'from');
  const to = parseInstant(toIso, 'to');
  if (to <= from) throw new TudelftError('INVALID_ARGUMENT', 'The "to" instant must be after "from".');

  const warnings: string[] = [];
  const items: CalendarItem[] = [];
  let eventsExceeded = false;
  let stepsExceeded = false;
  let steps = 0;
  const groups = new Map<string, Group>();
  let seen = 0;

  for (const root of calendars(icsText)) {
    registerZones(root);
    for (const component of root.getAllSubcomponents('vevent')) {
      if (seen >= config.maxEvents) {
        eventsExceeded = true;
        break;
      }
      seen++;
      const uid = componentText(component, 'uid') || `no-uid-${seen}`;
      const group = groups.get(uid) ?? { exceptions: [] };
      if (component.hasProperty('recurrence-id')) group.exceptions.push(component);
      else if (group.main) warnings.push(`Duplicate event ${uid.slice(0, 60)}; the first one is used.`);
      else group.main = component;
      groups.set(uid, group);
    }
    if (eventsExceeded) break;
  }
  if (eventsExceeded) warnings.push(`Only the first ${config.maxEvents} events were read.`);

  const overlaps = (start: Date, end: Date): boolean =>
    Number.isFinite(start.getTime()) &&
    Number.isFinite(end.getTime()) &&
    end.getTime() > from &&
    start.getTime() < to;

  const pushSingle = (event: ICAL.Event, component: ICAL.Component, recurring: boolean): void => {
    const start = toUtc(event.startDate);
    const end = toUtc(event.endDate);
    if (overlaps(start, end))
      items.push(buildItem(event, component, start, end, event.startDate.isDate, recurring));
  };

  outer: for (const [uid, group] of groups) {
    try {
      if (!group.main) {
        for (const exception of group.exceptions) pushSingle(new ICAL.Event(exception), exception, true);
        continue;
      }
      const event = new ICAL.Event(group.main, { strictExceptions: false, exceptions: group.exceptions });
      if (!event.isRecurring()) {
        pushSingle(event, group.main, false);
        continue;
      }
      const iterator = event.iterator();
      while (true) {
        if (steps++ >= config.maxSteps) {
          stepsExceeded = true;
          break outer;
        }
        if (steps % BUDGET_CHECK_STEPS === 0 && Date.now() - startedAt > config.budgetMs) {
          throw new TudelftError(
            'UNAVAILABLE',
            'The timetable feed took too long to expand. Use a shorter window.',
          );
        }
        const next = iterator.next();
        if (!next) break;
        const details = event.getOccurrenceDetails(next);
        const occurrenceStart = toUtc(next);
        if (Number.isFinite(occurrenceStart.getTime()) && occurrenceStart.getTime() > to + LOOKAHEAD_MS)
          break;
        const start = toUtc(details.startDate);
        const end = toUtc(details.endDate);
        if (!overlaps(start, end)) continue;
        const item = details.item as ICAL.Event;
        items.push(buildItem(item, item.component, start, end, details.startDate.isDate, true));
        if (items.length > config.maxItems) break outer;
      }
    } catch (error) {
      if (error instanceof TudelftError) throw error;
      warnings.push(`Event ${uid.slice(0, 60)} could not be expanded and was skipped.`);
    }
  }
  if (stepsExceeded)
    warnings.push('The recurrence expansion hit its step limit; later events may be missing.');

  items.sort((a, b) => a.start.localeCompare(b.start) || a.title.localeCompare(b.title));
  const truncated = items.length > config.maxItems;
  if (truncated) {
    items.length = config.maxItems;
    warnings.push(`Only the first ${config.maxItems} events of the window are returned.`);
  }
  return {
    items,
    complete: !truncated && !eventsExceeded && !stepsExceeded,
    truncated,
    warnings,
  };
}
