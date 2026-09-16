import type { BrightspaceClient } from './client.js';
import { record, str } from '../util/text.js';
import { safeLink } from '../util/url.js';
import { TudelftError } from '../errors.js';

export interface Course {
  id: string;
  name: string;
  code: string;
  /** Parsed from codes like "EE4109+2025+2": course code, academic year and period. */
  courseCode?: string;
  academicYear?: string;
  period?: string;
  url?: string;
  active: boolean;
  canAccess: boolean;
  startDate: string | null;
  endDate: string | null;
  role?: string;
  pinned: boolean;
  isOrganisation: boolean;
}

const CODE = /^([A-Z]{2,6}\d{3,5}[A-Z0-9-]*)\+(\d{4})\+(\d{1,2})$/i;

export function parseCourse(item: unknown): Course | undefined {
  const row = record(item);
  const unit = record(row.OrgUnit);
  const access = record(row.Access);
  const id = str(unit.Id);
  if (!/^\d+$/.test(id)) return undefined;
  const code = str(unit.Code);
  const match = CODE.exec(code);
  const course: Course = {
    id,
    name: str(unit.Name),
    code,
    active: access.IsActive !== false,
    canAccess: access.CanAccess !== false,
    startDate: typeof access.StartDate === 'string' ? access.StartDate : null,
    endDate: typeof access.EndDate === 'string' ? access.EndDate : null,
    pinned: Boolean(row.PinDate),
    isOrganisation: /ORG$/i.test(code) || /organis/i.test(str(unit.Name)),
  };
  const url = safeLink(unit.HomeUrl, 'https://brightspace.tudelft.nl');
  if (url) course.url = url;
  const role = str(access.ClasslistRoleName);
  if (role) course.role = role;
  if (match) {
    course.courseCode = match[1]!.toUpperCase();
    const year = Number(match[2]);
    course.academicYear = `${year}-${year + 1}`;
    course.period = `Q${match[3]}`;
  }
  return course;
}

export interface CourseFilter {
  query?: string;
  activeOnly?: boolean;
  includeOrganisations?: boolean;
}

export async function listCourses(
  client: BrightspaceClient,
  filter: CourseFilter = {},
): Promise<{ items: Course[]; complete: boolean }> {
  const result = await client.list('lp', 'enrollments/myenrollments/', { orgUnitTypeId: '3' });
  const query = filter.query?.trim().toLowerCase();
  const items = result.items
    .map(parseCourse)
    .filter((course): course is Course => Boolean(course))
    .filter((course) => ((filter.activeOnly ?? true) ? course.active && course.canAccess : true))
    .filter((course) => (filter.includeOrganisations ? true : !course.isOrganisation))
    .filter(
      (course) =>
        !query || `${course.name} ${course.code} ${course.courseCode ?? ''}`.toLowerCase().includes(query),
    )
    .sort((a, b) => (b.startDate ?? '').localeCompare(a.startDate ?? '') || a.name.localeCompare(b.name));
  return { items, complete: result.complete };
}

/** Resolve a course by id, exact course code, or unique name match. */
export async function resolveCourse(client: BrightspaceClient, ref: string): Promise<Course> {
  const wanted = ref.trim();
  const { items } = await listCourses(client, { activeOnly: false, includeOrganisations: true });
  if (/^\d+$/.test(wanted)) {
    const byId = items.find((course) => course.id === wanted);
    if (byId) return byId;
  }
  const upper = wanted.toUpperCase();
  const byCode = items.filter((course) => course.courseCode === upper || course.code.toUpperCase() === upper);
  if (byCode.length === 1) return byCode[0]!;
  if (byCode.length > 1) {
    const active = byCode.filter((course) => course.active);
    if (active.length === 1) return active[0]!;
    throw new TudelftError(
      'INVALID_ARGUMENT',
      'Several courses match this code. Use the numeric id from list_courses.',
      {
        matches: byCode.map((course) => ({ id: course.id, code: course.code, name: course.name })),
      },
    );
  }
  const byName = items.filter((course) => course.name.toLowerCase().includes(wanted.toLowerCase()));
  if (byName.length === 1) return byName[0]!;
  throw new TudelftError(
    'NOT_FOUND',
    'No enrolled course matches this reference. Use list_courses to find the id.',
    {
      matches: byName.slice(0, 5).map((course) => ({ id: course.id, code: course.code, name: course.name })),
    },
  );
}
