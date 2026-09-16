import type { BrowserContext } from 'playwright-core';
import { captureBrightspace, waitForBrightspace } from './auth/brightspace-auth.js';
import { BrowserManager } from './auth/browser.js';
import { SessionStore } from './auth/session.js';
import { BrightspaceClient } from './brightspace/client.js';
import { loadConfig, type Config } from './config.js';
import { TudelftError } from './errors.js';
import { PreviewStore } from './previews.js';

export type Logger = (message: string) => void;

/** Diagnostics for TUDELFT_MCP_DEBUG=1, written to stderr so the MCP stream stays clean. */
export const debug: Logger = (message) => {
  if (process.env.TUDELFT_MCP_DEBUG) process.stderr.write(`[tudelft-mcp] ${message}\n`);
};

/**
 * A login connector signs one service in inside the shared browser window.
 * Brightspace is built in; OSIRIS and MyTimetable register theirs.
 */
export interface LoginConnector {
  name: string;
  /** Run inside the interactive login after Brightspace succeeded. */
  connect(context: BrowserContext, ctx: AppContext, log: Logger): Promise<Record<string, unknown>>;
}

export interface AppContext {
  config: Config;
  session: SessionStore;
  browser: BrowserManager;
  previews: PreviewStore;
  brightspace: BrightspaceClient;
  connectors: LoginConnector[];
  /** Extension slots filled by domain modules (OSIRIS, timetable, index). */
  services: Map<string, unknown>;
  /** Silent renewal of the Brightspace session through the headless profile. */
  renewBrightspace(): Promise<boolean>;
  close(): Promise<void>;
}

export function createContext(config: Config = loadConfig()): AppContext {
  const session = new SessionStore(config.sessionFile);
  const browser = new BrowserManager(config);
  const previews = new PreviewStore();
  const services = new Map<string, unknown>();

  const renewBrightspace = async (): Promise<boolean> => {
    const before = await session.load();
    const expected = before.brightspace?.identity.id;
    if (!expected) return false;
    if (browser.interactiveLoginRunning) return false;
    try {
      await browser.withContext({ headless: true }, async (context) => {
        const page = await context.newPage();
        await page.goto(`${config.brightspaceUrl}/d2l/home`, {
          waitUntil: 'domcontentloaded',
          timeout: config.silentLoginTimeoutMs,
        });
        await waitForBrightspace(page, config.brightspaceUrl, {
          timeoutMs: config.silentLoginTimeoutMs,
          silent: true,
        });
        const captured = await captureBrightspace(context, page, config);
        if (captured.identity.id !== expected) {
          throw new TudelftError(
            'ACCOUNT_CHANGED',
            'The renewed Brightspace session belongs to a different account. Run "tudelft-mcp login".',
          );
        }
        await session.update((data) => {
          data.brightspace = captured;
        });
      });
      return true;
    } catch (error) {
      if (error instanceof TudelftError && error.code === 'ACCOUNT_CHANGED') throw error;
      debug(
        `Brightspace renewal failed: ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`,
      );
      return false;
    }
  };

  browser.cookieSeed = async () => {
    const data = await session.load();
    return [...(data.brightspace?.cookies ?? []), ...(data.osiris?.cookies ?? [])];
  };

  const brightspace = new BrightspaceClient(config, session, renewBrightspace);

  const ctx: AppContext = {
    config,
    session,
    browser,
    previews,
    brightspace,
    connectors: [],
    services,
    renewBrightspace,
    async close() {
      previews.clear();
      await browser.closeActive();
      for (const service of services.values()) {
        const closable = service as { close?: () => Promise<void> | void };
        if (typeof closable.close === 'function') await closable.close();
      }
    },
  };
  return ctx;
}

/** Fetch a typed service registered by a domain module. */
export function service<T>(ctx: AppContext, name: string): T {
  const value = ctx.services.get(name);
  if (!value) throw new TudelftError('INTERNAL_ERROR', `Service ${name} is not available.`);
  return value as T;
}
