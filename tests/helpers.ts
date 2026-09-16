import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { vi } from 'vitest';
import { loadConfig } from '../src/config.js';
import { createContext, type AppContext } from '../src/context.js';
import { installExtensions } from '../src/extensions.js';

export const VERSIONS = [
  { ProductCode: 'lp', LatestVersion: '1.63' },
  { ProductCode: 'le', LatestVersion: '1.97' },
];

export function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  });
}

export function binary(bytes: Buffer | string, contentType: string, filename?: string): Response {
  const headers: Record<string, string> = { 'content-type': contentType };
  if (filename) headers['content-disposition'] = `attachment; filename="${filename}"`;
  return new Response(bytes as never, { status: 200, headers });
}

/** A signed-in context in a temp home. */
export async function signedInContext(): Promise<AppContext> {
  const dir = await mkdtemp(join(tmpdir(), 'tudelft-'));
  const ctx = createContext(loadConfig({ TUDELFT_MCP_HOME: dir }));
  installExtensions(ctx);
  await ctx.session.update((data) => {
    data.brightspace = {
      origin: 'https://brightspace.tudelft.nl',
      cookies: [
        {
          name: 'd2lSessionVal',
          value: 's',
          domain: 'brightspace.tudelft.nl',
          path: '/',
          expires: -1,
          httpOnly: true,
          secure: true,
        },
      ],
      bearer: 'bearer',
      identity: { id: '9001', name: 'Test Student', uniqueName: 'tstudent' },
      savedAt: new Date().toISOString(),
    };
  });
  return ctx;
}

export type Route = (url: URL, init?: RequestInit) => Response | Promise<Response> | undefined;

/** Mock fetch with a routing table keyed by path substring. Unmatched API calls return 404. */
export function mockApi(routes: Record<string, unknown | Route>): string[] {
  const calls: string[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = new URL(String(input));
    calls.push(`${init?.method ?? 'GET'} ${url.pathname}${url.search}`);
    if (url.pathname === '/d2l/api/versions/') return json(VERSIONS);
    for (const [key, value] of Object.entries(routes)) {
      if (url.pathname.includes(key)) {
        if (typeof value === 'function') {
          const response = await (value as Route)(url, init);
          if (response) return response;
          continue;
        }
        if (value instanceof Response) return value.clone();
        return json(value);
      }
    }
    return new Response('', { status: 404 });
  });
  return calls;
}
