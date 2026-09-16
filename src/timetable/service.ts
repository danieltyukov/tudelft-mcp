import type { Config } from '../config.js';
import type { SessionStore, TimetableSession } from '../auth/session.js';
import { TudelftError } from '../errors.js';
import { readBounded } from '../util/http.js';
import { Single } from '../util/paging.js';
import { expandCalendar, type ExpandedCalendar } from './ical.js';

export const MAX_WINDOW_DAYS = 93;
export const MAX_FEED_BYTES = 4 * 1024 * 1024;
const CACHE_MS = 10 * 60_000;

export interface TimetableStatus {
  configured: boolean;
  connectedAt?: string;
}

export interface TimetableWindow extends ExpandedCalendar {
  from: string;
  to: string;
}

/** Download an iCalendar feed once, enforcing the size cap and the text/calendar content type. */
export async function fetchCalendarText(url: URL, timeoutMs: number): Promise<string> {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { accept: 'text/calendar, text/plain;q=0.5' },
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new TudelftError(
      'UNAVAILABLE',
      'MyTimetable could not be reached. Check your connection and try again.',
    );
  }
  if (response.status === 401 || response.status === 403 || response.status === 404) {
    await response.body?.cancel().catch(() => undefined);
    throw new TudelftError(
      'TIMETABLE_NOT_CONNECTED',
      'MyTimetable rejected the saved calendar link. Connect it again with connect_timetable or "tudelft-mcp login".',
      { status: response.status },
    );
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new TudelftError('UNAVAILABLE', 'MyTimetable did not serve the calendar feed.', {
      status: response.status,
    });
  }
  const type = (response.headers.get('content-type') ?? '').toLowerCase();
  const text = await readBounded(response, MAX_FEED_BYTES, 'calendar feed');
  if (!type.includes('text/calendar') && !/^\s*BEGIN:VCALENDAR/i.test(text)) {
    throw new TudelftError('FORMAT_CHANGED', 'The link did not return a calendar (text/calendar).');
  }
  return text;
}

/**
 * Reads the personal MyTimetable iCal feed on demand. The feed text is cached
 * in memory for ten minutes; expansion runs in-process under hard bounds
 * (input size, event count, iterator steps, output items, wall-clock budget).
 */
export class TimetableService {
  private cache?: { url: string; text: string; fetchedAt: number };
  private download = new Single<string>();

  constructor(
    readonly config: Config,
    private readonly store: SessionStore,
  ) {}

  async status(): Promise<TimetableStatus> {
    const data = await this.store.load();
    return data.timetable
      ? { configured: true, connectedAt: data.timetable.connectedAt }
      : { configured: false };
  }

  async session(): Promise<TimetableSession> {
    const data = await this.store.load();
    if (!data.timetable?.icalUrl) {
      throw new TudelftError(
        'TIMETABLE_NOT_CONNECTED',
        'MyTimetable is not connected. Run "tudelft-mcp login", or paste the MyTimetable calendar link into connect_timetable.',
      );
    }
    return data.timetable;
  }

  invalidate(): void {
    this.cache = undefined;
  }

  async feedText(): Promise<string> {
    const session = await this.session();
    const cached = this.cache;
    if (cached && cached.url === session.icalUrl && Date.now() - cached.fetchedAt < CACHE_MS)
      return cached.text;
    return this.download.run(async () => {
      const again = this.cache;
      if (again && again.url === session.icalUrl && Date.now() - again.fetchedAt < CACHE_MS)
        return again.text;
      const text = await fetchCalendarText(new URL(session.icalUrl), this.config.timeoutMs);
      this.cache = { url: session.icalUrl, text, fetchedAt: Date.now() };
      return text;
    });
  }

  /** Events overlapping the window. Defaults to now until 14 days ahead; at most 93 days. */
  async events(fromIso?: string, toIso?: string): Promise<TimetableWindow> {
    const from = fromIso ? new Date(fromIso) : new Date();
    const to = toIso ? new Date(toIso) : new Date(from.getTime() + 14 * 86_400_000);
    if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()))
      throw new TudelftError('INVALID_ARGUMENT', 'from and to must be ISO 8601 date-times.');
    if (to <= from) throw new TudelftError('INVALID_ARGUMENT', 'The "to" date must be after "from".');
    if (to.getTime() - from.getTime() > MAX_WINDOW_DAYS * 86_400_000)
      throw new TudelftError('INVALID_ARGUMENT', `The window may span at most ${MAX_WINDOW_DAYS} days.`);
    const text = await this.feedText();
    const calendar = expandCalendar(text, from.toISOString(), to.toISOString());
    return { from: from.toISOString(), to: to.toISOString(), ...calendar };
  }
}
