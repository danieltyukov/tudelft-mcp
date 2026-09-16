#!/usr/bin/env node
// Packs the project (or takes a tarball path), installs it globally into a temporary
// npm prefix, and checks that the installed CLI answers `--version` and `tools`.
// Neither command needs network access or a signed-in session.
//
//   node scripts/check-install.mjs                  packs first, then checks
//   node scripts/check-install.mjs tudelft-mcp.tgz  checks an existing tarball
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import process from 'node:process';

const windows = process.platform === 'win32';
const npm = windows ? 'npm.cmd' : 'npm';

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    shell: windows,
    env: { ...process.env, ...options.env },
    cwd: options.cwd,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    process.stderr.write(result.stdout ?? '');
    process.stderr.write(result.stderr ?? '');
    throw new Error(`${command} ${args.join(' ')} exited with ${result.status}`);
  }
  return result.stdout;
}

const work = mkdtempSync(join(tmpdir(), 'tudelft-mcp-check-'));
const prefix = join(work, 'prefix');
const home = join(work, 'home');
try {
  let tarball = process.argv[2] ? resolve(process.argv[2]) : undefined;
  if (!tarball) {
    // The prepack build writes to stdout as well, so look for the tarball on disk
    // instead of parsing `npm pack --json`.
    process.stdout.write('Packing...\n');
    run(npm, ['pack', '--pack-destination', work]);
    const name = readdirSync(work).find((file) => file.endsWith('.tgz'));
    if (!name) throw new Error('npm pack produced no tarball');
    tarball = join(work, name);
  }
  process.stdout.write(`Installing ${tarball} into ${prefix}...\n`);
  run(npm, ['install', '-g', '--prefix', prefix, '--no-audit', '--no-fund', tarball]);

  const bin = windows ? join(prefix, 'tudelft-mcp.cmd') : join(prefix, 'bin', 'tudelft-mcp');
  const env = { TUDELFT_MCP_HOME: home };
  const version = run(bin, ['--version'], { env }).trim();
  if (!/^\d+\.\d+\.\d+/.test(version)) throw new Error(`unexpected --version output: ${version}`);
  const tools = run(bin, ['tools'], { env });
  const count = Number(/(\d+) tools/.exec(tools)?.[1] ?? 0);
  if (!tools.includes('auth_status') || count < 1) throw new Error(`unexpected tools output:\n${tools}`);
  process.stdout.write(`ok: tudelft-mcp ${version} installs and lists ${count} tools\n`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
