import type { AppContext } from '../context.js';
import { TudelftError } from '../errors.js';
import { getLibrary } from '../index/install.js';
import { timeOf, toLocal } from '../util/dates.js';
import { array, numericId, record, str } from '../util/text.js';
import { describe, readFileResource, richLinks } from './content.js';

export interface Announcement {
  id: string;
  courseId: string;
  title: string;
  text: string;
  links: { title: string; url: string }[];
  attachments: { fileId: string; fileName: string; size: number }[];
  publishedAt: string | null;
  publishedLocal?: string;
  modifiedAt: string | null;
  pinned: boolean;
  url: string;
}

export function parseAnnouncement(raw: unknown, courseId: string, origin: string): Announcement | undefined {
  const item = record(raw);
  const id = str(item.Id);
  if (!/^\d+$/.test(id) || item.IsHidden === true || item.IsPublished === false) return undefined;
  const publishedAt =
    typeof item.StartDate === 'string'
      ? item.StartDate
      : typeof item.CreatedDate === 'string'
        ? item.CreatedDate
        : null;
  const local = toLocal(publishedAt);
  return {
    id,
    courseId,
    title: str(item.Title).trim(),
    text: describe(item.Body),
    links: richLinks(item.Body, origin),
    attachments: array(item.Attachments)
      .map(record)
      .filter((file) => /^\d+$/.test(str(file.FileId)))
      .map((file) => ({
        fileId: str(file.FileId),
        fileName: str(file.FileName),
        size: Number(file.Size) || 0,
      })),
    publishedAt,
    ...(local ? { publishedLocal: local } : {}),
    modifiedAt: typeof item.LastModifiedDate === 'string' ? item.LastModifiedDate : null,
    pinned: item.IsPinned === true,
    url: `${origin}/d2l/le/news/${courseId}/${id}/view`,
  };
}

export async function announcements(
  ctx: AppContext,
  courseId: string,
  options: { since?: Date; limit?: number } = {},
): Promise<{ items: Announcement[]; complete: boolean }> {
  const id = numericId(courseId, 'course id');
  const result = await ctx.brightspace.list('le', `${id}/news/`);
  const since = options.since?.getTime();
  const items = result.items
    .map((raw) => parseAnnouncement(raw, id, ctx.brightspace.origin))
    .filter((item): item is Announcement => Boolean(item))
    .filter(
      (item) =>
        since === undefined ||
        (timeOf(item.modifiedAt ?? item.publishedAt) ?? Number.POSITIVE_INFINITY) >= since,
    )
    .sort((a, b) => (timeOf(b.publishedAt) ?? 0) - (timeOf(a.publishedAt) ?? 0));
  const library = await getLibrary(ctx);
  const fetchedAt = new Date().toISOString();
  await library.putMany(
    items
      .filter((item) => item.text)
      .map((item) => ({
        id: `${id}:news:${item.id}`,
        courseId: id,
        kind: 'announcement',
        title: item.title,
        text: item.text,
        url: item.url,
        fetchedAt,
      })),
  );
  return { items: options.limit ? items.slice(0, options.limit) : items, complete: result.complete };
}

export async function readAnnouncementAttachment(
  ctx: AppContext,
  courseId: string,
  announcementId: string,
  fileId: string,
  options: { download?: boolean; offset?: number; maxChars?: number },
) {
  const id = numericId(courseId, 'course id');
  const news = numericId(announcementId, 'announcement id');
  const file = numericId(fileId, 'file id');
  const item = parseAnnouncement(
    await ctx.brightspace.get('le', `${id}/news/${news}`),
    id,
    ctx.brightspace.origin,
  );
  const attachment = item?.attachments.find((a) => a.fileId === file);
  if (!item || !attachment)
    throw new TudelftError('NOT_FOUND', 'This file is not attached to that announcement.');
  return readFileResource(ctx, {
    apiPath: `${id}/news/${news}/attachments/${file}`,
    indexId: `${id}:newsfile:${news}:${file}`,
    courseId: id,
    kind: 'announcement_file',
    title: `${item.title} / ${attachment.fileName}`,
    sourceUrl: item.url,
    filename: attachment.fileName,
    ...options,
  });
}
