import { rm } from 'node:fs/promises';
import type { AppContext, Logger } from '../context.js';
import { toSafeError, TudelftError } from '../errors.js';
import { captureBrightspace, waitForBrightspace } from './brightspace-auth.js';

export interface LoginOptions {
  fresh?: boolean;
  /** Restrict to a subset of connectors by name, e.g. ["osiris"]. Brightspace always runs. */
  only?: string[];
  timeoutMs?: number;
}

export interface LoginReport {
  brightspace:
    | { connected: true; account: { id: string; name: string } }
    | { connected: false; error: ReturnType<typeof toSafeError> };
  services: Record<
    string,
    Record<string, unknown> | { connected: false; error: ReturnType<typeof toSafeError> }
  >;
  finishedAt: string;
}

/**
 * The one interactive sign-in. Opens the persistent profile headed, waits for
 * the student to reach the Brightspace home page, then lets each registered
 * connector sign into its own service in the same window.
 */
export async function runLogin(ctx: AppContext, options: LoginOptions, log: Logger): Promise<LoginReport> {
  const { config } = ctx;
  if (options.fresh) {
    await ctx.browser.closeActive();
    await rm(config.profileDir, { recursive: true, force: true });
    log('Removed the saved browser profile; starting clean.');
  }
  const timeoutMs = options.timeoutMs ?? config.loginTimeoutMs;
  const report: LoginReport = {
    brightspace: { connected: false, error: { code: 'LOGIN_TIMEOUT', message: 'Sign-in did not complete.' } },
    services: {},
    finishedAt: '',
  };
  await ctx.browser.withContext({ headless: false, seed: !options.fresh }, async (context) => {
    const page = context.pages()[0] ?? (await context.newPage());
    log(
      `Opening ${config.brightspaceUrl} in ${ctx.browser.describe()?.name ?? 'the browser'}. Finish the TU Delft sign-in there (${Math.round(timeoutMs / 60_000)} minutes).`,
    );
    await page.goto(`${config.brightspaceUrl}/d2l/home`, { waitUntil: 'domcontentloaded', timeout: 90_000 });
    try {
      await waitForBrightspace(page, config.brightspaceUrl, { timeoutMs, silent: false });
      const captured = await captureBrightspace(context, page, config);
      await ctx.session.update((data) => {
        data.brightspace = captured;
      });
      report.brightspace = {
        connected: true,
        account: { id: captured.identity.id, name: captured.identity.name },
      };
      log(`Brightspace connected as ${captured.identity.name || captured.identity.uniqueName}.`);
    } catch (error) {
      report.brightspace = { connected: false, error: toSafeError(error) };
      log(`Brightspace sign-in failed: ${toSafeError(error).message}`);
      return;
    }
    for (const connector of ctx.connectors) {
      if (options.only && !options.only.includes(connector.name)) continue;
      if (page.isClosed()) {
        report.services[connector.name] = {
          connected: false,
          error: toSafeError(new TudelftError('LOGIN_CANCELLED', 'The window was closed.')),
        };
        continue;
      }
      log(`Connecting ${connector.name}...`);
      try {
        report.services[connector.name] = await connector.connect(context, ctx, log);
        log(`${connector.name} connected.`);
      } catch (error) {
        const safe = toSafeError(error);
        report.services[connector.name] = { connected: false, error: safe };
        log(`${connector.name} not connected: ${safe.message}`);
      }
    }
  });
  report.finishedAt = new Date().toISOString();
  return report;
}
