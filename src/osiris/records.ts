import { TudelftError } from '../errors.js';
import { array, num, plainText, record, str, type Row } from '../util/text.js';
import { redactLinks, safeLink } from '../util/url.js';
import { OSIRIS_ID, type OsirisClient, type PageResult } from './client.js';

export type RegistrationKind = 'course' | 'exam' | 'programme' | 'minor' | 'specialisation';
export type CatalogueKind = 'course' | 'exam';

export const REGISTRATION_PATHS: Record<RegistrationKind, string> = {
  course: 'cursussen',
  exam: 'toetsen',
  programme: 'opleidingen',
  minor: 'minoren',
  specialisation: 'specialisaties',
};

export const CATALOGUE_PATHS: Record<CatalogueKind, string> = {
  course: 'cursussen_voor_cursusinschrijving',
  exam: 'cursussen_voor_toetsinschrijving',
};

const SENSITIVE_KEY = /token|password|wachtwoord|secret|cookie|pasfoto|photo|foto/i;
const MAX_STRING = 4000;
const MAX_ARRAY = 500;
const MAX_DEPTH = 8;

/** Remove blobs and credential-like keys from an OSIRIS record, recursively. */
export function sanitize(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return undefined;
  if (typeof value === 'string') {
    if (value.length > MAX_STRING) return `${value.slice(0, 200)}... [${value.length} characters omitted]`;
    return value;
  }
  if (Array.isArray(value)) {
    return value.slice(0, MAX_ARRAY).map((entry) => sanitize(entry, depth + 1));
  }
  if (value && typeof value === 'object') {
    const out: Row = {};
    for (const [key, entry] of Object.entries(value as Row)) {
      if (SENSITIVE_KEY.test(key)) continue;
      const cleaned = sanitize(entry, depth + 1);
      if (cleaned !== undefined) out[key] = cleaned;
    }
    return out;
  }
  return value;
}

/** Render OSIRIS decimal clock values (13.3 means 13:30) as HH:MM. */
export function clock(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const text = value.trim();
    const colon = /^(\d{1,2}):(\d{2})$/.exec(text);
    if (colon) return `${colon[1]!.padStart(2, '0')}:${colon[2]}`;
    if (!/^\d{1,2}([.,]\d{1,2})?$/.test(text)) return undefined;
    return clock(Number(text.replace(',', '.')));
  }
  const number = num(value);
  if (number === undefined || number < 0 || number >= 24) return undefined;
  const hours = Math.floor(number);
  const minutes = Math.round((number - hours) * 100);
  if (minutes >= 60) return undefined;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

export function yesNo(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  const text = str(value).trim().toUpperCase();
  if (text === 'J' || text === 'Y' || text === 'TRUE') return true;
  if (text === 'N' || text === 'FALSE') return false;
  return undefined;
}

function defined<T extends object>(row: T): T {
  for (const key of Object.keys(row) as Array<keyof T>) if (row[key] === undefined) delete row[key];
  return row;
}

const first = (row: Row, keys: string[]): unknown => {
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return undefined;
};

export function pickId(row: Row, keys: string[]): string | undefined {
  const value = str(first(row, keys)).trim();
  return OSIRIS_ID.test(value) ? value : undefined;
}

export interface Grade {
  id: string;
  courseCode: string;
  courseName: string;
  courseId?: string;
  assessment: string;
  assessmentCode: string;
  result: string;
  resultDescription?: string;
  score?: number;
  weight?: number;
  assessmentDate?: string;
  updatedAt?: string;
  academicYear?: string;
  credits?: number;
}

export function mapGrade(item: unknown): Grade {
  const row = record(item);
  const grade: Grade = {
    id: str(first(row, ['id_resultaat', 'id'])),
    courseCode: str(row.cursus),
    courseName: str(row.cursus_korte_naam || row.cursus_lange_naam),
    courseId: pickId(row, ['id_cursus']),
    assessment: str(row.toets_omschrijving),
    assessmentCode: str(row.toets),
    result: str(row.resultaat),
    resultDescription: str(row.resultaat_omschrijving) || undefined,
    score: num(row.score),
    weight: num(row.weging),
    assessmentDate: str(row.toetsdatum) || undefined,
    updatedAt: str(row.mutatiedatum) || undefined,
    academicYear: str(row.collegejaar) || undefined,
    credits: num(row.studiepunten ?? row.punten),
  };
  return defined(grade);
}

export interface ListOptions {
  offset?: number;
  limit?: number;
}

export interface Listing<T> {
  items: T[];
  offset: number;
  limit: number;
  hasMore: boolean;
  nextOffset?: number;
  count?: number;
  complete: boolean;
}

function listing<T>(page: PageResult, map: (item: unknown) => T): Listing<T> {
  const out: Listing<T> = {
    items: page.items.map(map),
    offset: page.offset,
    limit: page.limit,
    hasMore: page.hasMore,
    complete: !page.hasMore,
  };
  if (page.nextOffset !== undefined) out.nextOffset = page.nextOffset;
  if (page.count !== undefined) out.count = page.count;
  return out;
}

export async function grades(
  client: OsirisClient,
  options: ListOptions & { all?: boolean } = {},
): Promise<Listing<Grade>> {
  if (options.all) {
    const result = await client.all('/student/resultaten', 1000);
    const out: Listing<Grade> = {
      items: result.items.map(mapGrade),
      offset: 0,
      limit: result.items.length,
      hasMore: !result.complete,
      complete: result.complete,
    };
    if (result.count !== undefined) out.count = result.count;
    return out;
  }
  return listing(await client.page('/student/resultaten', options), mapGrade);
}

/** Generic summary of an OSIRIS row: known field names mapped to English, everything else under data. */
export interface Summary {
  id?: string;
  courseCode?: string;
  courseName?: string;
  courseId?: string;
  academicYear?: string;
  period?: string;
  credits?: number;
  assessment?: string;
  assessmentCode?: string;
  assessmentDate?: string;
  startTime?: string;
  endTime?: string;
  location?: string;
  programme?: string;
  registered?: boolean;
  openForRegistration?: boolean;
  registrationAllowed?: boolean;
  mayWithdraw?: boolean;
  availablePlaces?: number;
  registrationStart?: string;
  registrationEnd?: string;
  data: Row;
}

export function summarise(item: unknown, idKeys: string[] = []): Summary {
  const row = record(item);
  const summary: Summary = {
    id: pickId(row, [
      ...idKeys,
      'id_inschrijving',
      'id_cursus_blok',
      'id_toets_gelegenheid',
      'id_voortgang',
      'id_student_opleiding',
      'id_opleiding',
      'id_cursus',
      'id',
    ]),
    courseCode: str(row.cursus) || undefined,
    courseName: str(row.cursus_korte_naam || row.cursus_lange_naam || row.cursus_omschrijving) || undefined,
    courseId: pickId(row, ['id_cursus']),
    academicYear: str(row.collegejaar) || undefined,
    period: str(first(row, ['blok', 'periode', 'blok_omschrijving'])) || undefined,
    credits: num(row.studiepunten ?? row.punten),
    assessment: str(row.toets_omschrijving) || undefined,
    assessmentCode: str(row.toets) || undefined,
    assessmentDate: str(first(row, ['toetsdatum', 'datum'])) || undefined,
    startTime: clock(first(row, ['tijd_vanaf', 'begintijd'])),
    endTime: clock(first(row, ['tijd_tm', 'tijd_tot', 'eindtijd'])),
    location: str(first(row, ['locatie', 'zaal', 'gebouw', 'toetslocatie'])) || undefined,
    programme: str(first(row, ['opleiding_omschrijving', 'opleiding', 'opleiding_naam'])) || undefined,
    registered: yesNo(row.ingeschreven),
    openForRegistration: yesNo(row.open_voor_inschrijving),
    registrationAllowed: yesNo(row.inschrijven_toegestaan),
    mayWithdraw: yesNo(row.mag_uitschrijven),
    availablePlaces: num(row.beschikbare_plekken),
    registrationStart:
      str(first(row, ['inschrijfperiode_vanaf', 'begindatum_inschrijfperiode'])) || undefined,
    registrationEnd: str(first(row, ['inschrijfperiode_tm', 'einddatum_inschrijfperiode'])) || undefined,
    data: record(sanitize(row)),
  };
  return defined(summary);
}

export async function progress(client: OsirisClient, options: ListOptions = {}): Promise<Listing<Summary>> {
  return listing(await client.page('/student/voortgang/per_opleiding/', options), (item) =>
    summarise(item, ['id_voortgang', 'id_student_opleiding', 'id_opleiding']),
  );
}

export function checkId(value: string, label: string): string {
  const id = value.trim();
  if (!OSIRIS_ID.test(id))
    throw new TudelftError(
      'INVALID_ARGUMENT',
      `${label} must be an OSIRIS id returned by another osiris_* tool.`,
    );
  return id;
}

export async function programme(
  client: OsirisClient,
  progressId: string,
  section: 'curriculum' | 'advice',
  options: ListOptions = {},
): Promise<Record<string, unknown>> {
  const id = checkId(progressId, 'progressId');
  if (section === 'advice') {
    const page = await client.page(`/student/voortgang/${id}/studieadviezen`, options);
    return { progressId: id, section, ...listing(page, (item) => summarise(item)) };
  }
  const payload = await client.request(`/student/voortgang/${id}/onderwijsprogramma`);
  return { progressId: id, section, data: sanitize(payload) };
}

export interface RegistrationOptions extends ListOptions {
  history?: boolean;
  query?: string;
}

export async function registrations(
  client: OsirisClient,
  kind: RegistrationKind,
  options: RegistrationOptions = {},
): Promise<Listing<Summary> & { kind: RegistrationKind }> {
  const path = new URL(`/student/inschrijvingen/${REGISTRATION_PATHS[kind]}`, 'https://placeholder.invalid');
  path.searchParams.set('toon_historie', options.history ? 'J' : 'N');
  const query = options.query?.trim();
  if (query) path.searchParams.set('zoekstring', query.slice(0, 100));
  const page = await client.page(`${path.pathname}${path.search}`, options);
  return { kind, ...listing(page, (item) => summarise(item)) };
}

/** All registrations of one kind (bounded), used by the exam overview. */
export async function allRegistrations(
  client: OsirisClient,
  kind: RegistrationKind,
  max = 500,
): Promise<{ items: Summary[]; complete: boolean }> {
  const result = await client.all(`/student/inschrijvingen/${REGISTRATION_PATHS[kind]}?toon_historie=N`, max);
  return { items: result.items.map((item) => summarise(item)), complete: result.complete };
}

export interface CatalogueOptions extends ListOptions {
  query?: string;
  planned?: boolean;
}

function searchBody(query: string, from: number, size: number): Row {
  return {
    from,
    size,
    query: {
      bool: {
        must: [
          {
            multi_match: {
              query: query.toUpperCase(),
              type: 'phrase_prefix',
              fields: ['cursus', 'cursus_korte_naam', 'cursus_lange_naam'],
              max_expansions: 200,
            },
          },
        ],
      },
    },
  };
}

export async function availableCourses(
  client: OsirisClient,
  kind: CatalogueKind,
  options: CatalogueOptions = {},
): Promise<Listing<Summary> & { kind: CatalogueKind; mode: 'search' | 'open' | 'planned' }> {
  const base = `/student/${CATALOGUE_PATHS[kind]}`;
  const query = options.query?.trim();
  if (query) {
    const offset = Math.max(0, Math.floor(options.offset ?? 0));
    const limit = Math.min(100, Math.max(1, Math.floor(options.limit ?? 50)));
    const payload = record(
      await client.request(`${base}/zoeken`, 'POST', searchBody(query.slice(0, 100), offset, limit)),
    );
    const hits = record(payload.hits);
    const rows = array(hits.hits);
    const totalValue = record(hits.total);
    const total = num(hits.total) ?? num(totalValue.value);
    const items = rows.map((hit) => summarise(record(hit)._source ?? hit, ['id_cursus_blok', 'id_cursus']));
    const hasMore = total !== undefined ? offset + rows.length < total : rows.length >= limit;
    const out: Listing<Summary> & { kind: CatalogueKind; mode: 'search' } = {
      kind,
      mode: 'search',
      items,
      offset,
      limit,
      hasMore,
      complete: !hasMore,
    };
    if (hasMore) out.nextOffset = offset + rows.length;
    if (total !== undefined) out.count = total;
    return out;
  }
  const path = options.planned
    ? `${base}/gepland_onderwijs/`
    : `${base}/te_volgen_onderwijs/open_voor_inschrijving/`;
  const page = await client.page(path, options);
  return {
    kind,
    mode: options.planned ? 'planned' : 'open',
    ...listing(page, (item) => summarise(item, ['id_cursus_blok', 'id_cursus'])),
  };
}

export async function course(
  client: OsirisClient,
  kind: CatalogueKind,
  courseId: string,
  section: 'details' | 'blocks',
): Promise<Record<string, unknown>> {
  const id = checkId(courseId, 'courseId');
  const base = `/student/${CATALOGUE_PATHS[kind]}/${id}`;
  if (section === 'blocks') {
    const payload = await client.request(`${base}/blokken_voor_cursusinschrijving`);
    const items = Array.isArray(payload) ? payload : array(record(payload).items);
    return {
      kind,
      courseId: id,
      section,
      items: items.map((item) => summarise(item, ['id_cursus_blok'])),
    };
  }
  const payload = await client.request(base);
  return { kind, courseId: id, section, ...summarise(payload, ['id_cursus_blok', 'id_cursus']) };
}

export async function profile(client: OsirisClient): Promise<Record<string, unknown>> {
  const user = record(sanitize(await client.request('/gebruiker')));
  const personal = sanitize(await client.request('/student/personalia').catch(() => null));
  const contact = sanitize(await client.request('/student/contactgegevens').catch(() => null));
  return {
    studentNumber: str(user.studentnummer) || undefined,
    name: [user.roepnaam, user.voorvoegsels, user.achternaam].map(str).filter(Boolean).join(' ') || undefined,
    email: str(user.e_mailadres) || undefined,
    user,
    personal,
    contact,
  };
}

export async function timetable(client: OsirisClient, options: ListOptions = {}): Promise<Listing<Summary>> {
  return listing(await client.page('/student/rooster', options), (item) => summarise(item));
}

export interface NewsItem {
  id: string;
  date?: string;
  title: string;
  summary?: string;
  body: string;
  source?: string;
  url?: string;
}

export function mapNews(item: unknown): NewsItem {
  const row = record(item);
  const news: NewsItem = {
    id: str(first(row, ['id_nieuws', 'id'])),
    date: str(row.datum) || undefined,
    title: plainText(row.titel),
    summary: redactLinks(plainText(row.samenvatting)) || undefined,
    body: redactLinks(plainText(row.inhoud)).slice(0, 6000),
    source: str(row.bron) || undefined,
    url: safeLink(row.link),
  };
  return defined(news);
}

/** Public news feed of the OSIRIS portal; works without a token. */
export async function news(client: OsirisClient, options: ListOptions = {}): Promise<Listing<NewsItem>> {
  const page = await client.page('/student/nieuws', options, { anonymous: true });
  return listing(page, mapNews);
}
