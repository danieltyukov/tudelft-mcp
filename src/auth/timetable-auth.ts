import type { BrowserContext, Locator, Page } from 'playwright-core';
import type { AppContext, Logger, LoginConnector } from '../context.js';
import { TudelftError } from '../errors.js';
import { timetableService } from '../timetable/install.js';
import { fetchCalendarText } from '../timetable/service.js';
import type { TimetableSession } from './session.js';

const POLL_MS = 750;

/**
 * Validate a personal MyTimetable subscription link. Every query parameter is
 * a secret, so the URL is never logged or returned once accepted.
 */
export function timetableFeedUrl(value: string, timetableOrigin: string): URL {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw || /[\r\n\s]/.test(raw))
    throw new TudelftError('INVALID_URL', 'Paste the complete calendar link from MyTimetable on one line.');
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new TudelftError('INVALID_URL', 'The calendar link is not a valid URL.');
  }
  if (url.origin !== timetableOrigin || url.username || url.password || url.protocol !== 'https:') {
    throw new TudelftError('INVALID_URL', `The calendar link must start with ${timetableOrigin}/ical.`);
  }
  if (url.pathname !== '/ical')
    throw new TudelftError('INVALID_URL', 'The calendar link must point at the MyTimetable /ical feed.');
  if ([...url.searchParams.keys()].length === 0)
    throw new TudelftError('INVALID_URL', 'The calendar link is missing its personal parameters.');
  url.hash = '';
  return url;
}

async function countUpcoming(ctx: AppContext): Promise<number> {
  const service = timetableService(ctx);
  service.invalidate();
  const now = new Date();
  const window = await service.events(
    now.toISOString(),
    new Date(now.getTime() + 14 * 86_400_000).toISOString(),
  );
  return window.items.length;
}

async function saveFeed(ctx: AppContext, url: URL): Promise<Record<string, unknown>> {
  await fetchCalendarText(url, ctx.config.timeoutMs);
  const session: TimetableSession = { icalUrl: url.href, connectedAt: new Date().toISOString() };
  await ctx.session.update((data) => {
    data.timetable = session;
  });
  let eventsNext14Days = 0;
  try {
    eventsNext14Days = await countUpcoming(ctx);
  } catch {
    /* the link works; counting is best effort */
  }
  return { connected: true, connectedAt: session.connectedAt, eventsNext14Days };
}

/** Manual connection: the student pasted the link from MyTimetable "Connect calendar". */
export async function connectTimetable(ctx: AppContext, value: string): Promise<Record<string, unknown>> {
  return saveFeed(ctx, timetableFeedUrl(value, ctx.config.timetableUrl));
}

export async function disconnectTimetable(ctx: AppContext): Promise<Record<string, unknown>> {
  const data = await ctx.session.load();
  const had = Boolean(data.timetable);
  await ctx.session.update((current) => {
    delete current.timetable;
  });
  timetableService(ctx).invalidate();
  return { connected: false, removed: had };
}

async function visible(locator: Locator): Promise<boolean> {
  return locator
    .first()
    .isVisible()
    .catch(() => false);
}

function mainMenu(page: Page): Locator {
  return page.getByRole('button', { name: /main menu/i });
}

async function loginControl(page: Page): Promise<Locator | undefined> {
  const byRole = page.getByRole('link', { name: /^log ?in$/i });
  if (await visible(byRole)) return byRole.first();
  const byButton = page.getByRole('button', { name: /^log ?in$/i });
  if (await visible(byButton)) return byButton.first();
  const byText = page.getByText(/^\s*log ?in\s*$/i);
  if (await visible(byText)) return byText.first();
  return undefined;
}

export interface TimetableCaptureOptions {
  timeoutMs: number;
  silent: boolean;
}

/**
 * Drive the MyTimetable mobile site to the "Connect to calendar app" view and
 * read the personal subscription URL from #export-http-url.
 */
export async function captureTimetableUrl(
  context: BrowserContext,
  origin: string,
  options: TimetableCaptureOptions,
): Promise<string> {
  const page = await context.newPage();
  try {
    await page.goto(`${origin}/m/`, {
      waitUntil: 'domcontentloaded',
      timeout: Math.min(options.timeoutMs, 60_000),
    });
    const deadline = Date.now() + options.timeoutMs;
    let lastClick = 0;
    while (Date.now() < deadline) {
      if (page.isClosed())
        throw new TudelftError(
          'LOGIN_CANCELLED',
          'The sign-in window was closed before MyTimetable connected.',
        );
      if (page.url().includes('#loggedin') || (await visible(mainMenu(page)))) break;
      if (options.silent && (await visible(page.locator('input[type="password"]')))) {
        throw new TudelftError(
          'AUTH_REQUIRED',
          'MyTimetable asks for a password or MFA. Run "tudelft-mcp login" once to sign in again.',
        );
      }
      if (Date.now() - lastClick > 5_000) {
        const control = await loginControl(page);
        if (control) {
          lastClick = Date.now();
          await control.click({ timeout: 5_000 }).catch(() => undefined);
        }
      }
      await page.waitForTimeout(POLL_MS);
    }
    const menu = mainMenu(page);
    if (!(await visible(menu))) {
      throw new TudelftError(
        options.silent ? 'AUTH_REQUIRED' : 'LOGIN_TIMEOUT',
        'MyTimetable did not finish signing in within the time limit.',
      );
    }
    await menu.first().click({ timeout: 10_000 });
    const connect = page.getByRole('button', { name: /connect to calendar app/i });
    const fallback = page.getByText(/connect to calendar app/i);
    const target = (await visible(connect)) ? connect : fallback;
    await target.first().click({ timeout: 10_000 });
    const input = page.locator('#export-http-url');
    await input.waitFor({ state: 'visible', timeout: 15_000 });
    const value = await input.inputValue({ timeout: 5_000 });
    if (!value.trim())
      throw new TudelftError(
        'FORMAT_CHANGED',
        'MyTimetable did not show a calendar link on the connect page.',
      );
    return value;
  } finally {
    await page.close().catch(() => undefined);
  }
}

/** Login connector: runs inside the interactive sign-in after Brightspace succeeded. */
export const timetableConnector: LoginConnector = {
  name: 'timetable',
  async connect(context: BrowserContext, ctx: AppContext, log: Logger): Promise<Record<string, unknown>> {
    const origin = ctx.config.timetableUrl;
    log(`Opening ${origin}/m/ to read the MyTimetable calendar link.`);
    const value = await captureTimetableUrl(context, origin, { timeoutMs: 90_000, silent: false });
    return saveFeed(ctx, timetableFeedUrl(value, origin));
  },
};
