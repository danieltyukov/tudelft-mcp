import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { connectedClient } from './server.test.js';

const news = JSON.parse(readFileSync(new URL('./fixtures/osiris-nieuws.json', import.meta.url), 'utf8'));

const EXPECTED = [
  'osiris_status',
  'osiris_grades',
  'osiris_progress',
  'osiris_programme',
  'osiris_registrations',
  'osiris_search_courses',
  'osiris_course',
  'osiris_prepare_registration',
  'osiris_confirm_registration',
  'osiris_profile',
  'osiris_timetable',
  'osiris_news',
  'get_timetable',
  'timetable_status',
  'connect_timetable',
  'disconnect_timetable',
  'exam_overview',
  'search_study_guide',
  'get_study_guide',
  'search_study_spaces',
  'search_rooms',
  'search_software',
  'get_software',
  'get_ict_notices',
];

interface ErrorContent {
  error: { code: string };
}

afterEach(() => vi.restoreAllMocks());

describe('OSIRIS, timetable and public tools', () => {
  it('registers every tool with clean descriptions and annotations', async () => {
    const { client, registry } = await connectedClient();
    const { tools } = await client.listTools();
    const names = tools.map((tool) => tool.name);
    for (const name of EXPECTED) expect(names).toContain(name);
    for (const tool of registry.tools) {
      expect(tool.description).not.toMatch(/[\u2013\u2014]/);
      expect(tool.description).not.toMatch(/\p{Extended_Pictographic}/u);
    }
    const byName = new Map(tools.map((tool) => [tool.name, tool]));
    expect(byName.get('osiris_grades')?.annotations?.readOnlyHint).toBe(true);
    expect(byName.get('osiris_prepare_registration')?.annotations?.readOnlyHint).toBe(false);
    expect(byName.get('osiris_confirm_registration')?.annotations?.destructiveHint).toBe(true);
    expect(byName.get('connect_timetable')?.annotations?.readOnlyHint).toBe(false);
    expect(byName.get('disconnect_timetable')?.annotations?.destructiveHint).toBe(true);
    expect(byName.get('osiris_news')?.description).toMatch(/no login/i);
    expect(byName.get('search_study_guide')?.description).toMatch(/no login/i);
  });

  it('reports OSIRIS and timetable as not connected in a fresh data directory', async () => {
    const { client } = await connectedClient();
    const grades = await client.callTool({ name: 'osiris_grades', arguments: {} });
    expect((grades.structuredContent as ErrorContent).error.code).toBe('OSIRIS_AUTH_REQUIRED');
    const timetable = await client.callTool({ name: 'get_timetable', arguments: {} });
    expect((timetable.structuredContent as ErrorContent).error.code).toBe('TIMETABLE_NOT_CONNECTED');
    const status = await client.callTool({ name: 'auth_status', arguments: { verify: false } });
    const services = (status.structuredContent as { services: Record<string, { connected: boolean }> })
      .services;
    expect(services.osiris).toEqual({ connected: false });
    expect(services.timetable).toEqual({ connected: false });
    const overview = await client.callTool({ name: 'exam_overview', arguments: {} });
    expect(overview.isError).toBeFalsy();
    const content = overview.structuredContent as Record<string, { error?: { code: string } }>;
    expect(content.osirisExamRegistrations?.error?.code).toBe('OSIRIS_AUTH_REQUIRED');
    expect(content.timetableExams?.error?.code).toBe('TIMETABLE_NOT_CONNECTED');
  });

  it('serves public OSIRIS news without a session', async () => {
    const { client } = await connectedClient();
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      expect(String(input)).toContain('/student/osiris/student/nieuws');
      expect(new Headers(init?.headers).get('authorization')).toBeNull();
      return new Response(JSON.stringify(news), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    const result = await client.callTool({ name: 'osiris_news', arguments: { limit: 10 } });
    expect(result.isError).toBeFalsy();
    const content = result.structuredContent as { items: Array<{ title: string }> };
    expect(content.items[0]?.title).toBe('Registration period Q2 opens');
  });

  it('validates the calendar link in connect_timetable', async () => {
    const { client } = await connectedClient();
    const result = await client.callTool({
      name: 'connect_timetable',
      arguments: { icalUrl: 'https://example.com/ical?eu=1&h=2&t=3' },
    });
    expect((result.structuredContent as ErrorContent).error.code).toBe('INVALID_URL');
  });
});
