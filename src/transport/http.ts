import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ParsedArgs } from '../cli.js';
import type { AppContext } from '../context.js';

/** Placeholder until the HTTP transport module lands. */
export async function serveHttp(_ctx: AppContext, _server: McpServer, _args: ParsedArgs): Promise<void> {
  throw new Error('HTTP transport is not available in this build.');
}
