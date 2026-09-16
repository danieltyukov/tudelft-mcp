import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import type { AppContext, Logger } from '../context.js';
import type { ParsedArgs } from '../cli.js';
import { findBrowser } from './browser.js';

export async function browserCommand(ctx: AppContext, args: ParsedArgs, log: Logger): Promise<void> {
  const sub = args.positional[0] ?? 'which';
  if (sub === 'which') {
    const browser = findBrowser(ctx.config);
    if (browser) process.stdout.write(`${browser.name}: ${browser.executablePath}\n`);
    else {
      process.stdout.write(
        'No browser found. Run "tudelft-mcp browser install" or set TUDELFT_BROWSER_PATH.\n',
      );
      process.exitCode = 1;
    }
    return;
  }
  if (sub === 'install') {
    const require = createRequire(import.meta.url);
    const cli = require.resolve('playwright-core/cli');
    log('Downloading Chromium through Playwright (about 170 MB)...');
    await new Promise<void>((resolve, reject) => {
      const child = spawn(process.execPath, [cli, 'install', 'chromium'], { stdio: 'inherit' });
      child.on('error', reject);
      child.on('close', (code) =>
        code === 0 ? resolve() : reject(new Error(`playwright install exited with ${code}`)),
      );
    });
    const browser = findBrowser(ctx.config);
    log(
      browser
        ? `Ready: ${browser.name} at ${browser.executablePath}`
        : 'Chromium downloaded, but it could not be located afterwards.',
    );
    return;
  }
  process.stderr.write('Usage: tudelft-mcp browser [which|install]\n');
  process.exitCode = 2;
}
