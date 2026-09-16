import { chmod, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isGlobalInstall, serverCommand } from '../../src/setup/command.js';
import { findOnPath, type SetupEnv } from '../../src/setup/paths.js';

const noPath: SetupEnv = { env: { HOME: '/home/s', PATH: '' }, platform: 'linux' };
const node = '/usr/local/bin/node';

describe('serverCommand', () => {
  it('uses npx when asked', () => {
    expect(serverCommand({ mode: 'npx', setup: noPath })).toEqual({
      command: 'npx',
      args: ['-y', 'tudelft-mcp', 'serve'],
    });
  });

  it('uses the global binary when the entry lives in a global npm prefix', () => {
    expect(isGlobalInstall('/usr/local/lib/node_modules/tudelft-mcp/dist/cli.js')).toBe(true);
    expect(
      isGlobalInstall('C:\\Users\\s\\AppData\\Roaming\\npm\\node_modules\\tudelft-mcp\\dist\\cli.js'),
    ).toBe(true);
    expect(isGlobalInstall('/home/s/project/node_modules/tudelft-mcp/dist/cli.js')).toBe(false);
    expect(isGlobalInstall('/home/s/tudelft-mcp/dist/cli.js')).toBe(false);
    expect(
      serverCommand({
        entry: '/usr/local/lib/node_modules/tudelft-mcp/dist/cli.js',
        execPath: node,
        setup: noPath,
      }),
    ).toEqual({ command: 'tudelft-mcp', args: ['serve'] });
  });

  it('falls back to node plus the absolute cli.js for a local checkout', () => {
    expect(
      serverCommand({ entry: '/home/s/tudelft-mcp/dist/cli.js', execPath: node, setup: noPath }),
    ).toEqual({
      command: node,
      args: ['/home/s/tudelft-mcp/dist/cli.js', 'serve'],
    });
  });

  it('uses the global binary when tudelft-mcp is on PATH, unless mode is node', async () => {
    const bin = await mkdtemp(join(tmpdir(), 'tudelft-bin-'));
    await writeFile(join(bin, 'tudelft-mcp'), '#!/bin/sh\nexit 0\n');
    await chmod(join(bin, 'tudelft-mcp'), 0o755);
    const setup: SetupEnv = { env: { HOME: '/home/s', PATH: `/nonexistent:${bin}` }, platform: 'linux' };
    expect(findOnPath('tudelft-mcp', setup)).toBe(join(bin, 'tudelft-mcp'));
    expect(findOnPath('missing-binary', setup)).toBeUndefined();
    const entry = '/home/s/tudelft-mcp/dist/cli.js';
    expect(serverCommand({ entry, execPath: node, setup })).toEqual({
      command: 'tudelft-mcp',
      args: ['serve'],
    });
    expect(serverCommand({ mode: 'node', entry, execPath: node, setup })).toEqual({
      command: node,
      args: [entry, 'serve'],
    });
  });
});
