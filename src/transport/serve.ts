import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { ParsedArgs } from '../cli.js';
import type { AppContext } from '../context.js';
import { createServer } from '../server.js';

function stopOnSignal(shutdown: () => Promise<unknown>): () => void {
  const stop = (): void => {
    void shutdown()
      .catch(() => undefined)
      .finally(() => process.exit(0));
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  return stop;
}

export async function serve(ctx: AppContext, args: ParsedArgs): Promise<void> {
  if (args.flags.http) {
    const { serveHttp } = await import('./http.js');
    const handle = await serveHttp(ctx, () => createServer(ctx).server, args);
    stopOnSignal(() => Promise.all([handle.close(), ctx.close()]));
    return;
  }
  const { server } = createServer(ctx);
  const stop = stopOnSignal(() => Promise.all([server.close(), ctx.close()]));
  process.stdin.once('end', stop);
  await server.connect(new StdioServerTransport());
}
