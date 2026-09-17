import { spawn } from 'node:child_process';
import type { ServerEntry } from './command.js';
import { mergeJsonFile, mergeTomlSection, readText, type FileChange, writeBackup } from './files.js';
import {
  appDataDir,
  dotConfigDir,
  findOnPath,
  homeDir,
  isDir,
  isFile,
  pathJoin,
  type SetupEnv,
} from './paths.js';

export interface Detection {
  installed: boolean;
  configPath: string;
}

export interface WriteOptions {
  dryRun: boolean;
}

export type WriteResult = FileChange;

export interface ClientDefinition {
  id: string;
  name: string;
  detect(): Detection;
  write(entry: ServerEntry, options: WriteOptions): Promise<WriteResult>;
}

export const SERVER_KEY = 'tudelft';

const stdioEntry = (entry: ServerEntry): Record<string, unknown> => ({
  command: entry.command,
  args: entry.args,
});

interface JsonClientSpec {
  id: string;
  name: string;
  configPath: string;
  /** Directory whose presence means the client is installed. */
  installedDir: string;
  keys: string[];
  shape?: (entry: ServerEntry) => Record<string, unknown>;
}

function jsonClient(spec: JsonClientSpec): ClientDefinition {
  const shape = spec.shape ?? stdioEntry;
  return {
    id: spec.id,
    name: spec.name,
    detect: () => ({ installed: isDir(spec.installedDir), configPath: spec.configPath }),
    write: (entry, options) =>
      mergeJsonFile(spec.configPath, [...spec.keys, SERVER_KEY], shape(entry), options.dryRun),
  };
}

const quote = (value: string): string =>
  /[\s"\\]/.test(value) ? `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"` : value;

/** Run a command to completion. Resolves true on exit code 0, false on any failure. */
function runCommand(binary: string, args: string[]): Promise<boolean> {
  const shell = /\.(cmd|bat)$/i.test(binary);
  return new Promise((resolve) => {
    const child = spawn(shell ? quote(binary) : binary, shell ? args.map(quote) : args, {
      shell,
      stdio: ['ignore', 'ignore', 'ignore'],
      windowsHide: true,
    });
    const timer = setTimeout(() => {
      child.kill();
      resolve(false);
    }, 30_000);
    child.on('error', () => {
      clearTimeout(timer);
      resolve(false);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve(code === 0);
    });
  });
}

function claudeCode(setup: SetupEnv): ClientDefinition {
  const configPath = pathJoin(setup, homeDir(setup), '.claude.json');
  const binary = findOnPath('claude', setup);
  return {
    id: 'claude-code',
    name: 'Claude Code',
    detect: () => ({ installed: Boolean(binary) || isFile(configPath), configPath }),
    async write(entry, options) {
      const fallback = (): Promise<WriteResult> =>
        mergeJsonFile(configPath, ['mcpServers', SERVER_KEY], stdioEntry(entry), options.dryRun);
      if (!binary) return fallback();
      const cliArgs = [
        'mcp',
        'add',
        '--scope',
        'user',
        '--transport',
        'stdio',
        SERVER_KEY,
        '--',
        entry.command,
        ...entry.args,
      ];
      const preview = ['claude', ...cliArgs].map(quote).join(' ');
      if (options.dryRun) return { changed: true, path: configPath, preview };
      const before = await readText(configPath);
      if (!(await runCommand(binary, cliArgs))) return fallback();
      const after = await readText(configPath);
      const changed = before !== after;
      if (changed && before !== undefined) {
        const backup = `${configPath}.bak`;
        await writeBackup(configPath, backup, before);
        return { changed, path: configPath, preview, backup };
      }
      return { changed, path: configPath, preview };
    },
  };
}

const tomlString = (value: string): string => JSON.stringify(value);

export function codexSection(entry: ServerEntry): string {
  return [
    `command = ${tomlString(entry.command)}`,
    `args = [${entry.args.map(tomlString).join(', ')}]`,
    'startup_timeout_sec = 30',
    'tool_timeout_sec = 300',
  ].join('\n');
}

function codex(setup: SetupEnv): ClientDefinition {
  const dir = pathJoin(setup, homeDir(setup), '.codex');
  const configPath = pathJoin(setup, dir, 'config.toml');
  return {
    id: 'codex',
    name: 'Codex CLI',
    detect: () => ({ installed: isDir(dir), configPath }),
    write: (entry, options) =>
      mergeTomlSection(configPath, `[mcp_servers.${SERVER_KEY}]`, codexSection(entry), options.dryRun),
  };
}

export const CHATGPT_STEPS = [
  '1. Run: tudelft-mcp serve --http --tunnel',
  '2. Copy the connector URL it prints (https://<name>.trycloudflare.com/<token>/mcp).',
  '3. In ChatGPT open Settings, then Connectors, enable Developer mode, choose Create and paste the URL.',
  '   Leave authentication off: the token is part of the URL. Keep the URL private.',
].join('\n');

const chatgpt: ClientDefinition = {
  id: 'chatgpt',
  name: 'ChatGPT',
  detect: () => ({ installed: false, configPath: '' }),
  write: async () => ({
    changed: false,
    path: '',
    preview: CHATGPT_STEPS,
    manual: 'ChatGPT connects over HTTP instead of a config file.',
  }),
};

/** Every supported client, in the order shown to the user. */
export function createClients(setup: SetupEnv): ClientDefinition[] {
  const home = homeDir(setup);
  const appData = appDataDir(setup);
  const dotConfig = dotConfigDir(setup);
  const codeUser = pathJoin(setup, appData, 'Code', 'User');
  const clineDir = pathJoin(setup, codeUser, 'globalStorage', 'saoudrizwan.claude-dev');
  return [
    jsonClient({
      id: 'claude-desktop',
      name: 'Claude Desktop',
      configPath: pathJoin(setup, appData, 'Claude', 'claude_desktop_config.json'),
      installedDir: pathJoin(setup, appData, 'Claude'),
      keys: ['mcpServers'],
    }),
    claudeCode(setup),
    jsonClient({
      id: 'cursor',
      name: 'Cursor',
      configPath: pathJoin(setup, home, '.cursor', 'mcp.json'),
      installedDir: pathJoin(setup, home, '.cursor'),
      keys: ['mcpServers'],
    }),
    jsonClient({
      id: 'windsurf',
      name: 'Windsurf',
      configPath: pathJoin(setup, home, '.codeium', 'windsurf', 'mcp_config.json'),
      installedDir: pathJoin(setup, home, '.codeium', 'windsurf'),
      keys: ['mcpServers'],
    }),
    jsonClient({
      id: 'vscode',
      name: 'VS Code',
      configPath: pathJoin(setup, codeUser, 'mcp.json'),
      installedDir: codeUser,
      keys: ['servers'],
      shape: (entry) => ({ type: 'stdio', ...stdioEntry(entry) }),
    }),
    jsonClient({
      id: 'zed',
      name: 'Zed',
      configPath: pathJoin(setup, dotConfig, 'zed', 'settings.json'),
      installedDir: pathJoin(setup, dotConfig, 'zed'),
      keys: ['context_servers'],
      shape: (entry) => ({ source: 'custom', ...stdioEntry(entry) }),
    }),
    codex(setup),
    jsonClient({
      id: 'gemini',
      name: 'Gemini CLI',
      configPath: pathJoin(setup, home, '.gemini', 'settings.json'),
      installedDir: pathJoin(setup, home, '.gemini'),
      keys: ['mcpServers'],
    }),
    jsonClient({
      id: 'cline',
      name: 'Cline',
      configPath: pathJoin(setup, clineDir, 'settings', 'cline_mcp_settings.json'),
      installedDir: clineDir,
      keys: ['mcpServers'],
    }),
    jsonClient({
      id: 'opencode',
      name: 'OpenCode',
      configPath: pathJoin(setup, dotConfig, 'opencode', 'opencode.json'),
      installedDir: pathJoin(setup, dotConfig, 'opencode'),
      keys: ['mcp'],
      shape: (entry) => ({ type: 'local', command: [entry.command, ...entry.args] }),
    }),
    chatgpt,
  ];
}
