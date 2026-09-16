import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { ParsedArgs } from '../cli.js';
import { SERVER_NAME } from '../config.js';
import type { AppContext, Logger } from '../context.js';
import { TudelftError } from '../errors.js';
import { VERSION } from '../version.js';
import { RateLimiter, resolveToken, tokensMatch } from './http-auth.js';
import { openTunnel, type Tunnel } from './tunnel.js';

export const DEFAULT_PORT = 3847;
export const DEFAULT_HOST = '127.0.0.1';
const MAX_BODY_BYTES = 4 * 1024 * 1024;

/** Builds a fresh McpServer. One is created per HTTP request; they all share the AppContext. */
export type ServerFactory = () => McpServer;

export interface HttpHandle {
  port: number;
  host: string;
  token: string;
  /** Public base URL when --tunnel was given. */
  publicUrl?: string;
  close(): Promise<void>;
}

const stderr: Logger = (message) => {
  process.stderr.write(`${message}\n`);
};

const LANDING = `tudelft-mcp ${VERSION}

This is a local MCP (Model Context Protocol) server for a TU Delft student's
Brightspace, OSIRIS and MyTimetable data. It is not a web page.

Point an MCP client at /mcp with "Authorization: Bearer <token>", or at
/<token>/mcp when the client cannot send headers. Health check: /healthz
`;

function parsePort(flag: string | boolean | undefined): number {
  if (flag === undefined) return DEFAULT_PORT;
  const port = typeof flag === 'string' ? Number(flag) : NaN;
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new TudelftError('INVALID_ARGUMENT', '--port must be a number between 0 and 65535.');
  }
  return port;
}

function send(res: ServerResponse, status: number, type: string, body: string): void {
  res.writeHead(status, { 'Content-Type': type, 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

const json = (res: ServerResponse, status: number, body: unknown): void =>
  send(res, status, 'application/json', JSON.stringify(body));

function readBody(req: IncomingMessage): Promise<string> {
  const declared = Number(req.headers['content-length']);
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return Promise.reject(new TudelftError('FILE_TOO_LARGE', 'Request body exceeds 4 MB.'));
  }
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let failed = false;
    req.on('data', (chunk: Buffer) => {
      if (failed) return;
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        failed = true;
        reject(new TudelftError('FILE_TOO_LARGE', 'Request body exceeds 4 MB.'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!failed) resolve(Buffer.concat(chunks).toString('utf8'));
    });
    req.on('error', (error) => {
      if (!failed) {
        failed = true;
        reject(error);
      }
    });
  });
}

function bearer(req: IncomingMessage): string | undefined {
  const header = req.headers.authorization;
  const match = header ? /^Bearer\s+(\S+)$/i.exec(header) : null;
  return match?.[1];
}

interface Route {
  token: string;
  limiter: RateLimiter;
  makeServer: ServerFactory;
}

async function dispatch(route: Route, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const segments = url.pathname.split('/').filter(Boolean);
  if (req.method === 'GET' && url.pathname === '/healthz') {
    json(res, 200, { ok: true, name: SERVER_NAME, version: VERSION });
    return;
  }
  if (req.method === 'GET' && url.pathname === '/') {
    send(res, 200, 'text/plain; charset=utf-8', LANDING);
    return;
  }
  const isMcp = segments[segments.length - 1] === 'mcp' && segments.length <= 2;
  if (!isMcp) {
    json(res, 404, { error: 'not_found', message: 'Use /mcp, /healthz or /.' });
    return;
  }
  const address = req.socket.remoteAddress ?? 'unknown';
  if (route.limiter.blocked(address)) {
    json(res, 429, {
      error: 'too_many_attempts',
      message: 'Too many failed attempts. Try again in a minute.',
    });
    return;
  }
  const given = segments.length === 2 ? segments[0] : bearer(req);
  if (!given || !tokensMatch(route.token, given)) {
    route.limiter.fail(address);
    res.setHeader('WWW-Authenticate', 'Bearer realm="tudelft-mcp"');
    json(res, 401, {
      error: 'unauthorized',
      message: 'Send the token as "Authorization: Bearer <token>" or use /<token>/mcp.',
    });
    return;
  }
  let body: unknown;
  if (req.method === 'POST') {
    let raw: string;
    try {
      raw = await readBody(req);
    } catch (error) {
      if (error instanceof TudelftError && error.code === 'FILE_TOO_LARGE') {
        json(res, 413, { error: 'payload_too_large', message: error.message });
        return;
      }
      throw error;
    }
    try {
      body = JSON.parse(raw);
    } catch {
      json(res, 400, {
        jsonrpc: '2.0',
        error: { code: -32700, message: 'Parse error: invalid JSON' },
        id: null,
      });
      return;
    }
  }
  // The SDK forbids reusing a stateless transport, so every request gets its own
  // transport and McpServer. They share the AppContext, so sessions and previews persist.
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: false,
  });
  const mcp = route.makeServer();
  res.once('close', () => {
    void mcp.close().catch(() => undefined);
  });
  await mcp.connect(transport);
  await transport.handleRequest(req, res, body);
}

function connectionHelp(handle: HttpHandle, showToken: boolean): string {
  const local = `http://${handle.host}:${handle.port}/mcp`;
  const shown = showToken ? handle.token : '<token: run with --show-token to print it>';
  const lines = [
    `MCP endpoint: ${local}`,
    '',
    'Claude Desktop, Cursor and other clients that take a "url" entry:',
    '  {',
    '    "mcpServers": {',
    '      "tudelft": {',
    `        "url": "${local}",`,
    `        "headers": { "Authorization": "Bearer ${shown}" }`,
    '      }',
    '    }',
    '  }',
    '',
  ];
  if (handle.publicUrl) {
    lines.push(
      'ChatGPT: open Settings, then Connectors, enable Developer mode, choose Create and paste this URL:',
      `  ${handle.publicUrl}/${handle.token}/mcp`,
      '  Leave authentication off: the token is part of the URL. Anyone with the URL can use your account.',
      '',
    );
  } else {
    lines.push('ChatGPT needs a public URL: run again with --tunnel (requires cloudflared or ngrok).', '');
  }
  lines.push(
    `Clients that cannot send headers can put the token in the path: http://${handle.host}:${handle.port}/<token>/mcp`,
  );
  return lines.join('\n');
}

export async function serveHttp(
  ctx: AppContext,
  makeServer: ServerFactory,
  args: ParsedArgs,
  log: Logger = stderr,
): Promise<HttpHandle> {
  const host = typeof args.flags.host === 'string' && args.flags.host ? args.flags.host : DEFAULT_HOST;
  const port = parsePort(args.flags.port);
  const token = await resolveToken(ctx, args.flags.token);
  const route: Route = { token, limiter: new RateLimiter(), makeServer };

  const server = createServer((req, res) => {
    dispatch(route, req, res).catch((error: unknown) => {
      if (res.headersSent) res.destroy();
      else json(res, 500, { error: 'internal_error', message: 'The request failed unexpectedly.' });
      log(`http: request failed: ${error instanceof Error ? error.message : String(error)}`);
    });
  });
  server.requestTimeout = 0;
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      resolve();
    });
  });
  const bound = (server.address() as AddressInfo).port;

  let tunnel: Tunnel | undefined;
  const close = async (): Promise<void> => {
    tunnel?.close();
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
    });
  };
  if (args.flags.tunnel) {
    try {
      tunnel = await openTunnel(bound, log);
    } catch (error) {
      await close();
      throw error;
    }
  }

  const handle: HttpHandle = {
    port: bound,
    host,
    token,
    close,
    ...(tunnel ? { publicUrl: tunnel.url } : {}),
  };
  if (host !== DEFAULT_HOST && host !== 'localhost') {
    log(`Warning: listening on ${host}, which may be reachable from other machines.`);
  }
  log(connectionHelp(handle, args.flags['show-token'] === true));
  if (args.flags['show-token'] === true) process.stdout.write(`${token}\n`);
  return handle;
}
