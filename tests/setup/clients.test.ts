import { mkdir, mkdtemp, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { ParsedArgs } from '../../src/cli.js';
import type { AppContext } from '../../src/context.js';
import { CHATGPT_STEPS, createClients, type ClientDefinition } from '../../src/setup/clients.js';
import { runSetup } from '../../src/setup/index.js';
import type { SetupEnv } from '../../src/setup/paths.js';

const entry = { command: '/usr/bin/node', args: ['/opt/tudelft-mcp/dist/cli.js', 'serve'] };

const linux = (home: string): SetupEnv => ({ env: { HOME: home, PATH: '' }, platform: 'linux' });

async function home(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'tudelft-setup-'));
}

function client(setup: SetupEnv, id: string): ClientDefinition {
  const found = createClients(setup).find((candidate) => candidate.id === id);
  if (!found) throw new Error(`no client ${id}`);
  return found;
}

const exists = (path: string): Promise<boolean> =>
  stat(path).then(
    () => true,
    () => false,
  );

const readJson = async (path: string): Promise<Record<string, unknown>> =>
  JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;

/** Compare paths independently of the host separator; posix joins are valid on Windows too. */
const norm = (path: string): string => path.replace(/\\/g, '/');

describe('JSON clients', () => {
  it('merges into an existing Claude Desktop config, keeps other servers and writes one backup', async () => {
    const dir = await home();
    const setup = linux(dir);
    const path = join(dir, '.config', 'Claude', 'claude_desktop_config.json');
    await mkdir(dirname(path), { recursive: true });
    const before = JSON.stringify({ mcpServers: { other: { command: 'x' } }, theme: 'dark' });
    await writeFile(path, before);
    const desktop = client(setup, 'claude-desktop');
    const detected = desktop.detect();
    expect(detected.installed).toBe(true);
    expect(norm(detected.configPath)).toBe(norm(path));

    const result = await desktop.write(entry, { dryRun: false });
    expect(result.changed).toBe(true);
    expect(norm(result.backup ?? '')).toBe(norm(`${path}.bak`));
    expect(result.manual).toBeUndefined();
    const doc = await readJson(path);
    expect(doc.theme).toBe('dark');
    expect(doc.mcpServers).toEqual({ other: { command: 'x' }, tudelft: entry });
    expect(await readFile(`${path}.bak`, 'utf8')).toBe(before);
    expect(result.preview).toContain('"tudelft"');

    const again = await desktop.write(entry, { dryRun: false });
    expect(again.changed).toBe(false);
    expect(again.backup).toBeUndefined();
    expect(await readFile(`${path}.bak`, 'utf8')).toBe(before);
  });

  it('creates the file for a client that is not installed', async () => {
    const dir = await home();
    const cursor = client(linux(dir), 'cursor');
    expect(cursor.detect().installed).toBe(false);
    const result = await cursor.write(entry, { dryRun: false });
    expect(result.changed).toBe(true);
    expect(result.backup).toBeUndefined();
    expect(await readJson(join(dir, '.cursor', 'mcp.json'))).toEqual({ mcpServers: { tudelft: entry } });
  });

  it('writes nothing in dry-run mode', async () => {
    const dir = await home();
    const setup = linux(dir);
    for (const id of ['cursor', 'windsurf', 'vscode', 'zed', 'codex', 'gemini', 'cline', 'opencode']) {
      const result = await client(setup, id).write(entry, { dryRun: true });
      expect(result.changed).toBe(true);
      expect(result.preview).toContain('tudelft');
    }
    expect(await readdir(dir)).toEqual([]);
  });

  it('uses the client specific shapes', async () => {
    const dir = await home();
    const setup = linux(dir);
    await client(setup, 'vscode').write(entry, { dryRun: false });
    expect(await readJson(join(dir, '.config', 'Code', 'User', 'mcp.json'))).toEqual({
      servers: { tudelft: { type: 'stdio', ...entry } },
    });
    await client(setup, 'zed').write(entry, { dryRun: false });
    expect(await readJson(join(dir, '.config', 'zed', 'settings.json'))).toEqual({
      context_servers: { tudelft: { source: 'custom', ...entry } },
    });
    await client(setup, 'opencode').write(entry, { dryRun: false });
    expect(await readJson(join(dir, '.config', 'opencode', 'opencode.json'))).toEqual({
      mcp: { tudelft: { type: 'local', command: [entry.command, ...entry.args] } },
    });
    await client(setup, 'cline').write(entry, { dryRun: false });
    const cline = join(
      dir,
      '.config',
      'Code',
      'User',
      'globalStorage',
      'saoudrizwan.claude-dev',
      'settings',
      'cline_mcp_settings.json',
    );
    expect(await readJson(cline)).toEqual({ mcpServers: { tudelft: entry } });
  });

  it('leaves a Zed settings file with comments alone and returns the snippet', async () => {
    const dir = await home();
    const path = join(dir, '.config', 'zed', 'settings.json');
    await mkdir(dirname(path), { recursive: true });
    const original = '// Zed settings\n{\n  "theme": "One Dark", // trailing comma allowed\n}\n';
    await writeFile(path, original);
    const result = await client(linux(dir), 'zed').write(entry, { dryRun: false });
    expect(result.changed).toBe(false);
    expect(result.manual).toMatch(/plain JSON/);
    expect(result.preview).toContain('"context_servers"');
    expect(await readFile(path, 'utf8')).toBe(original);
    expect(await exists(`${path}.bak`)).toBe(false);
  });

  it('falls back to ~/.claude.json for Claude Code when the CLI is not on PATH', async () => {
    const dir = await home();
    const setup = linux(dir);
    const code = client(setup, 'claude-code');
    const detectedCode = code.detect();
    expect(detectedCode.installed).toBe(false);
    expect(norm(detectedCode.configPath)).toBe(norm(join(dir, '.claude.json')));
    await writeFile(join(dir, '.claude.json'), JSON.stringify({ numStartups: 3, mcpServers: { a: {} } }));
    expect(code.detect().installed).toBe(true);
    const result = await code.write(entry, { dryRun: false });
    expect(result.changed).toBe(true);
    const doc = await readJson(join(dir, '.claude.json'));
    expect(doc.numStartups).toBe(3);
    expect(doc.mcpServers).toEqual({ a: {}, tudelft: entry });
  });

  it('resolves platform specific paths', () => {
    const mac = createClients({ env: { HOME: '/Users/s', PATH: '' }, platform: 'darwin' });
    const byId = (list: ClientDefinition[], id: string) => list.find((c) => c.id === id)!.detect().configPath;
    expect(byId(mac, 'claude-desktop')).toBe(
      '/Users/s/Library/Application Support/Claude/claude_desktop_config.json',
    );
    expect(byId(mac, 'vscode')).toBe('/Users/s/Library/Application Support/Code/User/mcp.json');
    expect(byId(mac, 'zed')).toBe('/Users/s/.config/zed/settings.json');
    const win = createClients({
      env: { USERPROFILE: 'C:\\Users\\s', APPDATA: 'C:\\Users\\s\\AppData\\Roaming', PATH: '' },
      platform: 'win32',
    });
    const slashes = (path: string) => path.replace(/\\/g, '/');
    expect(slashes(byId(win, 'claude-desktop'))).toBe(
      'C:/Users/s/AppData/Roaming/Claude/claude_desktop_config.json',
    );
    expect(slashes(byId(win, 'cursor'))).toBe('C:/Users/s/.cursor/mcp.json');
    expect(slashes(byId(win, 'codex'))).toBe('C:/Users/s/.codex/config.toml');
  });
});

describe('Codex TOML', () => {
  it('appends a section and later replaces it while keeping the rest of the file', async () => {
    const dir = await home();
    const setup = linux(dir);
    const path = join(dir, '.codex', 'config.toml');
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, 'model = "o3"\n\n[mcp_servers.other]\ncommand = "x"\n');
    const codex = client(setup, 'codex');
    expect(codex.detect().installed).toBe(true);

    const first = await codex.write(entry, { dryRun: false });
    expect(first.changed).toBe(true);
    const appended = await readFile(path, 'utf8');
    expect(appended).toBe(
      [
        'model = "o3"',
        '',
        '[mcp_servers.other]',
        'command = "x"',
        '',
        '[mcp_servers.tudelft]',
        'command = "/usr/bin/node"',
        'args = ["/opt/tudelft-mcp/dist/cli.js", "serve"]',
        'startup_timeout_sec = 30',
        'tool_timeout_sec = 300',
        '',
      ].join('\n'),
    );

    await writeFile(
      path,
      [
        '[mcp_servers.tudelft]',
        'command = "old"',
        'args = []',
        '',
        '[mcp_servers.other]',
        'command = "x"',
        '',
      ].join('\n'),
    );
    const second = await codex.write({ command: 'tudelft-mcp', args: ['serve'] }, { dryRun: false });
    expect(second.changed).toBe(true);
    expect(norm(second.backup ?? '')).toBe(norm(`${path}.bak`));
    expect(await readFile(path, 'utf8')).toBe(
      [
        '[mcp_servers.tudelft]',
        'command = "tudelft-mcp"',
        'args = ["serve"]',
        'startup_timeout_sec = 30',
        'tool_timeout_sec = 300',
        '',
        '[mcp_servers.other]',
        'command = "x"',
        '',
      ].join('\n'),
    );
    const third = await codex.write({ command: 'tudelft-mcp', args: ['serve'] }, { dryRun: false });
    expect(third.changed).toBe(false);
  });
});

describe('ChatGPT', () => {
  it('is never detected and only prints instructions', async () => {
    const chatgpt = client(linux(await home()), 'chatgpt');
    expect(chatgpt.detect().installed).toBe(false);
    const result = await chatgpt.write(entry, { dryRun: false });
    expect(result.changed).toBe(false);
    expect(result.manual).toBeTruthy();
    expect(result.preview).toBe(CHATGPT_STEPS);
    expect(CHATGPT_STEPS).toContain('serve --http --tunnel');
  });
});

describe('runSetup', () => {
  const ctx = {} as AppContext;
  const argsFor = (positional: string[], flags: ParsedArgs['flags']): ParsedArgs => ({
    command: 'setup',
    positional,
    flags,
  });

  it('prints a JSON report in dry-run mode without creating files', async () => {
    const dir = await home();
    const chunks: string[] = [];
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      chunks.push(String(chunk));
      return true;
    });
    try {
      await runSetup(
        ctx,
        argsFor(['cursor', 'codex'], { 'dry-run': true, json: true, command: 'npx' }),
        () => undefined,
        linux(dir),
      );
    } finally {
      spy.mockRestore();
    }
    const report = JSON.parse(chunks.join('')) as {
      command: { command: string; args: string[] };
      dryRun: boolean;
      results: Array<{ id: string; changed: boolean; path: string }>;
    };
    expect(report.command).toEqual({ command: 'npx', args: ['-y', 'tudelft-mcp', 'serve'] });
    expect(report.dryRun).toBe(true);
    expect(report.results.map((r) => r.id)).toEqual(['cursor', 'codex']);
    expect(report.results.every((r) => r.changed)).toBe(true);
    expect(await readdir(dir)).toEqual([]);
  });

  it('rejects unknown client ids and bad --command values', async () => {
    const dir = await home();
    await expect(runSetup(ctx, argsFor(['nope'], {}), () => undefined, linux(dir))).rejects.toThrow(
      /Unknown client "nope"/,
    );
    await expect(
      runSetup(ctx, argsFor(['cursor'], { command: 'yarn' }), () => undefined, linux(dir)),
    ).rejects.toThrow(/--command/);
  });
});
