import type { Page } from 'playwright-core';
import type { AppContext } from '../context.js';
import { TudelftError } from '../errors.js';
import { numericId, record, str } from '../util/text.js';
import { waitForBrightspace } from '../auth/brightspace-auth.js';

export interface CatalogItem {
  courseId: string;
  title: string;
  courseCode?: string;
  semester?: string;
  url: string;
}

/** Parse "EE2C1 Transistor Circuits (2026/27 Q1)" plus its Discover link. */
export function parseCatalogItem(text: string, href: string | null, origin: string): CatalogItem | undefined {
  const id = /\/d2l\/le\/discovery\/view\/course\/(\d+)/.exec(href ?? '')?.[1];
  if (!id) return undefined;
  const clean = text
    .replace(/\s+/g, ' ')
    .replace(/Click to view activity.*$/i, '')
    .trim();
  const item: CatalogItem = {
    courseId: id,
    title: clean,
    url: `${origin}/d2l/le/discovery/view/course/${id}`,
  };
  const match = /^([A-Z]{2,6}\d[A-Z0-9-]*)\s+(.*?)(?:\s*\(([^)]*)\))?$/.exec(clean);
  if (match) {
    item.courseCode = match[1]!;
    item.title = match[2]!.trim() || clean;
    if (match[3]) item.semester = match[3].trim();
  }
  return item;
}

async function openDiscovery(ctx: AppContext, page: Page, url: string): Promise<void> {
  const origin = ctx.brightspace.origin;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: ctx.config.silentLoginTimeoutMs });
  if (!page.url().startsWith(origin)) {
    await waitForBrightspace(page, origin, { timeoutMs: ctx.config.silentLoginTimeoutMs, silent: true });
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: ctx.config.silentLoginTimeoutMs });
  }
  await page.locator('discovery-app').first().waitFor({ state: 'attached', timeout: 20_000 });
}

/** Search the Brightspace Discover catalogue through the signed-in headless profile. */
export async function searchCatalog(
  ctx: AppContext,
  query: string,
): Promise<{ query: string; items: CatalogItem[]; url: string }> {
  const trimmed = query.trim();
  if (!trimmed || trimmed.length > 200)
    throw new TudelftError('INVALID_ARGUMENT', 'Give a search query of 1 to 200 characters.');
  await ctx.brightspace.identity();
  const origin = ctx.brightspace.origin;
  const url = `${origin}/d2l/le/discovery/view/search?query=${encodeURIComponent(trimmed)}`;
  return ctx.browser.withContext({ headless: true }, async (context) => {
    const page = await context.newPage();
    await openDiscovery(ctx, page, url);
    const results = page.locator('d2l-list-item-button, d2l-list-item[href]');
    await Promise.race([
      results.first().waitFor({ state: 'attached', timeout: 25_000 }),
      page
        .getByText(/no results|0 results|is now ready/i)
        .first()
        .waitFor({ timeout: 25_000 }),
    ]).catch(() => undefined);
    await page.waitForTimeout(800);
    const raw = await results.evaluateAll((nodes) =>
      nodes.map((node) => ({ text: node.textContent ?? '', href: node.getAttribute('href') })),
    );
    const items = raw
      .map((entry) => parseCatalogItem(entry.text, entry.href, origin))
      .filter((item): item is CatalogItem => Boolean(item));
    return { query: trimmed, items, url };
  });
}

export interface EnrollmentPlan {
  courseId: string;
  title: string;
  courseCode?: string;
  semester?: string;
  description: string;
  url: string;
}

async function readCoursePage(
  ctx: AppContext,
  page: Page,
  courseId: string,
): Promise<EnrollmentPlan & { enrolButton: boolean }> {
  const origin = ctx.brightspace.origin;
  const url = `${origin}/d2l/le/discovery/view/course/${courseId}`;
  await openDiscovery(ctx, page, url);
  const course = page.locator('discovery-course').first();
  await course.waitFor({ state: 'attached', timeout: 25_000 });
  await page.waitForTimeout(800);
  const heading =
    (await course
      .locator('h1, h2')
      .first()
      .textContent()
      .catch(() => '')) ?? '';
  const text = ((await course.textContent().catch(() => '')) ?? '').replace(/\s+/g, ' ');
  const code = /Course Code\s*([A-Z0-9+_-]+)/i.exec(text)?.[1];
  const semester = /Semester\s*([0-9]{4}\/[0-9]{2}\s*Q[1-5])/i.exec(text)?.[1];
  const description =
    /Course Description\s*(.*?)(?:Enroll in Course|Open Course|$)/i.exec(text)?.[1]?.trim() ?? '';
  const enrolButton = (await page.locator('d2l-button', { hasText: /enrol/i }).count()) > 0;
  const plan: EnrollmentPlan & { enrolButton: boolean } = {
    courseId,
    title: heading.trim() || text.slice(0, 80),
    description: description.slice(0, 2000),
    url,
    enrolButton,
  };
  if (code) plan.courseCode = code;
  if (semester) plan.semester = semester;
  return plan;
}

async function isMember(ctx: AppContext, courseId: string): Promise<boolean> {
  try {
    const row = record(await ctx.brightspace.get('lp', `enrollments/myenrollments/${courseId}`));
    return str(record(row.OrgUnit).Id) === courseId;
  } catch (error) {
    if (error instanceof TudelftError && ['NOT_FOUND', 'PERMISSION_DENIED'].includes(error.code))
      return false;
    throw error;
  }
}

/** Read a Discover course page and store a one-use enrolment preview. Nothing is changed. */
export async function prepareEnrollment(ctx: AppContext, courseRef: string) {
  const courseId = numericId(courseRef, 'course id');
  const identity = await ctx.brightspace.identity();
  if (await isMember(ctx, courseId))
    throw new TudelftError('ALREADY_DONE', 'You are already enrolled in this course.');
  const plan = await ctx.browser.withContext({ headless: true }, async (context) =>
    readCoursePage(ctx, await context.newPage(), courseId),
  );
  if (!plan.enrolButton)
    throw new TudelftError('NOT_ALLOWED', 'This course does not offer self-enrolment on its Discover page.');
  const { enrolButton: _button, ...preview } = plan;
  const created = ctx.previews.create('course_enrollment', identity.id, preview);
  return {
    confirmationToken: created.token,
    expiresAt: new Date(created.expiresAt).toISOString(),
    preview,
    status: 'preview_only',
    note: 'Nothing was changed. Enrolling gives Brightspace access only; it is not an OSIRIS course registration. Confirm only after the student approves this exact course.',
  };
}

/** Click "Enroll in Course" once and verify membership through the API. */
export async function confirmEnrollment(ctx: AppContext, token: string, confirmed: boolean) {
  const identity = await ctx.brightspace.identity();
  const { payload: plan } = ctx.previews.consume<EnrollmentPlan>(
    token,
    'course_enrollment',
    identity.id,
    confirmed,
  );
  if (await isMember(ctx, plan.courseId))
    return {
      status: 'already_member',
      courseId: plan.courseId,
      url: `${ctx.brightspace.origin}/d2l/home/${plan.courseId}`,
    };
  await ctx.browser.withContext({ headless: true }, async (context) => {
    const page = await context.newPage();
    const current = await readCoursePage(ctx, page, plan.courseId);
    if (!current.enrolButton)
      throw new TudelftError('PREVIEW_CHANGED', 'The enrol button is no longer offered. Prepare again.');
    await page.locator('d2l-button', { hasText: /enrol/i }).first().click({ timeout: 10_000 });
    await page
      .getByText(/enrol?lment complete|you are now enrolled|open course/i)
      .first()
      .waitFor({ timeout: 25_000 })
      .catch(() => undefined);
    await page.waitForTimeout(1000);
  });
  for (let attempt = 0; attempt < 5; attempt++) {
    if (await isMember(ctx, plan.courseId))
      return {
        status: 'enrolled',
        courseId: plan.courseId,
        title: plan.title,
        url: `${ctx.brightspace.origin}/d2l/home/${plan.courseId}`,
      };
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  throw new TudelftError(
    'OUTCOME_UNKNOWN',
    'The enrol request was sent but membership is not visible yet. Check list_courses before trying again.',
  );
}
