import { rm } from 'node:fs/promises';
import type { AppContext } from '../context.js';
import { toSafeError, TudelftError } from '../errors.js';
import { extractIdentity } from './brightspace-auth.js';

export interface ServiceStatus {
  connected: boolean;
  verified?: boolean;
  account?: { id: string; name: string; uniqueName: string };
  savedAt?: string;
  connectedAt?: string;
  error?: ReturnType<typeof toSafeError>;
}

/** Live verification of every saved session. Extension modules add their own checks. */
export type StatusCheck = (ctx: AppContext) => Promise<ServiceStatus>;
const extraChecks = new Map<string, StatusCheck>();
export function registerStatusCheck(name: string, check: StatusCheck): void {
  extraChecks.set(name, check);
}

export async function authStatus(ctx: AppContext, verify = true): Promise<Record<string, unknown>> {
  const data = await ctx.session.load();
  const brightspace: ServiceStatus = { connected: Boolean(data.brightspace) };
  if (data.brightspace) {
    brightspace.account = {
      id: data.brightspace.identity.id,
      name: data.brightspace.identity.name,
      uniqueName: data.brightspace.identity.uniqueName,
    };
    brightspace.savedAt = data.brightspace.savedAt;
    if (verify) {
      try {
        const me = extractIdentity(await ctx.brightspace.get('lp', 'users/whoami'));
        if (!me) throw new TudelftError('FORMAT_CHANGED', 'The identity response was not recognised.');
        if (me.id !== data.brightspace.identity.id)
          throw new TudelftError(
            'ACCOUNT_CHANGED',
            'The live account differs from the saved one. Run "tudelft-mcp login".',
          );
        brightspace.verified = true;
      } catch (error) {
        brightspace.verified = false;
        brightspace.error = toSafeError(error);
      }
    }
  }
  const services: Record<string, ServiceStatus> = { brightspace };
  for (const [name, check] of extraChecks) {
    try {
      services[name] = await check(ctx);
    } catch (error) {
      services[name] = { connected: false, error: toSafeError(error) };
    }
  }
  const browser = ctx.browser.describe();
  return {
    services,
    browser: browser ? { name: browser.name, path: browser.executablePath } : null,
    loginInProgress: ctx.browser.interactiveLoginRunning,
    dataDir: ctx.config.home,
    checkedAt: new Date().toISOString(),
    hint: brightspace.connected
      ? undefined
      : 'Run "tudelft-mcp login" in a terminal, or call auth_login with interactive:true when the student asks.',
  };
}

export async function logoutAll(ctx: AppContext): Promise<Record<string, unknown>> {
  await ctx.browser.closeActive();
  ctx.previews.clear();
  await ctx.session.clear();
  await rm(ctx.config.profileDir, { recursive: true, force: true });
  return { loggedOut: true, removed: ['session', 'browser profile'], kept: ['downloads', 'search index'] };
}
