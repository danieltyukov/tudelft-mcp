import { resolve } from 'node:path';
import { defaultSetupEnv, findOnPath, type SetupEnv } from './paths.js';

/** How an MCP client should start this server. */
export interface ServerEntry {
  command: string;
  args: string[];
}

/**
 * auto: `tudelft-mcp serve` when installed globally, otherwise node plus the running cli.js.
 * npx:  `npx -y tudelft-mcp serve` for people who prefer not to install globally.
 * node: always node plus the absolute path of the running cli.js.
 */
export type CommandMode = 'auto' | 'npx' | 'node';

export const COMMAND_MODES: readonly CommandMode[] = ['auto', 'npx', 'node'];

export interface CommandOptions {
  mode?: CommandMode;
  /** The running entry script, default process.argv[1]. */
  entry?: string;
  /** The node binary, default process.execPath. */
  execPath?: string;
  setup?: SetupEnv;
}

/** True when the entry script sits inside npm's global prefix (lib/node_modules or npm\node_modules). */
export function isGlobalInstall(entry: string): boolean {
  const normalized = entry.replace(/\\/g, '/');
  return /\/(lib\/node_modules|npm\/node_modules)\/tudelft-mcp\//.test(normalized);
}

export function serverCommand(options: CommandOptions = {}): ServerEntry {
  const mode = options.mode ?? 'auto';
  if (mode === 'npx') return { command: 'npx', args: ['-y', 'tudelft-mcp', 'serve'] };
  const entry = resolve(options.entry ?? process.argv[1] ?? 'dist/cli.js');
  const setup = options.setup ?? defaultSetupEnv();
  if (mode === 'auto' && (isGlobalInstall(entry) || findOnPath('tudelft-mcp', setup))) {
    return { command: 'tudelft-mcp', args: ['serve'] };
  }
  return { command: options.execPath ?? process.execPath, args: [entry, 'serve'] };
}
