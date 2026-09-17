import { chmod, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { replaceTomlSection, setNested, writeWithBackup } from '../../src/setup/files.js';

const body = 'command = "tudelft-mcp"\nargs = ["serve"]';
const header = '[mcp_servers.tudelft]';

describe('replaceTomlSection', () => {
  it('appends to an empty or existing document', () => {
    expect(replaceTomlSection('', header, body)).toBe(`${header}\n${body}\n`);
    expect(replaceTomlSection('model = "o3"\n', header, body)).toBe(`model = "o3"\n\n${header}\n${body}\n`);
    expect(replaceTomlSection('model = "o3"', header, body)).toBe(`model = "o3"\n\n${header}\n${body}\n`);
  });

  it('replaces the block up to the next header and keeps everything else', () => {
    const doc = [
      'a = 1',
      '',
      '[ mcp_servers.tudelft ]',
      'command = "old"',
      '',
      '',
      '[[profiles]]',
      'x = 1',
      '',
    ].join('\n');
    expect(replaceTomlSection(doc, header, body)).toBe(
      ['a = 1', '', header, ...body.split('\n'), '', '[[profiles]]', 'x = 1', ''].join('\n'),
    );
  });

  it('replaces a block at the end of the file', () => {
    const doc = ['[other]', 'y = 2', '', header, 'command = "old"', 'args = []'].join('\n');
    expect(replaceTomlSection(doc, header, body)).toBe(
      ['[other]', 'y = 2', '', header, ...body.split('\n'), ''].join('\n'),
    );
  });
});

describe('setNested', () => {
  it('creates intermediate objects and keeps siblings', () => {
    const doc = { mcpServers: { other: { command: 'x' } }, flag: true };
    const next = setNested(doc, ['mcpServers', 'tudelft'], { command: 'y' });
    expect(next).toEqual({ mcpServers: { other: { command: 'x' }, tudelft: { command: 'y' } }, flag: true });
    expect(doc.mcpServers).not.toHaveProperty('tudelft');
    expect(setNested({ mcpServers: 'oops' }, ['mcpServers', 'tudelft'], 1)).toEqual({
      mcpServers: { tudelft: 1 },
    });
  });
});

describe('writeWithBackup', () => {
  const mode = async (path: string): Promise<number> => (await stat(path)).mode & 0o777;

  it('gives the backup the same permissions as the original file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tudelft-files-'));
    const path = join(dir, 'config.json');
    await writeFile(path, 'old');
    await chmod(path, 0o600);
    const result = await writeWithBackup(path, 'new', false);
    expect(result).toEqual({ changed: true, backup: `${path}.bak` });
    expect(await readFile(`${path}.bak`, 'utf8')).toBe('old');
    expect(await readFile(path, 'utf8')).toBe('new');
    expect(await mode(`${path}.bak`)).toBe(await mode(path));
  });

  it('fixes the permissions of a backup left over from an earlier run', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tudelft-files-'));
    const path = join(dir, 'config.json');
    await writeFile(path, 'old');
    await chmod(path, 0o600);
    await writeFile(`${path}.bak`, 'stale');
    await chmod(`${path}.bak`, 0o644);
    await writeWithBackup(path, 'new', false);
    expect(await readFile(`${path}.bak`, 'utf8')).toBe('old');
    expect(await mode(`${path}.bak`)).toBe(await mode(path));
  });
});
