import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ParsedArgs } from '../../src/cli.js';
import { loadConfig } from '../../src/config.js';
import { createContext, type AppContext } from '../../src/context.js';
import { installExtensions } from '../../src/extensions.js';
import { createServer } from '../../src/server.js';
import { serveHttp, type HttpHandle } from '../../src/transport/http.js';
import { RateLimiter, tokensMatch } from '../../src/transport/http-auth.js';

const TOKEN = 'test-token-with-enough-entropy';
const quiet = (): void => undefined;

const args = (flags: ParsedArgs['flags']): ParsedArgs => ({ command: 'serve', positional: [], flags });

async function newContext(): Promise<AppContext> {
  const dir = await mkdtemp(join(tmpdir(), 'tudelft-http-'));
  const ctx = createContext(loadConfig({ TUDELFT_MCP_HOME: dir }));
  installExtensions(ctx);
  return ctx;
}

async function connect(url: string, headers?: Record<string, string>): Promise<Client> {
  const client = new Client({ name: 'test', version: '0.0.0' });
  const transport = new StreamableHTTPClientTransport(
    new URL(url),
    headers ? { requestInit: { headers } } : {},
  );
  await client.connect(transport);
  return client;
}

const rpc = (path: string, port: number, headers: Record<string, string> = {}) =>
  fetch(`http://127.0.0.1:${port}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...headers,
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
  });

describe('HTTP transport', () => {
  let ctx: AppContext;
  let handle: HttpHandle;

  beforeAll(async () => {
    ctx = await newContext();
    handle = await serveHttp(
      ctx,
      () => createServer(ctx).server,
      args({ http: true, port: '0', token: TOKEN }),
      quiet,
    );
  });

  afterAll(async () => {
    await handle.close();
    await ctx.close();
  });

  it('binds a free port when asked for port 0', () => {
    expect(handle.port).toBeGreaterThan(0);
    expect(handle.token).toBe(TOKEN);
  });

  it('lists tools for a client that sends a bearer header', async () => {
    const client = await connect(`http://127.0.0.1:${handle.port}/mcp`, { Authorization: `Bearer ${TOKEN}` });
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name)).toContain('auth_status');
    const result = await client.callTool({ name: 'auth_status', arguments: { verify: false } });
    expect(result.isError).toBeFalsy();
    await client.close();
  });

  it('accepts the token as a path prefix', async () => {
    const client = await connect(`http://127.0.0.1:${handle.port}/${TOKEN}/mcp`);
    const { tools } = await client.listTools();
    expect(tools.length).toBeGreaterThan(0);
    await client.close();
  });

  it('rejects requests without a valid token', async () => {
    const missing = await rpc('/mcp', handle.port);
    expect(missing.status).toBe(401);
    expect(missing.headers.get('www-authenticate')).toContain('Bearer');
    expect(((await missing.json()) as { error: string }).error).toBe('unauthorized');
    const wrong = await rpc('/mcp', handle.port, { authorization: 'Bearer nope' });
    expect(wrong.status).toBe(401);
    const wrongPath = await rpc('/nope/mcp', handle.port);
    expect(wrongPath.status).toBe(401);
  });

  it('answers the health check and the landing page without a token', async () => {
    const health = await fetch(`http://127.0.0.1:${handle.port}/healthz`);
    expect(health.status).toBe(200);
    expect(await health.json()).toMatchObject({ ok: true, name: 'tudelft' });
    const landing = await fetch(`http://127.0.0.1:${handle.port}/`);
    expect(landing.status).toBe(200);
    expect(await landing.text()).toContain('MCP');
    const unknown = await fetch(`http://127.0.0.1:${handle.port}/other`);
    expect(unknown.status).toBe(404);
  });

  it('rejects malformed JSON and oversized bodies', async () => {
    const bad = await fetch(`http://127.0.0.1:${handle.port}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
      body: '{not json',
    });
    expect(bad.status).toBe(400);
    const big = await fetch(`http://127.0.0.1:${handle.port}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
      body: `"${'x'.repeat(4 * 1024 * 1024 + 1)}"`,
    });
    expect(big.status).toBe(413);
  });
});

describe('HTTP token handling', () => {
  it('generates a token, stores it in the session file and reuses it', async () => {
    const ctx = await newContext();
    const first = await serveHttp(
      ctx,
      () => createServer(ctx).server,
      args({ http: true, port: '0' }),
      quiet,
    );
    expect(first.token.length).toBeGreaterThanOrEqual(40);
    expect((await ctx.session.load()).http?.token).toBe(first.token);
    await first.close();
    const second = await serveHttp(
      ctx,
      () => createServer(ctx).server,
      args({ http: true, port: '0' }),
      quiet,
    );
    expect(second.token).toBe(first.token);
    await second.close();
    await ctx.close();
  });

  it('rate limits repeated failures per address', async () => {
    const ctx = await newContext();
    const handle = await serveHttp(
      ctx,
      () => createServer(ctx).server,
      args({ http: true, port: '0', token: TOKEN }),
      quiet,
    );
    for (let i = 0; i < 10; i++) expect((await rpc('/mcp', handle.port)).status).toBe(401);
    expect((await rpc('/mcp', handle.port)).status).toBe(429);
    expect((await rpc('/mcp', handle.port, { authorization: `Bearer ${TOKEN}` })).status).toBe(429);
    await handle.close();
    await ctx.close();
  });

  it('compares tokens without leaking length and counts a sliding window', () => {
    expect(tokensMatch('abc', 'abc')).toBe(true);
    expect(tokensMatch('abc', 'abcd')).toBe(false);
    const limiter = new RateLimiter(2, 1000);
    limiter.fail('a', 0);
    limiter.fail('a', 10);
    expect(limiter.blocked('a', 20)).toBe(true);
    expect(limiter.blocked('b', 20)).toBe(false);
    expect(limiter.blocked('a', 1500)).toBe(false);
  });
});
