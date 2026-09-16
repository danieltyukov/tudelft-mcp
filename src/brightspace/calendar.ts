import type { AppContext } from '../context.js';
import { TudelftError } from '../errors.js';
import { parseWhen, timeOf, toLocal } from '../util/dates.js';
import { array, numericId, plainText, record, str } from '../util/text.js';
import { safeLink } from '../util/url.js';

export const EVENT_TYPES: Record<number, string> = {
  1: 'reminder',
  2: 'availability_starts',
  3: 'availability_ends',
  4: 'unlocks',
  5: 'locks',
  6: 'due',
};
const ENTITY_KINDS: Record<string, string> = {
  'D2L.LE.Dropbox.Dropbox': 'assignment',
  'D2L.LE.Quizzing.Quiz': 'quiz',
  'D2L.LE.Content.ContentObject.ModuleCO': 'module',
  'D2L.LE.Content.ContentObject.TopicCO': 'topic',
  'D2L.LE.Discussions.DiscussionTopic': 'discussion',
  'D2L.LE.Checklist.ChecklistItem': 'checklist',
  'D2L.LE.Survey.Survey': 'survey',
};

export interface CalendarEvent {
  id: string;
  eventId: string;
  courseId: string;
  courseCode: string;
  courseName: string;
  title: string;
  description: string;
  start: string | null;
  end: string | null;
  startLocal?: string;
  endLocal?: string;
  allDay: boolean;
  day?: string;
  location: string;
  eventType: string;
  relatedKind?: string;
  relatedId?: string;
  recurring: boolean;
  url: string;
}

export function parseCalendar(payload: unknown, origin: string): CalendarEvent[] {
  const wrappers = Array.isArray(payload) ? payload : array(record(payload).Objects);
  const events: CalendarEvent[] = [];
  for (const wrapper of wrappers) {
    const info = record(record(wrapper).EventDataInfo ?? wrapper);
    const eventId = str(info.CalendarEventId);
    if (!/^\d+$/.test(eventId)) continue;
    const courseId = str(info.OrgUnitId);
    const entity = record(info.AssociatedEntity);
    const base = {
      eventId,
      courseId,
      courseCode: str(info.OrgUnitCode),
      courseName: str(info.OrgUnitName),
      title: plainText(info.Title),
      description: plainText(info.Description).slice(0, 1500),
      location: str(info.LocationName),
      eventType: EVENT_TYPES[Number(info.EventType)] ?? 'event',
      ...(ENTITY_KINDS[str(entity.AssociatedEntityType)]
        ? {
            relatedKind: ENTITY_KINDS[str(entity.AssociatedEntityType)]!,
            relatedId: str(entity.AssociatedEntityId),
          }
        : {}),
      recurring: info.IsRecurring === true,
      url: safeLink(info.CalendarEventViewUrl, origin) ?? `${origin}/d2l/le/calendar/${courseId}`,
    };
    const occurrences = array(record(wrapper).Occurrences).map(record);
    const times = occurrences.length ? occurrences : [info];
    for (const occurrence of times) {
      const start = typeof occurrence.StartDateTime === 'string' ? occurrence.StartDateTime : null;
      const end = typeof occurrence.EndDateTime === 'string' ? occurrence.EndDateTime : null;
      const allDay = occurrence.IsAllDayEvent === true || info.IsAllDayEvent === true;
      const startLocal = toLocal(start);
      const endLocal = toLocal(end);
      events.push({
        id: `${eventId}:${str(occurrence.RecurrenceId) || '0'}:${start ?? ''}`,
        ...base,
        start,
        end,
        ...(startLocal ? { startLocal } : {}),
        ...(endLocal ? { endLocal } : {}),
        allDay,
        ...(allDay && typeof occurrence.StartDay === 'string'
          ? { day: occurrence.StartDay.slice(0, 10) }
          : {}),
      });
    }
  }
  return events.sort((a, b) => (timeOf(a.start) ?? 0) - (timeOf(b.start) ?? 0));
}

/** Calendar events with expanded occurrences for a set of courses. Window at most 366 days. */
export async function calendarEvents(
  ctx: AppContext,
  courseIds: string[],
  from: Date,
  to: Date,
): Promise<{ items: CalendarEvent[]; complete: boolean }> {
  const ids = [...new Set(courseIds.map((id) => numericId(id, 'course id')))];
  if (!ids.length) throw new TudelftError('INVALID_ARGUMENT', 'Give at least one course id.');
  if (to.getTime() <= from.getTime() || to.getTime() - from.getTime() > 366 * 86_400_000) {
    throw new TudelftError(
      'INVALID_ARGUMENT',
      'The calendar window must be increasing and at most 366 days long.',
    );
  }
  const items: CalendarEvent[] = [];
  let complete = true;
  for (let i = 0; i < ids.length; i += 25) {
    const batch = ids.slice(i, i + 25);
    const result = await ctx.brightspace.list('le', 'calendar/events/myEventsWithOccurrences/', {
      orgUnitIdsCSV: batch.join(','),
      startDateTime: from.toISOString(),
      endDateTime: to.toISOString(),
    });
    items.push(...parseCalendar(result.items, ctx.brightspace.origin));
    complete &&= result.complete;
  }
  const fromMs = from.getTime();
  const toMs = to.getTime();
  const inWindow = items.filter((event) => {
    const start = timeOf(event.start);
    return start === undefined || (start >= fromMs && start < toMs);
  });
  return { items: inWindow.sort((a, b) => (timeOf(a.start) ?? 0) - (timeOf(b.start) ?? 0)), complete };
}

export function windowFrom(
  args: { from?: string; to?: string; days?: number },
  defaultDays = 14,
): { from: Date; to: Date } {
  const from = args.from ? parseWhen(args.from, 'from') : new Date();
  const to = args.to
    ? parseWhen(args.to, 'to')
    : new Date(from.getTime() + (args.days ?? defaultDays) * 86_400_000);
  return { from, to };
}
