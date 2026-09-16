import type { AppContext } from '../context.js';
import { TudelftError } from '../errors.js';
import { array, num, record, sha256, str, type Row } from '../util/text.js';
import { statusMessages, type Method, type OsirisClient, type StatusMessage } from './client.js';
import { osirisClient } from './install.js';
import {
  CATALOGUE_PATHS,
  REGISTRATION_PATHS,
  checkId,
  sanitize,
  summarise,
  yesNo,
  type CatalogueKind,
  type Summary,
} from './records.js';

export const PREVIEW_KIND = 'osiris_registration';

export interface RegistrationInput {
  kind: CatalogueKind;
  action: 'enroll' | 'withdraw';
  /** Course block id (course enrolment) or course id for exam registration (from osiris_search_courses). */
  courseId?: string;
  /** Exam opportunity id (exam enrolment) or the registration id to withdraw. */
  targetId?: string;
  /** Assessment codes (toets) to include for a course enrolment. */
  examCodes?: string[];
  /** Working method codes (werkvorm) to include for a course enrolment. */
  workingMethods?: string[];
}

export interface RegistrationPlan {
  method: Method;
  path: string;
  body?: unknown;
  /** Id used to verify the outcome by re-reading the registration. */
  verifyId: string;
  summary: Record<string, unknown>;
  notes: string[];
}

export interface PreviewPayload {
  input: RegistrationInput;
  method: Method;
  path: string;
  body?: unknown;
  digest: string;
  verifyId: string;
}

const yes = (value: unknown): boolean => yesNo(value) === true;
const no = (value: unknown): boolean => yesNo(value) === false;

function digestOf(plan: RegistrationPlan): string {
  return sha256(JSON.stringify({ method: plan.method, path: plan.path, body: plan.body ?? null }));
}

function blocking(messages: StatusMessage[]): StatusMessage[] {
  return messages.filter((message) => message.type === 'E' || message.type === 'W');
}

/** True when any nested object carries a non-empty "voorzieningen" (accommodation) list. */
export function hasAccommodations(value: unknown, depth = 0): boolean {
  if (depth > 8 || !value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some((entry) => hasAccommodations(entry, depth + 1));
  for (const [key, entry] of Object.entries(value as Row)) {
    if (key === 'voorzieningen' && Array.isArray(entry) && entry.length > 0) return true;
    if (hasAccommodations(entry, depth + 1)) return true;
  }
  return false;
}

export function needsGroupPreferences(details: Row): boolean {
  if (array(details.werkvormgroepen_per_werkvorm).length > 0) return true;
  if ((num(details.min_voorkeursgroepen) ?? 0) > 0) return true;
  if (details.id_zaak_def !== undefined && details.id_zaak_def !== null && str(details.id_zaak_def) !== '')
    return true;
  return false;
}

export function needsPayment(details: Row): boolean {
  if (array(details.kosten).length > 0) return true;
  if ((num(details.bedrag) ?? 0) > 0) return true;
  if (yes(details.moet_student_betalen)) return true;
  return false;
}

function refuseCommon(details: Row, label: string): void {
  if (yes(details.ingeschreven))
    throw new TudelftError('ALREADY_DONE', `You are already registered for this ${label} in OSIRIS.`);
  if (no(details.inschrijven_toegestaan))
    throw new TudelftError('NOT_ALLOWED', `OSIRIS does not allow registration for this ${label} right now.`);
  if (no(details.open_voor_inschrijving))
    throw new TudelftError('NOT_ALLOWED', `This ${label} is not open for registration in OSIRIS.`);
  if (num(details.beschikbare_plekken) === 0)
    throw new TudelftError('NOT_ALLOWED', `This ${label} has no places left in OSIRIS.`);
  if (needsGroupPreferences(details))
    throw new TudelftError(
      'NOT_ALLOWED',
      `This ${label} asks for group preferences, which must be chosen in OSIRIS itself (my.tudelft.nl).`,
    );
  if (needsPayment(details))
    throw new TudelftError(
      'NOT_ALLOWED',
      `This ${label} requires a payment step; complete it in OSIRIS itself.`,
    );
  if (hasAccommodations(details))
    throw new TudelftError(
      'NOT_ALLOWED',
      `This ${label} involves exam accommodations (voorzieningen); register in OSIRIS itself so they are applied correctly.`,
    );
}

async function existingRegistration(
  client: OsirisClient,
  kind: CatalogueKind,
  id: string,
): Promise<Row | undefined> {
  try {
    const payload = await client.request(`/student/inschrijvingen/${REGISTRATION_PATHS[kind]}/${id}`);
    const row = record(payload);
    return Object.keys(row).length > 0 ? row : undefined;
  } catch (error) {
    if (error instanceof TudelftError && error.code === 'NOT_FOUND') return undefined;
    throw error;
  }
}

async function precheck(
  client: OsirisClient,
  kind: CatalogueKind,
  courseId: string,
): Promise<StatusMessage[]> {
  const payload = await client.request(`/student/${CATALOGUE_PATHS[kind]}/${courseId}/controleren`);
  const messages = statusMessages(payload);
  const blockers = blocking(messages);
  if (blockers.length > 0) {
    throw new TudelftError('NOT_ALLOWED', 'OSIRIS reports conditions that block this registration.', {
      messages: blockers,
    });
  }
  return messages;
}

function selectRows(rows: unknown[], codeKey: string, wanted: string[] | undefined, label: string): Row[] {
  const list = rows.map(record);
  if (!wanted) return list;
  const codes = new Set(wanted.map((code) => code.trim().toUpperCase()).filter(Boolean));
  const available = list.map((row) => str(row[codeKey]).toUpperCase());
  for (const code of codes) {
    if (!available.includes(code))
      throw new TudelftError('INVALID_ARGUMENT', `Unknown ${label} code "${code}" for this course block.`, {
        available: list.map((row) => ({
          code: str(row[codeKey]),
          name: str(row.omschrijving || row[`${codeKey}_omschrijving`]),
        })),
      });
  }
  return list.filter(
    (row) => yes(row.automatisch_ingeschreven) || codes.has(str(row[codeKey]).toUpperCase()),
  );
}

async function planCourseEnrol(client: OsirisClient, input: RegistrationInput): Promise<RegistrationPlan> {
  const courseId = checkId(input.courseId ?? '', 'courseId');
  const notes: string[] = [];
  const messages = await precheck(client, 'course', courseId);
  const details = record(await client.request(`/student/${CATALOGUE_PATHS.course}/${courseId}`));
  if (str(details.id_cursus_blok) !== courseId) {
    throw new TudelftError(
      'INVALID_ARGUMENT',
      'courseId must be an exact course block id. Use osiris_course with section "blocks" to list the blocks of a course.',
      { courseId, blockId: str(details.id_cursus_blok) || null },
    );
  }
  refuseCommon(details, 'course');
  if (await existingRegistration(client, 'course', courseId))
    throw new TudelftError('ALREADY_DONE', 'OSIRIS already holds a registration for this course block.');
  const toetsen = selectRows(array(details.toetsen), 'toets', input.examCodes, 'assessment');
  const werkvormen = selectRows(
    array(details.werkvormen),
    'werkvorm',
    input.workingMethods,
    'working method',
  );
  if (!input.examCodes && toetsen.length > 0)
    notes.push('No examCodes given: every listed assessment is included.');
  if (!input.workingMethods && werkvormen.length > 0)
    notes.push('No workingMethods given: every listed working method is included.');
  for (const message of messages.filter((entry) => entry.type === 'I')) notes.push(message.text);
  const body: Row = { ...details, toetsen, werkvormen };
  const summary = summarise(details, ['id_cursus_blok']);
  return {
    method: 'PUT',
    path: `/student/inschrijvingen/cursussen/${courseId}`,
    body,
    verifyId: courseId,
    summary: {
      action: 'enroll',
      kind: 'course',
      courseBlockId: courseId,
      course: describe(summary),
      assessments: toetsen.map((row) => ({
        code: str(row.toets),
        name: str(row.toets_omschrijving || row.omschrijving),
        automatic: yes(row.automatisch_ingeschreven),
      })),
      workingMethods: werkvormen.map((row) => ({
        code: str(row.werkvorm),
        name: str(row.werkvorm_omschrijving || row.omschrijving),
        automatic: yes(row.automatisch_ingeschreven),
      })),
    },
    notes,
  };
}

async function planExamEnrol(client: OsirisClient, input: RegistrationInput): Promise<RegistrationPlan> {
  const courseId = checkId(input.courseId ?? '', 'courseId');
  const targetId = checkId(input.targetId ?? '', 'targetId');
  const notes: string[] = [];
  const messages = await precheck(client, 'exam', courseId);
  const details = record(await client.request(`/student/${CATALOGUE_PATHS.exam}/${courseId}`));
  const opportunities = array(details.toetsen).map(record);
  const opportunity = opportunities.find((row) => str(row.id_toets_gelegenheid) === targetId);
  if (!opportunity) {
    throw new TudelftError(
      'INVALID_ARGUMENT',
      'targetId must be one of the exam opportunities of this course.',
      {
        available: opportunities.map((row) => ({
          id: str(row.id_toets_gelegenheid),
          assessment: str(row.toets_omschrijving || row.omschrijving),
          code: str(row.toets),
          date: str(row.toetsdatum),
        })),
      },
    );
  }
  refuseCommon({ ...details, ...opportunity, toetsen: undefined }, 'exam');
  if (hasAccommodations(details))
    throw new TudelftError(
      'NOT_ALLOWED',
      'This exam involves accommodations (voorzieningen); register in OSIRIS itself.',
    );
  if (await existingRegistration(client, 'exam', targetId))
    throw new TudelftError('ALREADY_DONE', 'OSIRIS already holds a registration for this exam opportunity.');
  for (const message of messages.filter((entry) => entry.type === 'I')) notes.push(message.text);
  const summary = summarise(opportunity, ['id_toets_gelegenheid']);
  return {
    method: 'POST',
    path: '/student/inschrijvingen/toetsen/',
    body: { toetsen: [opportunity] },
    verifyId: targetId,
    summary: {
      action: 'enroll',
      kind: 'exam',
      courseId,
      examOpportunityId: targetId,
      exam: describe(summary),
    },
    notes,
  };
}

async function planWithdraw(client: OsirisClient, input: RegistrationInput): Promise<RegistrationPlan> {
  const targetId = checkId(input.targetId ?? '', 'targetId');
  const existing = await existingRegistration(client, input.kind, targetId);
  if (!existing)
    throw new TudelftError(
      'NOT_FOUND',
      'OSIRIS has no registration with this id. Use osiris_registrations to find it.',
    );
  if (!yes(existing.mag_uitschrijven))
    throw new TudelftError(
      'NOT_ALLOWED',
      'OSIRIS does not allow withdrawing from this registration (mag_uitschrijven is not J).',
    );
  const summary = summarise(existing);
  return {
    method: 'DELETE',
    path: `/student/inschrijvingen/${REGISTRATION_PATHS[input.kind]}/${targetId}`,
    verifyId: targetId,
    summary: {
      action: 'withdraw',
      kind: input.kind,
      registrationId: targetId,
      registration: describe(summary),
    },
    notes: [],
  };
}

function describe(summary: Summary): Record<string, unknown> {
  const { data: _data, ...rest } = summary;
  return rest;
}

export async function buildPlan(client: OsirisClient, input: RegistrationInput): Promise<RegistrationPlan> {
  if (input.action === 'withdraw') return planWithdraw(client, input);
  return input.kind === 'exam' ? planExamEnrol(client, input) : planCourseEnrol(client, input);
}

async function accountId(ctx: AppContext): Promise<string> {
  return (await ctx.brightspace.identity()).id;
}

/** Build the registration plan, store it as a preview and return what will be sent. */
export async function prepareRegistration(
  ctx: AppContext,
  input: RegistrationInput,
): Promise<Record<string, unknown>> {
  const client = osirisClient(ctx);
  await client.session();
  const plan = await buildPlan(client, input);
  const digest = digestOf(plan);
  const payload: PreviewPayload = {
    input,
    method: plan.method,
    path: plan.path,
    digest,
    verifyId: plan.verifyId,
  };
  if (plan.body !== undefined) payload.body = plan.body;
  const preview = ctx.previews.create(PREVIEW_KIND, await accountId(ctx), payload);
  return {
    confirmationToken: preview.token,
    expiresAt: new Date(preview.expiresAt).toISOString(),
    preview: plan.summary,
    request: {
      method: plan.method,
      path: plan.path,
      body: plan.body === undefined ? null : sanitize(plan.body),
    },
    notes: plan.notes,
    instruction:
      'Show this preview to the student. Call osiris_confirm_registration with this token and confirmed: true only after they explicitly approve.',
  };
}

async function verifyOutcome(
  client: OsirisClient,
  kind: CatalogueKind,
  verifyId: string,
  action: 'enroll' | 'withdraw',
): Promise<'registered' | 'withdrawn' | undefined> {
  const existing = await existingRegistration(client, kind, verifyId);
  if (action === 'enroll') {
    if (existing && !no(existing.ingeschreven)) return 'registered';
    const page = await client.page(`/student/inschrijvingen/${REGISTRATION_PATHS[kind]}?toon_historie=N`, {
      offset: 0,
      limit: 100,
    });
    const found = page.items
      .map(record)
      .some((row) =>
        [row.id_inschrijving, row.id_cursus_blok, row.id_toets_gelegenheid, row.id].some(
          (value) => str(value) === verifyId,
        ),
      );
    return found ? 'registered' : undefined;
  }
  if (!existing || no(existing.ingeschreven)) return 'withdrawn';
  return undefined;
}

/** Consume the preview, recheck the plan, send once, verify by re-reading. Never retries. */
export async function confirmRegistration(
  ctx: AppContext,
  token: string,
  confirmed: boolean,
): Promise<Record<string, unknown>> {
  const client = osirisClient(ctx);
  const preview = ctx.previews.consume<PreviewPayload>(token, PREVIEW_KIND, await accountId(ctx), confirmed);
  const { input } = preview.payload;
  const plan = await buildPlan(client, input);
  if (digestOf(plan) !== preview.payload.digest) {
    throw new TudelftError(
      'PREVIEW_CHANGED',
      'The registration details changed since the preview. Prepare it again and ask for approval.',
    );
  }
  const response = await client.request(plan.path, plan.method, plan.body);
  const messages = statusMessages(response);
  const status = await verifyOutcome(client, input.kind, plan.verifyId, input.action);
  if (!status) {
    throw new TudelftError(
      'OUTCOME_UNKNOWN',
      'OSIRIS did not confirm the change. Check your registrations in OSIRIS before trying again; do not repeat the request blindly.',
      { messages },
    );
  }
  return {
    status,
    action: input.action,
    kind: input.kind,
    targetId: plan.verifyId,
    messages,
    verifiedAt: new Date().toISOString(),
  };
}
