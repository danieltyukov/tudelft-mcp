import { createContext, type AppContext } from './context.js';
import { toSafeError } from './errors.js';
import { VERSION } from './version.js';

const HELP = `tudelft-mcp ${VERSION}

Usage: tudelft-mcp <command> [options]

Commands
  login [--fresh] [--only osiris,timetable]   Sign in once in a browser window (Brightspace, OSIRIS, MyTimetable)
  status                                       Show which services are connected and verify them live
  logout                                       Remove saved sessions and the browser profile
  serve [--http] [--port N] [--host H]         Run the MCP server (stdio by default; --http listens on 127.0.0.1:3847)
        [--token T] [--show-token]             With --http: use this bearer token; print the token that is in use
        [--tunnel]                             With --http: expose it publicly through cloudflared or ngrok for ChatGPT
  setup [client...] [--all] [--dry-run]        Write MCP config for installed clients (claude-desktop, cursor, codex, ...)
        [--json] [--command npx|node]          Machine-readable summary; how clients start the server (default: auto)
  tools                                        List the tools this server exposes
  browser [install|which]                      Download Chromium, or show the browser that will be used
  doctor                                       Alias for status

Environment
  TUDELFT_MCP_HOME        Data directory (default ~/.tudelft-mcp)
  TUDELFT_BROWSER_PATH    Browser executable to use instead of auto-detection
`;

export interface ParsedArgs {
  command: string;
  positional: string[];
  flags: Record<string, string | boolean>;
}

export function parseArgs(argv: string[]): ParsedArgs {
  const [command = 'help', ...rest] = argv;
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]!;
    if (arg.startsWith('--')) {
      const [key, inline] = arg.slice(2).split('=', 2);
      if (inline !== undefined) flags[key!] = inline;
      else if (rest[i + 1] && !rest[i + 1]!.startsWith('--')) flags[key!] = rest[++i]!;
      else flags[key!] = true;
    } else positional.push(arg);
  }
  return { command, positional, flags };
}

const log = (message: string): void => {
  process.stderr.write(`${message}\n`);
};

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.flags.version || args.command === '--version' || args.command === '-v') {
    process.stdout.write(`${VERSION}\n`);
    return;
  }
  if (args.command === 'help' || args.command === '--help' || args.command === '-h') {
    process.stdout.write(HELP);
    return;
  }
  const ctx = createContext();
  const { installExtensions } = await import('./extensions.js');
  installExtensions(ctx);
  try {
    switch (args.command) {
      case 'serve': {
        const { serve } = await import('./transport/serve.js');
        await serve(ctx, args);
        return;
      }
      case 'login': {
        const { runLogin } = await import('./auth/login.js');
        const only =
          typeof args.flags.only === 'string' ? args.flags.only.split(',').map((s) => s.trim()) : undefined;
        const report = await runLogin(
          ctx,
          { fresh: args.flags.fresh === true, ...(only ? { only } : {}) },
          log,
        );
        process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
        if (!report.brightspace.connected) process.exitCode = 1;
        return;
      }
      case 'logout': {
        const { logoutAll } = await import('./auth/status.js');
        process.stdout.write(`${JSON.stringify(await logoutAll(ctx), null, 2)}\n`);
        return;
      }
      case 'status':
      case 'doctor': {
        const { authStatus } = await import('./auth/status.js');
        const status = await authStatus(ctx, true);
        process.stdout.write(`${JSON.stringify(status, null, 2)}\n`);
        return;
      }
      case 'tools': {
        const { createServer } = await import('./server.js');
        const { registry } = createServer(ctx);
        for (const tool of registry.tools)
          process.stdout.write(`${tool.name.padEnd(32)} ${tool.description.split('. ')[0]}\n`);
        process.stdout.write(`\n${registry.tools.length} tools\n`);
        return;
      }
      case 'setup': {
        const { runSetup } = await import('./setup/index.js');
        await runSetup(ctx, args, log);
        return;
      }
      case 'browser': {
        const { browserCommand } = await import('./auth/browser-cli.js');
        await browserCommand(ctx, args, log);
        return;
      }
      default:
        process.stderr.write(`Unknown command "${args.command}".\n\n${HELP}`);
        process.exitCode = 2;
    }
  } finally {
    if (args.command !== 'serve') await ctx.close().catch(() => undefined);
  }
}

export function runCli(): void {
  main().catch((error: unknown) => {
    const safe = toSafeError(error);
    process.stderr.write(`${safe.code}: ${safe.message}\n`);
    process.exitCode = 1;
  });
}

export type { AppContext };
runCli();
