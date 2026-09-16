import { load } from 'cheerio';
import type { Config } from '../config.js';
import { TudelftError } from '../errors.js';
import { array, num, plainText, record, str, type Row } from '../util/text.js';
import { redactLinks, safeLink } from '../util/url.js';
import { fetchPublicJson } from './http.js';

export type Language = 'en' | 'nl';
const PAGE_SIZE = 30;
const MAX_TOTAL_CHARS = 48_000;
const MAX_SECTION_CHARS = 12_000;
const YEAR = /^\d{4}-\d{4}$/;
const CODE = /^[A-Za-z0-9-]{2,20}$/;

/** Academic years start in September. */
export function currentAcademicYear(now = new Date()): string {
  const year = now.getUTCMonth() >= 8 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
  return `${year}-${year + 1}`;
}

export function checkAcademicYear(value: string | undefined): string {
  const year = value?.trim() || currentAcademicYear();
  if (!YEAR.test(year)) throw new TudelftError('INVALID_ARGUMENT', 'academicYear must look like 2025-2026.');
  return year;
}

/** Localised values are {en, nl} objects; plain strings and arrays also occur. */
export function localized(value: unknown, language: Language): string {
  if (value == null) return '';
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (Array.isArray(value)) {
    return value
      .map((entry) => localized(entry, language))
      .filter(Boolean)
      .join(', ');
  }
  const row = record(value);
  const other: Language = language === 'en' ? 'nl' : 'en';
  const picked = row[language] ?? row[other];
  if (typeof picked === 'string' || typeof picked === 'number' || Array.isArray(picked))
    return localized(picked, language);
  if (picked && typeof picked === 'object') return localized(picked, language);
  const name = row.naam ?? row.name ?? row.titel ?? row.title ?? row.omschrijving ?? row.value;
  return name === undefined ? '' : localized(name, language);
}

function links(html: string): string[] {
  if (!/<a\b/i.test(html)) return [];
  const $ = load(html);
  const out = new Set<string>();
  $('a[href]').each((_i, element) => {
    const href = safeLink($(element).attr('href'));
    if (href) out.add(href);
  });
  return [...out].slice(0, 20);
}

export interface Section {
  key: string;
  title: string;
  text: string;
  links: string[];
}

const SECTIONS: Array<[key: string, title: string, field: string]> = [
  ['description', 'Course description', 'vakbeschrijving'],
  ['learningObjectives', 'Learning objectives', 'leerdoelen'],
  ['teachingMethod', 'Teaching method', 'toelichting_onderwijsmethode'],
  ['contactHours', 'Contact hours per week', 'contacturen_per_week_nederlands'],
  ['assessment', 'Assessment', 'toetsing'],
  ['literature', 'Literature and study materials', 'literatuur_en_studiemateriaal'],
  ['priorKnowledge', 'Expected prior knowledge', 'cr_expected_prior_knowledge_nld'],
  ['admissionRequirements', 'Admission requirements', 'toelatingseisen_nld'],
  ['enrolment', 'Enrolment', 'cr_enrolment_nld_1'],
  ['requiredCourses', 'Required courses', 'cr_required_course'],
  ['givesAccessTo', 'Gives access to', 'cr_gives_access_to'],
  [
    'registrationInfo',
    'Requirements and registration',
    'cr_more_information_on_requirements_and_registration_nld',
  ],
  ['remarks', 'Additional comments', 'cr_addtional_comments_studyguide_nld_1'],
  ['substitution', 'Substitution arrangement', 'cr_explanation_of_the_substitution_arrangement'],
  ['contact', 'Contact information for students', 'contact_informatie_studenten'],
];

export interface Lecturer {
  name: string;
  email?: string;
  role?: string;
}

function lecturer(value: unknown, language: Language, role?: string): Lecturer | undefined {
  if (value == null || value === '') return undefined;
  if (typeof value === 'string') {
    const name = plainText(value);
    if (!name) return undefined;
    const email = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/.exec(name)?.[0];
    const out: Lecturer = {
      name: email
        ? name
            .replace(email, '')
            .replace(/[()<>]/g, '')
            .trim() || email
        : name,
    };
    if (email) out.email = email;
    if (role) out.role = role;
    return out;
  }
  const row = record(value);
  const name = plainText(
    localized(row.naam ?? row.name ?? row.volledige_naam ?? row.full_name ?? row.weergavenaam, language),
  );
  if (!name) return undefined;
  const out: Lecturer = { name };
  const email = str(row.email ?? row.e_mailadres ?? row.mail).trim();
  if (email) out.email = email;
  if (role) out.role = role;
  return out;
}

export interface CourseHeader {
  id: string;
  code: string;
  name: string;
  credits?: number;
  academicYear: string;
  faculty?: string;
  level?: string;
  periods?: string;
  languages?: string;
  status?: string;
  url: string;
}

export interface CourseDetail {
  course: CourseHeader;
  sections: Section[];
  lecturers: Lecturer[];
  programmes: string[];
  truncated: boolean;
  retrievedAt: string;
}

export interface SearchHit {
  id: string;
  code: string;
  name: string;
  credits?: number;
  academicYear: string;
  faculty?: string;
  level?: string;
  periods?: string;
  url: string;
}

function itemData(item: unknown): { id: string; data: Row } {
  const row = record(item);
  const attributes = record(row.attributes);
  return { id: str(row.id), data: record(attributes.data) };
}

export class StudyGuide {
  constructor(private readonly config: Pick<Config, 'studyGuideApiUrl' | 'studyGuideUrl'>) {}

  courseUrl(id: string): string {
    return `${this.config.studyGuideUrl}/courses/study-guide/educations/${encodeURIComponent(id)}`;
  }

  private header(id: string, data: Row, language: Language): SearchHit {
    const hit: SearchHit = {
      id,
      code: localized(data.code, language),
      name: localized(data.course_name_2, language),
      academicYear: localized(data.jaar, language),
      url: this.courseUrl(id),
    };
    const credits = num(localized(data.studiepunten_ects, language).replace(',', '.'));
    if (credits !== undefined) hit.credits = credits;
    const faculty = localized(data.faculteit, language);
    if (faculty) hit.faculty = faculty;
    const level = localized(data.cr_level, language);
    if (level) hit.level = level;
    const periods = localized(data.cr_course_start, language);
    if (periods) hit.periods = periods;
    return hit;
  }

  private async searchPage(
    query: string,
    academicYear: string,
    language: Language,
    offset: number,
  ): Promise<{ hits: SearchHit[]; raw: Array<{ id: string; data: Row }>; total: number }> {
    const url = `${this.config.studyGuideApiUrl}/publisher/api/v0/courses/items/search?size=${PAGE_SIZE}&offset=${Math.max(0, Math.floor(offset))}`;
    const payload = record(
      await fetchPublicJson(url, {
        method: 'POST',
        body: { query, filters: { jaar: [academicYear] }, language },
        label: 'Study Guide',
      }),
    );
    const raw = array(payload.data)
      .map(itemData)
      .filter((entry) => entry.id);
    const total = num(record(payload.meta).total) ?? raw.length;
    return { hits: raw.map((entry) => this.header(entry.id, entry.data, language)), raw, total };
  }

  async search(
    query: string,
    options: { academicYear?: string; language?: Language; offset?: number } = {},
  ): Promise<Record<string, unknown>> {
    const text = query.trim();
    if (!text) throw new TudelftError('INVALID_ARGUMENT', 'query must not be empty.');
    const academicYear = checkAcademicYear(options.academicYear);
    const language = options.language ?? 'en';
    const offset = Math.max(0, Math.floor(options.offset ?? 0));
    const page = await this.searchPage(text.slice(0, 200), academicYear, language, offset);
    const nextOffset = offset + page.hits.length;
    const hasMore = page.hits.length > 0 && nextOffset < page.total;
    return {
      query: text,
      academicYear,
      language,
      offset,
      total: page.total,
      count: page.hits.length,
      nextOffset: hasMore ? nextOffset : undefined,
      complete: !hasMore,
      items: page.hits,
      note: 'Catalogue entries describe courses on offer; presence here does not mean enrolment or that a place is available.',
    };
  }

  /** Resolve an exact course code through search (at most three pages), then read the detail record. */
  async course(
    code: string,
    options: { academicYear?: string; language?: Language } = {},
  ): Promise<CourseDetail> {
    const wanted = code.trim().toUpperCase();
    if (!CODE.test(wanted))
      throw new TudelftError('INVALID_ARGUMENT', 'code must be a course code such as EE4109.');
    const academicYear = checkAcademicYear(options.academicYear);
    const language = options.language ?? 'en';
    let found: { id: string; data: Row } | undefined;
    let offset = 0;
    for (let page = 0; page < 3 && !found; page++) {
      const result = await this.searchPage(wanted, academicYear, language, offset);
      found = result.raw.find((entry) => localized(entry.data.code, language).toUpperCase() === wanted);
      offset += result.raw.length;
      if (!result.raw.length || offset >= result.total) break;
    }
    if (!found)
      throw new TudelftError(
        'NOT_FOUND',
        `No course with code ${wanted} in the ${academicYear} Study Guide.`,
        {
          code: wanted,
          academicYear,
        },
      );
    const detail = record(
      await fetchPublicJson(
        `${this.config.studyGuideApiUrl}/publisher/api/v0/courses/items/${encodeURIComponent(found.id)}`,
        { label: 'Study Guide' },
      ),
    );
    const entry = itemData(detail.data);
    const data = Object.keys(entry.data).length ? entry.data : found.data;
    const id = entry.id || found.id;
    return this.render(id, data, academicYear, language);
  }

  render(id: string, data: Row, academicYear: string, language: Language): CourseDetail {
    const head = this.header(id, data, language);
    const course: CourseHeader = { ...head, academicYear: head.academicYear || academicYear };
    const languages = localized(data.voertaal, language);
    if (languages) course.languages = languages;
    const status = localized(data.status, language);
    if (status) course.status = status;

    const lecturers: Lecturer[] = [];
    for (const index of [1, 2, 3, 4]) {
      const person = lecturer(data[`verantwoordelijk_docent_${index}`], language, 'responsible');
      if (person) lecturers.push(person);
    }
    for (const person of array(data.docenten)) {
      const parsed = lecturer(person, language);
      if (parsed && !lecturers.some((known) => known.name === parsed.name)) lecturers.push(parsed);
    }
    if (!Array.isArray(data.docenten)) {
      const parsed = lecturer(data.docenten, language);
      if (parsed && !lecturers.some((known) => known.name === parsed.name)) lecturers.push(parsed);
    }

    const programmes = array(data.opleidingen_namen)
      .map((entry) => localized(entry, language))
      .filter(Boolean);
    if (!programmes.length) {
      const single = localized(data.opleidingen_namen, language);
      if (single) programmes.push(single);
    }

    let truncated = false;
    let budget = MAX_TOTAL_CHARS;
    const sections: Section[] = [];
    for (const [key, title, field] of SECTIONS) {
      const html = localized(data[field], language);
      if (!html.trim()) continue;
      let text = redactLinks(plainText(html));
      if (!text) continue;
      if (text.length > MAX_SECTION_CHARS) {
        text = `${text.slice(0, MAX_SECTION_CHARS)} [truncated]`;
        truncated = true;
      }
      if (text.length > budget) {
        text = budget > 200 ? `${text.slice(0, budget)} [truncated]` : '';
        truncated = true;
        if (!text) break;
      }
      budget -= text.length;
      sections.push({ key, title, text, links: links(html) });
    }
    return {
      course,
      sections,
      lecturers: lecturers.slice(0, 30),
      programmes: programmes.slice(0, 50),
      truncated,
      retrievedAt: new Date().toISOString(),
    };
  }
}
