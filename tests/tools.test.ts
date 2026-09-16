import { describe, expect, it } from 'vitest';
import { connectedClient } from './server.test.js';

describe('tool catalogue', () => {
  it('registers the Brightspace tool set with prompts and resources', async () => {
    const { client, registry } = await connectedClient();
    const names = new Set((await client.listTools()).tools.map((t) => t.name));
    for (const expected of [
      'get_course_content',
      'read_material',
      'get_announcements',
      'list_assignments',
      'get_assignment',
      'prepare_submission',
      'confirm_submission',
      'get_grades',
      'get_upcoming',
      'whats_new',
      'read_discussions',
      'get_groups',
      'search_materials',
      'sync_course',
      'list_recordings',
      'read_page',
    ]) {
      expect(names.has(expected), expected).toBe(true);
    }
    expect(registry.tools.every((tool) => tool.description.length > 40)).toBe(true);
    expect(registry.tools.every((tool) => !/[\u2013\u2014]/.test(tool.description))).toBe(true);
    const prompts = await client.listPrompts();
    expect(prompts.prompts.map((p) => p.name)).toContain('weekly_briefing');
    const resources = await client.listResources();
    expect(resources.resources.map((r) => r.uri)).toContain('tudelft://usage');
  });
});
