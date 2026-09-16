import { readFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../../src/config.js';
import { createContext, type AppContext } from '../../src/context.js';
import { installExtensions } from '../../src/extensions.js';
import { confirmRegistration, prepareRegistration } from '../../src/osiris/registration.js';
import { sha256 } from '../../src/util/text.js';

type Row = Record<string, unknown>;
const fixture = (name: string): Row =>
  JSON.parse(readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8')) as Row;
const examDetails = () => structuredClone(fixture('osiris-exam-details.json'));
const courseDetails = () => structuredClone(fixture('osiris-course-details.json'));

const BASE = 'https://my.tudelft.nl/student/osiris';

interface Backend {
  details: Row;
  controleren: Row;
  registrations: Map<string, Row>;
  calls: Array<{ method: string; path: string; body?: unknown }>;
  /** What the write does to the registrations map. */
  onWrite?: (method: string, path: string, body: unknown) => void;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function mount(backend: Backend): void {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    const path = url.pathname.replace('/student/osiris', '') + url.search;
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    backend.calls.push(body === undefined ? { method, path } : { method, path, body });
    expect(url.href.startsWith(BASE)).toBe(true);
    if (method === 'GET' && /\/controleren$/.test(path)) return json(backend.controleren);
    if (method === 'GET' && /^\/student\/cursussen_voor_(?:cursus|toets)inschrijving\/[^/]+$/.test(path))
      return json(backend.details);
    const reg = /^\/student\/inschrijvingen\/(cursussen|toetsen)\/([^/?]+)$/.exec(path);
    if (method === 'GET' && reg) {
      const existing = backend.registrations.get(reg[2]!);
      return existing ? json(existing) : json({ message: 'not found' }, 404);
    }
    if (method === 'GET' && /^\/student\/inschrijvingen\/(cursussen|toetsen)\?/.test(path)) {
      return json({ items: [...backend.registrations.values()], hasMore: false, offset: 0, limit: 100 });
    }
    if (method === 'PUT' || method === 'POST' || method === 'DELETE') {
      backend.onWrite?.(method, path, body);
      return json({ statusmeldingen: [{ type: 'I', tekst: 'Processed' }] });
    }
    throw new Error(`unexpected ${method} ${path}`);
  });
}

async function makeContext(): Promise<AppContext> {
  const dir = await mkdtemp(join(tmpdir(), 'tudelft-'));
  const ctx = createContext(loadConfig({ TUDELFT_MCP_HOME: dir }));
  installExtensions(ctx);
  await ctx.session.update((data) => {
    data.brightspace = {
      origin: ctx.config.brightspaceUrl,
      cookies: [],
      identity: { id: '1', name: 'Test Student', uniqueName: 'tstudent' },
      savedAt: new Date().toISOString(),
    };
    data.osiris = {
      origin: ctx.config.osirisUrl,
      token: 'token-1',
      expiresAt: null,
      cookies: [],
      studentHash: sha256('1234567'),
      savedAt: new Date().toISOString(),
    };
  });
  return ctx;
}

function backendFor(details: Row): Backend {
  return { details, controleren: { statusmeldingen: [] }, registrations: new Map(), calls: [] };
}

afterEach(() => vi.restoreAllMocks());

describe('exam registration', () => {
  const input = {
    kind: 'exam' as const,
    action: 'enroll' as const,
    courseId: 'scur:77',
    targetId: 'scto:123',
  };

  it('previews, confirms once with digest verification and verifies the outcome', async () => {
    const ctx = await makeContext();
    const backend = backendFor(examDetails());
    backend.onWrite = (method, path, body) => {
      expect(method).toBe('POST');
      expect(path).toBe('/student/inschrijvingen/toetsen/');
      const sent = body as { toetsen: Row[] };
      expect(sent.toetsen).toHaveLength(1);
      expect(sent.toetsen[0]!.id_toets_gelegenheid).toBe('scto:123');
      backend.registrations.set('scto:123', {
        ...sent.toetsen[0]!,
        ingeschreven: 'J',
        mag_uitschrijven: 'J',
      });
    };
    mount(backend);
    const preview = await prepareRegistration(ctx, input);
    expect(preview.confirmationToken).toEqual(expect.any(String));
    expect(preview.preview).toMatchObject({
      action: 'enroll',
      kind: 'exam',
      examOpportunityId: 'scto:123',
      exam: { assessment: 'Written exam', startTime: '13:30', endTime: '16:00' },
    });
    expect(backend.calls.some((call) => call.method !== 'GET')).toBe(false);
    const result = await confirmRegistration(ctx, preview.confirmationToken as string, true);
    expect(result).toMatchObject({
      status: 'registered',
      action: 'enroll',
      kind: 'exam',
      targetId: 'scto:123',
    });
    expect(backend.calls.filter((call) => call.method === 'POST')).toHaveLength(1);
    await expect(confirmRegistration(ctx, preview.confirmationToken as string, true)).rejects.toMatchObject({
      code: 'PREVIEW_EXPIRED',
    });
  });

  it('refuses to confirm when the plan changed since the preview', async () => {
    const ctx = await makeContext();
    const backend = backendFor(examDetails());
    mount(backend);
    const preview = await prepareRegistration(ctx, input);
    (backend.details.toetsen as Row[])[0]!.locatie = 'Sports hall';
    await expect(confirmRegistration(ctx, preview.confirmationToken as string, true)).rejects.toMatchObject({
      code: 'PREVIEW_CHANGED',
    });
    expect(backend.calls.some((call) => call.method !== 'GET')).toBe(false);
  });

  it('requires confirmed: true and a matching account', async () => {
    const ctx = await makeContext();
    mount(backendFor(examDetails()));
    const preview = await prepareRegistration(ctx, input);
    await expect(confirmRegistration(ctx, preview.confirmationToken as string, false)).rejects.toMatchObject({
      code: 'CONFIRMATION_REQUIRED',
    });
  });

  it('reports OUTCOME_UNKNOWN when OSIRIS does not show the registration afterwards', async () => {
    const ctx = await makeContext();
    mount(backendFor(examDetails()));
    const preview = await prepareRegistration(ctx, input);
    await expect(confirmRegistration(ctx, preview.confirmationToken as string, true)).rejects.toMatchObject({
      code: 'OUTCOME_UNKNOWN',
    });
  });

  it('refuses when the precheck reports errors or warnings', async () => {
    const ctx = await makeContext();
    const backend = backendFor(examDetails());
    backend.controleren = { statusmeldingen: [{ type: 'W', tekst: 'Registration period closes soon' }] };
    mount(backend);
    await expect(prepareRegistration(ctx, input)).rejects.toMatchObject({
      code: 'NOT_ALLOWED',
      details: { messages: [{ type: 'W', text: 'Registration period closes soon' }] },
    });
  });

  it('refuses unknown opportunities, closed ones, full ones and existing registrations', async () => {
    const ctx = await makeContext();
    const backend = backendFor(examDetails());
    mount(backend);
    await expect(prepareRegistration(ctx, { ...input, targetId: 'scto:999' })).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
    });
    await expect(prepareRegistration(ctx, { ...input, targetId: 'scto:124' })).rejects.toMatchObject({
      code: 'NOT_ALLOWED',
    });
    (backend.details.toetsen as Row[])[0]!.beschikbare_plekken = 0;
    await expect(prepareRegistration(ctx, input)).rejects.toMatchObject({ code: 'NOT_ALLOWED' });
    backend.details = examDetails();
    (backend.details.toetsen as Row[])[0]!.ingeschreven = 'J';
    await expect(prepareRegistration(ctx, input)).rejects.toMatchObject({ code: 'ALREADY_DONE' });
    backend.details = examDetails();
    backend.registrations.set('scto:123', { id_toets_gelegenheid: 'scto:123', ingeschreven: 'J' });
    await expect(prepareRegistration(ctx, input)).rejects.toMatchObject({ code: 'ALREADY_DONE' });
  });

  it('refuses exams with accommodations or payment', async () => {
    const ctx = await makeContext();
    const backend = backendFor(examDetails());
    mount(backend);
    (backend.details.toetsen as Row[])[1]!.voorzieningen = [{ code: 'EXTRA_TIME' }];
    await expect(prepareRegistration(ctx, input)).rejects.toMatchObject({ code: 'NOT_ALLOWED' });
    backend.details = examDetails();
    backend.details.kosten = [{ bedrag: 25 }];
    await expect(prepareRegistration(ctx, input)).rejects.toMatchObject({ code: 'NOT_ALLOWED' });
  });
});

describe('course registration', () => {
  const input = { kind: 'course' as const, action: 'enroll' as const, courseId: 'scbl:900' };

  it('selects assessments and working methods by code and always includes automatic rows', async () => {
    const ctx = await makeContext();
    const backend = backendFor(courseDetails());
    mount(backend);
    const preview = await prepareRegistration(ctx, { ...input, examCodes: ['prj'], workingMethods: [] });
    const request = preview.request as { method: string; path: string; body: Row };
    expect(request.method).toBe('PUT');
    expect(request.path).toBe('/student/inschrijvingen/cursussen/scbl:900');
    expect((request.body.toetsen as Row[]).map((row) => row.toets)).toEqual(['WEX', 'PRJ']);
    expect((request.body.werkvormen as Row[]).map((row) => row.werkvorm)).toEqual(['HC']);
    expect(preview.notes).toEqual([]);
    const all = await prepareRegistration(ctx, input);
    expect(((all.request as { body: Row }).body.werkvormen as Row[]).map((row) => row.werkvorm)).toEqual([
      'HC',
      'LAB',
    ]);
    expect(all.notes).toHaveLength(2);
    await expect(prepareRegistration(ctx, { ...input, examCodes: ['NOPE'] })).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
    });
  });

  it('requires an exact course block and refuses group preferences and closed registration', async () => {
    const ctx = await makeContext();
    const backend = backendFor(courseDetails());
    mount(backend);
    await expect(prepareRegistration(ctx, { ...input, courseId: 'scur:77' })).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
    });
    backend.details.min_voorkeursgroepen = 1;
    await expect(prepareRegistration(ctx, input)).rejects.toMatchObject({ code: 'NOT_ALLOWED' });
    backend.details = courseDetails();
    backend.details.werkvormgroepen_per_werkvorm = [{ werkvorm: 'LAB', groepen: ['A', 'B'] }];
    await expect(prepareRegistration(ctx, input)).rejects.toMatchObject({ code: 'NOT_ALLOWED' });
    backend.details = courseDetails();
    backend.details.id_zaak_def = 'zaak:1';
    await expect(prepareRegistration(ctx, input)).rejects.toMatchObject({ code: 'NOT_ALLOWED' });
    backend.details = courseDetails();
    backend.details.open_voor_inschrijving = 'N';
    await expect(prepareRegistration(ctx, input)).rejects.toMatchObject({ code: 'NOT_ALLOWED' });
    backend.details = courseDetails();
    backend.details.moet_student_betalen = 'J';
    await expect(prepareRegistration(ctx, input)).rejects.toMatchObject({ code: 'NOT_ALLOWED' });
  });

  it('confirms a course enrolment and verifies it through the registration list', async () => {
    const ctx = await makeContext();
    const backend = backendFor(courseDetails());
    backend.onWrite = (method, path) => {
      expect(method).toBe('PUT');
      expect(path).toBe('/student/inschrijvingen/cursussen/scbl:900');
      backend.registrations.set('reg-1', {
        id_inschrijving: 'reg-1',
        id_cursus_blok: 'scbl:900',
        ingeschreven: 'J',
      });
    };
    mount(backend);
    const preview = await prepareRegistration(ctx, input);
    const result = await confirmRegistration(ctx, preview.confirmationToken as string, true);
    expect(result.status).toBe('registered');
  });
});

describe('withdrawal', () => {
  it('requires mag_uitschrijven and verifies removal', async () => {
    const ctx = await makeContext();
    const backend = backendFor(examDetails());
    backend.registrations.set('scto:123', {
      id_toets_gelegenheid: 'scto:123',
      ingeschreven: 'J',
      mag_uitschrijven: 'N',
    });
    mount(backend);
    const input = { kind: 'exam' as const, action: 'withdraw' as const, targetId: 'scto:123' };
    await expect(prepareRegistration(ctx, input)).rejects.toMatchObject({ code: 'NOT_ALLOWED' });
    await expect(prepareRegistration(ctx, { ...input, targetId: 'scto:404' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    backend.registrations.set('scto:123', {
      id_toets_gelegenheid: 'scto:123',
      ingeschreven: 'J',
      mag_uitschrijven: 'J',
    });
    backend.onWrite = (method, path) => {
      expect(method).toBe('DELETE');
      expect(path).toBe('/student/inschrijvingen/toetsen/scto:123');
      backend.registrations.delete('scto:123');
    };
    const preview = await prepareRegistration(ctx, input);
    expect(preview.request).toMatchObject({ method: 'DELETE', body: null });
    const result = await confirmRegistration(ctx, preview.confirmationToken as string, true);
    expect(result.status).toBe('withdrawn');
    expect(backend.calls.filter((call) => call.method === 'DELETE')).toHaveLength(1);
  });
});
