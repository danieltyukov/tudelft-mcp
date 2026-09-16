import { load, type CheerioAPI } from 'cheerio';
import { TudelftError } from '../errors.js';
import { array, num, plainText, record, str, type Row } from '../util/text.js';
import { redactLinks, safeLink } from '../util/url.js';
import { fetchPublicHtml, fetchPublicJson, matches, pageOf } from './http.js';

export const SPACEFINDER = 'https://spacefinder.tudelft.nl';
export const ESVIEWER = 'https://esviewer.tudelft.nl';
export const SOFTWAREFINDER = 'https://softwarefinder.tudelft.nl';
export const ICT_NOTICES = 'https://meldingen-ict.tudelft.nl';
export type NoticeKind = 'incidents' | 'maintenance' | 'information';

const ID = /^[A-Za-z0-9_-]{1,100}$/;
const MAX_DECODE = 200_000;

/**
 * Decode a Nuxt (devalue) payload: a flat array where objects and arrays refer
 * to other entries by index. Cycles and special forms are handled.
 */
export function decodeDevalue(list: unknown[]): unknown {
  const memo = new Map<number, unknown>();
  let visits = 0;
  const decode = (index: number, depth: number): unknown => {
    if (depth > 64 || ++visits > MAX_DECODE) return undefined;
    if (index === -1) return undefined;
    if (index === -2) return NaN;
    if (index === -3) return Infinity;
    if (index === -4) return -Infinity;
    if (index === -5) return -0;
    if (!Number.isInteger(index) || index < 0 || index >= list.length) return undefined;
    if (memo.has(index)) return memo.get(index);
    const value = list[index];
    if (value === null || typeof value !== 'object') {
      memo.set(index, value);
      return value;
    }
    if (Array.isArray(value)) {
      if (typeof value[0] === 'string' && value.length >= 1) {
        const tag = value[0];
        if (
          ['Ref', 'ShallowRef', 'Reactive', 'ShallowReactive', 'NuxtError'].includes(tag) &&
          value.length === 2
        ) {
          const inner = decode(value[1] as number, depth + 1);
          memo.set(index, inner);
          return inner;
        }
        if (tag === 'EmptyRef' || tag === 'EmptyShallowRef') {
          memo.set(index, undefined);
          return undefined;
        }
        if (tag === 'Date' && typeof value[1] === 'string') {
          memo.set(index, value[1]);
          return value[1];
        }
        if (tag === 'Set' || tag === 'Map' || tag === 'Object') {
          const out: unknown[] = [];
          memo.set(index, out);
          for (const entry of value.slice(1)) out.push(decode(entry as number, depth + 1));
          if (tag === 'Object' && out.length === 1) return out[0];
          return out;
        }
        if (tag === 'BigInt' || tag === 'RegExp') {
          memo.set(index, String(value[1]));
          return String(value[1]);
        }
      }
      const out: unknown[] = [];
      memo.set(index, out);
      for (const entry of value) out.push(decode(entry as number, depth + 1));
      return out;
    }
    const out: Row = {};
    memo.set(index, out);
    for (const [key, entry] of Object.entries(value as Row)) out[key] = decode(entry as number, depth + 1);
    return out;
  };
  return decode(0, 0);
}

/** Find a key anywhere in a decoded tree (first match, breadth first). */
export function findKey(tree: unknown, key: string, maxDepth = 12): unknown {
  const queue: Array<{ value: unknown; depth: number }> = [{ value: tree, depth: 0 }];
  const seen = new Set<unknown>();
  while (queue.length) {
    const { value, depth } = queue.shift()!;
    if (!value || typeof value !== 'object' || seen.has(value) || depth > maxDepth) continue;
    seen.add(value);
    if (!Array.isArray(value)) {
      const row = value as Row;
      if (key in row) return row[key];
    }
    for (const entry of Array.isArray(value) ? value : Object.values(value as Row))
      queue.push({ value: entry, depth: depth + 1 });
  }
  return undefined;
}

function primitives(row: Row, max = 40): Row {
  const out: Row = {};
  let count = 0;
  for (const [key, value] of Object.entries(row)) {
    if (count >= max) break;
    if (typeof value === 'string') {
      if (value.length > 600 || /^data:/.test(value)) continue;
      out[key] = redactLinks(plainText(value));
    } else if (typeof value === 'number' || typeof value === 'boolean') out[key] = value;
    else if (
      Array.isArray(value) &&
      value.every((entry) => typeof entry === 'string' || typeof entry === 'number')
    ) {
      out[key] = value.slice(0, 40);
    } else continue;
    count++;
  }
  return out;
}

function firstText(row: Row, keys: string[]): string {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === 'string' && value.trim()) return plainText(value);
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const inner = record(value);
      const text = str(inner.en ?? inner.nl ?? inner.name ?? inner.title);
      if (text.trim()) return plainText(text);
    }
  }
  return '';
}

/** Localised store entries are either {en: [...], nl: [...]} or a plain list. */
function localeList(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  const row = record(value);
  if (Array.isArray(row.en)) return row.en;
  if (Array.isArray(row.nl)) return row.nl;
  const values = Object.values(row);
  return values.length && values.every((entry) => entry && typeof entry === 'object') ? values : [];
}

export interface Space {
  id: string;
  name: string;
  building?: string;
  type?: string;
  capacity?: number;
  url?: string;
  data: Row;
}

export function parseSpaces(html: string): Space[] {
  const $ = load(html);
  const raw = $('script#__NUXT_DATA__').first().text();
  if (!raw.trim())
    throw new TudelftError('FORMAT_CHANGED', 'Spacefinder no longer embeds its data in the page.');
  let list: unknown;
  try {
    list = JSON.parse(raw);
  } catch {
    throw new TudelftError('FORMAT_CHANGED', 'Spacefinder data could not be read.');
  }
  if (!Array.isArray(list))
    throw new TudelftError('FORMAT_CHANGED', 'Spacefinder data has an unfamiliar shape.');
  const tree = decodeDevalue(list);
  const pinia = findKey(tree, 'pinia') ?? tree;
  const spacesStore = findKey(pinia, 'spaces') ?? pinia;
  const spaces = localeList(findKey(spacesStore, 'spacesI18n')).map(record);
  const buildings = localeList(findKey(spacesStore, 'buildingsI18n')).map(record);
  if (!spaces.length) throw new TudelftError('FORMAT_CHANGED', 'Spacefinder returned no study spaces.');
  const buildingName = new Map<string, string>();
  for (const building of buildings) {
    const id = str(building.id ?? building.slug ?? building.code);
    const name = firstText(building, ['name', 'title', 'label']);
    if (id && name) buildingName.set(id, name);
  }
  return spaces
    .map((space): Space => {
      const id = str(space.id ?? space.slug ?? space.uuid);
      const rawBuilding = space.building ?? space.buildingId ?? space.building_id;
      const buildingRow = record(rawBuilding);
      const building =
        firstText(buildingRow, ['name', 'title']) ||
        buildingName.get(str(rawBuilding ?? buildingRow.id)) ||
        (typeof rawBuilding === 'string' ? rawBuilding : '');
      const out: Space = { id, name: firstText(space, ['name', 'title', 'label']), data: primitives(space) };
      if (building) out.building = building;
      const type = firstText(space, ['type', 'category', 'spaceType', 'kind']);
      if (type) out.type = type;
      const capacity = num(space.capacity ?? space.seats ?? space.places);
      if (capacity !== undefined) out.capacity = capacity;
      const slug = str(space.slug ?? space.id);
      const url = safeLink(slug ? `${SPACEFINDER}/en/spaces/${encodeURIComponent(slug)}` : undefined);
      if (url) out.url = url;
      return out;
    })
    .filter((space) => space.name || space.id);
}

export async function spaces(query: string | undefined, offset = 0): Promise<Record<string, unknown>> {
  const all = parseSpaces(await fetchPublicHtml(`${SPACEFINDER}/en/spaces/`, { label: 'Spacefinder' }));
  const filtered = all.filter((space) => matches(JSON.stringify(space), query));
  return { query: query ?? '', ...pageOf(filtered, offset), source: `${SPACEFINDER}/en/spaces/` };
}

export interface Room {
  id: string;
  name: string;
  building?: string;
  buildingNumber?: string;
  type?: string;
  seats?: number;
  examSeats?: number;
  computers?: number;
  furniture?: string;
  presentation?: string;
  facilities?: string;
  software?: string;
  url?: string;
}

function cellText($: CheerioAPI, cells: ReturnType<CheerioAPI>, index: number): string {
  const cell = cells.eq(index);
  return cell.length ? plainText($.html(cell)) : '';
}

export function parseRooms(html: string): Room[] {
  const $ = load(html);
  const rooms: Room[] = [];
  $('tr').each((_i, row) => {
    const link = $(row).find('a[href^="/space/"]').first();
    if (!link.length) return;
    const cells = $(row).find('td');
    if (cells.length < 2) return;
    const href = link.attr('href') ?? '';
    const id = decodeURIComponent(href.replace(/^\/space\//, '').replace(/\/$/, ''));
    const room: Room = { id, name: plainText(link.text()) || cellText($, cells, 0) };
    const text = (index: number): string => cellText($, cells, index);
    const building = text(1);
    if (building) room.building = building;
    const type = text(2);
    if (type) room.type = type;
    const seats = num(text(3));
    if (seats !== undefined) room.seats = seats;
    const examSeats = num(text(4));
    if (examSeats !== undefined) room.examSeats = examSeats;
    const computers = num(text(5));
    if (computers !== undefined) room.computers = computers;
    const furniture = text(6);
    if (furniture) room.furniture = furniture;
    const presentation = text(7);
    if (presentation) room.presentation = presentation;
    const facilities = text(8);
    if (facilities) room.facilities = facilities;
    const software = text(9);
    if (software) room.software = software;
    const buildingNumber = text(10);
    if (buildingNumber) room.buildingNumber = buildingNumber;
    const url = safeLink(href, ESVIEWER);
    if (url) room.url = url;
    rooms.push(room);
  });
  if (!rooms.length) throw new TudelftError('FORMAT_CHANGED', 'The room viewer returned no rooms.');
  return rooms;
}

export async function rooms(query: string | undefined, offset = 0): Promise<Record<string, unknown>> {
  const all = parseRooms(await fetchPublicHtml(`${ESVIEWER}/`, { label: 'Room viewer' }));
  const filtered = all.filter((room) => matches(JSON.stringify(room), query));
  return { query: query ?? '', ...pageOf(filtered, offset), source: `${ESVIEWER}/` };
}

export interface SoftwarePackage {
  id: string;
  name: string;
  description: string;
  url: string;
}

export function parseSoftware(html: string): SoftwarePackage[] {
  const $ = load(html);
  const packages: SoftwarePackage[] = [];
  $('a[href^="/package/"]').each((_i, element) => {
    const link = $(element);
    const href = link.attr('href') ?? '';
    const id = decodeURIComponent(href.replace(/^\/package\//, '').replace(/\/$/, ''));
    if (!ID.test(id)) return;
    const name = plainText(link.find('.card_title').first().text()) || plainText(link.text()).slice(0, 120);
    const description = plainText(link.find('.card_desc').first().text()).slice(0, 600);
    if (!name || packages.some((entry) => entry.id === id)) return;
    packages.push({ id, name, description, url: `${SOFTWAREFINDER}/package/${encodeURIComponent(id)}/` });
  });
  if (!packages.length) throw new TudelftError('FORMAT_CHANGED', 'Softwarefinder returned no packages.');
  return packages;
}

export async function software(query: string | undefined, offset = 0): Promise<Record<string, unknown>> {
  const all = parseSoftware(await fetchPublicHtml(`${SOFTWAREFINDER}/`, { label: 'Softwarefinder' }));
  const filtered = all.filter((entry) => matches(`${entry.name} ${entry.description}`, query));
  return { query: query ?? '', ...pageOf(filtered, offset), source: `${SOFTWAREFINDER}/` };
}

export function parseSoftwareDetail(html: string, id: string): Record<string, unknown> {
  const $ = load(html);
  const section = $('.col-sm-9').first();
  const container = section.length ? section : $('main').first().length ? $('main').first() : $('body');
  const title = plainText($('h1').first().text()) || plainText($('title').first().text());
  const text = redactLinks(plainText($.html(container))).slice(0, 20_000);
  const links = new Set<string>();
  container.find('a[href]').each((_i, element) => {
    const href = safeLink($(element).attr('href'), SOFTWAREFINDER);
    if (href) links.add(href);
  });
  return {
    id,
    name: title,
    text,
    links: [...links].slice(0, 30),
    url: `${SOFTWAREFINDER}/package/${encodeURIComponent(id)}/`,
  };
}

export async function softwareDetail(id: string): Promise<Record<string, unknown>> {
  const clean = id.trim();
  if (!ID.test(clean)) throw new TudelftError('INVALID_ARGUMENT', 'Use the package id from search_software.');
  const html = await fetchPublicHtml(`${SOFTWAREFINDER}/package/${encodeURIComponent(clean)}/`, {
    label: 'Softwarefinder',
  });
  return parseSoftwareDetail(html, clean);
}

export interface Notice {
  id: string;
  title: string;
  description: string;
  closed: boolean;
  createdAt?: string;
  from?: string;
  period?: string;
  impact?: string;
  updates: Array<{ date?: string; status?: string; description: string }>;
}

export function mapNotice(item: unknown): Notice {
  const row = record(item);
  const notice: Notice = {
    id: str(row.id),
    title: plainText(row.title_EN ?? row.title),
    description: redactLinks(plainText(row.description_EN ?? row.description)).slice(0, 4000),
    closed: row.closed === true,
    updates: array(row.status_update)
      .map(record)
      .map((update) => {
        const out: { date?: string; status?: string; description: string } = {
          description: redactLinks(plainText(update.description_EN ?? update.description)).slice(0, 2000),
        };
        const date = str(update.date);
        if (date) out.date = date;
        const status = str(record(update.status).title_EN ?? record(update.status).title);
        if (status) out.status = status;
        return out;
      }),
  };
  const createdAt = str(row.creation_date);
  if (createdAt) notice.createdAt = createdAt;
  const from = str(row.from_date);
  if (from) notice.from = from;
  const period = plainText(row.period_info_EN ?? row.period_info);
  if (period) notice.period = period;
  const impact = str(record(row.impact).title_EN ?? record(row.impact).title);
  if (impact) notice.impact = impact;
  return notice;
}

function pageNumber(link: unknown): number | undefined {
  const value = str(link);
  if (!value) return undefined;
  try {
    const page = new URL(value).searchParams.get('page');
    return page && /^\d+$/.test(page) ? Number(page) : 1;
  } catch {
    return undefined;
  }
}

export async function notices(kind: NoticeKind, page = 1): Promise<Record<string, unknown>> {
  const current = Math.max(1, Math.floor(page));
  const payload = record(
    await fetchPublicJson(`${ICT_NOTICES}/api/${kind}/?format=json&page=${current}`, {
      label: 'ICT notices',
    }),
  );
  const results = array(payload.results).map(mapNotice);
  const nextPage = pageNumber(payload.next);
  const previousPage = pageNumber(payload.previous);
  return {
    kind,
    page: current,
    count: num(payload.count) ?? results.length,
    items: results,
    nextPage,
    previousPage,
    complete: nextPage === undefined,
    source: `${ICT_NOTICES}/`,
  };
}
