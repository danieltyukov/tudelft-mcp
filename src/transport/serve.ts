import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { ParsedArgs } from '../cli.js';
import type { AppContext } from '../context.js';
import { createServer } from '../server.js';

export async function serve(ctx: AppContext, args: ParsedArgs): Promise<void> {
  const { server } = createServer(ctx);
  const stop = (): void => {
    void Promise.all([server.close(), ctx.close()]).finally(() => process.exit(0));
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  if (args.flags.http) {
    const { serveHttp } = await import('./http.js');
    await serveHttp(ctx, server, args);
    return;
  }
  process.stdin.once('end', stop);
  await server.connect(new StdioServerTransport());
}
