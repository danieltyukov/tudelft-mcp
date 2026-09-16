import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { createContext } from '../src/context.js';
import { installExtensions } from '../src/extensions.js';
import { createServer } from '../src/server.js';

export async function connectedClient() {
  const dir = await mkdtemp(join(tmpdir(), 'tudelft-'));
  const ctx = createContext(loadConfig({ TUDELFT_MCP_HOME: dir }));
  installExtensions(ctx);
  const { server, registry } = createServer(ctx);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'test', version: '0.0.0' });
  await client.connect(clientTransport);
  return { client, ctx, registry, server };
}

describe('MCP server', () => {
  it('lists tools with schemas and annotations', async () => {
    const { client, registry } = await connectedClient();
    const { tools } = await client.listTools();
    expect(tools.length).toBe(registry.tools.length);
    const names = tools.map((t) => t.name);
    expect(names).toContain('auth_status');
    expect(names).toContain('list_courses');
    const status = tools.find((t) => t.name === 'auth_status');
    expect(status?.annotations?.readOnlyHint).toBe(true);
    expect(new Set(names).size).toBe(names.length);
  });

  it('returns a structured error when not signed in', async () => {
    const { client } = await connectedClient();
    const result = await client.callTool({ name: 'list_courses', arguments: {} });
    expect(result.isError).toBe(true);
    expect((result.structuredContent as { error: { code: string } }).error.code).toBe('AUTH_REQUIRED');
  });

  it('reports disconnected status without a session', async () => {
    const { client } = await connectedClient();
    const result = await client.callTool({ name: 'auth_status', arguments: {} });
    expect(result.isError).toBeFalsy();
    const content = result.structuredContent as { services: { brightspace: { connected: boolean } } };
    expect(content.services.brightspace.connected).toBe(false);
  });
});
