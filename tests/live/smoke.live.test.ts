/**
 * Live smoke test. Runs only with TUDELFT_LIVE=1 on a machine where
 * "tudelft-mcp login" has been completed. Reads only; never writes.
 * Prints nothing personal: only counts, codes and status.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config.js';
import { createContext } from '../../src/context.js';
import { installExtensions } from '../../src/extensions.js';
import { createServer } from '../../src/server.js';

const live = process.env.TUDELFT_LIVE === '1';
const suite = live ? describe : describe.skip;

type Result = Record<string, unknown> & { error?: { code: string; message: string } };

suite('live smoke (read only)', () => {
  let client: Client;
  let courseId: string | undefined;

  const call = async (name: string, args: Record<string, unknown> = {}): Promise<Result> => {
    const result = await client.callTool({ name, arguments: args });
    const content = result.structuredContent as Result;
    if (result.isError) throw new Error(`${name}: ${content.error?.code} ${content.error?.message}`);
    return content;
  };

  beforeAll(async () => {
    const ctx = createContext(loadConfig());
    installExtensions(ctx);
    const { server } = createServer(ctx);
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(b);
    client = new Client({ name: 'live', version: '0' });
    await client.connect(a);
  }, 60_000);

  it('auth_status verifies Brightspace', async () => {
    const status = await call('auth_status');
    const services = status.services as Record<string, { connected: boolean; verified?: boolean }>;
    expect(services.brightspace?.connected).toBe(true);
    expect(services.brightspace?.verified).toBe(true);
    console.log('services:', Object.fromEntries(Object.entries(services).map(([k, v]) => [k, v.connected])));
  }, 120_000);

  it('lists courses and picks one', async () => {
    const result = await call('list_courses');
    const items = result.items as { id: string; code: string; active: boolean }[];
    expect(items.length).toBeGreaterThan(0);
    courseId = items.find((c) => /\+\d{4}\+/.test(c.code))?.id ?? items[0]?.id;
    console.log('courses:', items.length, 'picked', courseId);
  }, 60_000);

  it('reads content, announcements, assignments, grades of the course', async () => {
    if (!courseId) return;
    const content = await call('get_course_content', { courseId });
    const news = await call('get_announcements', { courseId });
    const work = await call('list_assignments', { courseId });
    const grades = await call('get_grades', { courseId });
    console.log(
      'content topics:',
      content.topicCount,
      'news:',
      news.count,
      'assignments:',
      work.count,
      'graded:',
      (grades.summary as { gradedItems: number }).gradedItems,
    );
    expect(typeof content.topicCount).toBe('number');
  }, 120_000);

  it('reads the first extractable file', async () => {
    if (!courseId) return;
    const content = await call('get_course_content', { courseId });
    const topic = (content.topics as { id: string; extractable: boolean; extension?: string }[]).find(
      (t) => t.extractable && t.extension === '.pdf',
    );
    if (!topic) return;
    const material = await call('read_material', { courseId, topicId: topic.id, maxChars: 500 });
    console.log(
      'material:',
      material.format,
      'pages',
      material.pages,
      'chars',
      material.totalChars,
      'indexed',
      material.indexed,
    );
    expect(material.indexed).toBe(true);
    const search = await call('search_materials', {
      query: String(material.text).split(/\s+/).slice(2, 4).join(' '),
      courseId,
    });
    expect((search.hits as unknown[]).length).toBeGreaterThan(0);
  }, 180_000);

  it('builds an upcoming overview and a change snapshot', async () => {
    const upcoming = await call('get_upcoming', { days: 21 });
    console.log(
      'upcoming items:',
      (upcoming.items as unknown[]).length,
      'errors:',
      (upcoming.errors as unknown[]).length,
    );
    const changes = await call('whats_new', { peek: true });
    console.log('whats_new checked:', (changes.summary as { coursesChecked: number }).coursesChecked);
    expect(upcoming.complete).toBe(true);
  }, 300_000);

  it('reads OSIRIS grades when connected', async () => {
    const status = await call('auth_status', { verify: false });
    const osiris = (status.services as Record<string, { connected: boolean }>).osiris;
    if (!osiris?.connected) {
      console.log('osiris not connected; skipped');
      return;
    }
    const grades = await call('osiris_grades', { limit: 5 });
    console.log('osiris grades page:', (grades.items as unknown[]).length, 'hasMore', grades.hasMore);
    const progress = await call('osiris_progress', {});
    console.log('osiris progress rows:', (progress.items as unknown[]).length);
  }, 120_000);

  it('reads the timetable when connected', async () => {
    const status = await call('timetable_status');
    if (!status.configured) {
      console.log('timetable not connected; skipped');
      return;
    }
    const events = await call('get_timetable', { days: 7 });
    console.log('timetable events (7 days):', (events.items as unknown[]).length);
  }, 60_000);

  it('reads the public study guide and campus services', async () => {
    const year =
      new Date().getMonth() >= 8
        ? `${new Date().getFullYear()}-${new Date().getFullYear() + 1}`
        : `${new Date().getFullYear() - 1}-${new Date().getFullYear()}`;
    const guide = await call('search_study_guide', { query: 'circuit', academicYear: year });
    console.log('study guide hits:', guide.total);
    const notices = await call('get_ict_notices', {});
    console.log('ict notices:', (notices.items as unknown[]).length);
  }, 60_000);
});
