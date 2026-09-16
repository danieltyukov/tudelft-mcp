import type { AppContext } from '../context.js';
import { TudelftError } from '../errors.js';
import { sameOrigin, safeLink } from '../util/url.js';
import { waitForBrightspace } from '../auth/brightspace-auth.js';

const UNSAFE =
  /logout|signout|delete|remove|unenrol|unsubscribe|submit|register|enrol|complete|markread|\/d2l\/(?:login|lp\/auth)|quiz[^?]*(?:attempt|start|take)|(?:attempt|start|take)[^?]*quiz|[?&](?:action|cmd)=(?:start|attempt|launch)|\/lti\/|[?&]type=lti/i;

export function validatePageUrl(input: string, origin: string): string {
  const url = sameOrigin(input, origin);
  let path = url.pathname + url.search;
  try {
    for (let i = 0; i < 3; i++) {
      const decoded = decodeURIComponent(path);
      if (decoded === path) break;
      path = decoded;
    }
  } catch {
    throw new TudelftError('INVALID_URL', 'The URL contains invalid escaping.');
  }
  if (UNSAFE.test(path))
    throw new TudelftError(
      'NOT_ALLOWED',
      'This URL performs an action. Use the dedicated tool instead of the page reader.',
    );
  return url.href;
}

/** Load a Brightspace page in the signed-in headless profile and return its visible text and links. */
export async function readPage(ctx: AppContext, input: string, maxChars = 30_000) {
  const origin = ctx.brightspace.origin;
  const url = validatePageUrl(input, origin);
  await ctx.brightspace.identity();
  return ctx.browser.withContext({ headless: true }, async (context) => {
    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: ctx.config.silentLoginTimeoutMs });
    if (!page.url().startsWith(origin)) {
      await waitForBrightspace(page, origin, { timeoutMs: ctx.config.silentLoginTimeoutMs, silent: true });
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: ctx.config.silentLoginTimeoutMs });
    }
    await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => undefined);
    const snapshot = await page.evaluate(() => {
      const text = (document.body?.innerText ?? '').replace(/\n{3,}/g, '\n\n');
      const links = [...document.querySelectorAll('a[href]')].slice(0, 300).map((a) => ({
        title: (a.textContent ?? '').trim().slice(0, 150),
        href: (a as HTMLAnchorElement).href,
      }));
      const frames = [...document.querySelectorAll('iframe[src]')]
        .slice(0, 20)
        .map((f) => (f as HTMLIFrameElement).src);
      return { title: document.title, url: location.href, text, links, frames };
    });
    const links = snapshot.links.flatMap((link) => {
      const safe = safeLink(link.href);
      return safe && link.title ? [{ title: link.title, url: safe }] : [];
    });
    return {
      title: snapshot.title,
      url: safeLink(snapshot.url) ?? url,
      text: snapshot.text.slice(0, maxChars),
      truncated: snapshot.text.length > maxChars,
      links: links.slice(0, 200),
      frames: snapshot.frames.map((frame) => safeLink(frame)).filter(Boolean),
      source: 'browser',
      fetchedAt: new Date().toISOString(),
      note: 'Visible page text only. Paginated or collapsed sections may be missing.',
    };
  });
}
