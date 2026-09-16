import { extname, join } from 'node:path';
import type { AppContext } from '../context.js';
import { extractDocument, isExtractable } from '../documents/extract.js';
import { saveDownload } from '../documents/download.js';
import { TudelftError } from '../errors.js';
import { getLibrary, accountKey } from '../index/install.js';
import { array, numericId, plainText, record, str } from '../util/text.js';
import { redactLinks, safeLink } from '../util/url.js';
import { load } from 'cheerio';

export interface Topic {
  id: string;
  title: string;
  module: string;
  modulePath: string[];
  type: 'file' | 'link' | 'activity' | 'other';
  typeIdentifier: string;
  activityType: number | null;
  filename?: string;
  extension?: string;
  extractable: boolean;
  external: boolean;
  resourceUrl?: string;
  url: string;
  description: string;
  links: { title: string; url: string }[];
  opensAt: string | null;
  closesAt: string | null;
  dueDate: string | null;
  lastModified: string | null;
  locked: boolean;
  broken: boolean;
  unread: boolean;
}

export interface Module {
  id: string;
  title: string;
  path: string[];
  description: string;
  topicCount: number;
  opensAt: string | null;
  closesAt: string | null;
  lastModified: string | null;
}

export function richLinks(value: unknown, origin: string): { title: string; url: string }[] {
  const row = record(value);
  const html = typeof value === 'string' ? value : str(row.Html || row.Content);
  if (!html) return [];
  const $ = load(html);
  const seen = new Set<string>();
  return $('a[href]')
    .toArray()
    .slice(0, 100)
    .flatMap((element) => {
      const url = safeLink($(element).attr('href'), origin);
      if (!url || seen.has(url)) return [];
      seen.add(url);
      return [{ title: plainText($(element).text()).slice(0, 200) || url, url }];
    });
}

export function describe(value: unknown): string {
  return redactLinks(plainText(value));
}

function classify(
  topic: Record<string, unknown>,
  origin: string,
): Pick<Topic, 'type' | 'external' | 'filename' | 'extension' | 'extractable'> {
  const typeIdentifier = str(topic.TypeIdentifier);
  const url = str(topic.Url);
  let external = false;
  let filename: string | undefined;
  try {
    const parsed = new URL(url, origin);
    external = parsed.origin !== origin;
    if (!external) filename = decodeURIComponent(parsed.pathname.split('/').pop() ?? '');
  } catch {
    /* ignore */
  }
  const extension = filename ? extname(filename).toLowerCase() : '';
  if (typeIdentifier === 'File') {
    return {
      type: 'file',
      external: false,
      ...(filename ? { filename } : {}),
      ...(extension ? { extension } : {}),
      extractable: filename ? isExtractable(filename) : false,
    };
  }
  if (typeIdentifier === 'Link') {
    const activityType = Number(topic.ActivityType);
    if (!external && /\/d2l\/(?:lms|le)\//.test(url) && activityType !== 2)
      return { type: 'activity', external: false, extractable: false };
    return { type: 'link', external, extractable: false };
  }
  return { type: 'other', external, extractable: false };
}

export function flattenToc(
  payload: unknown,
  courseId: string,
  origin: string,
): { modules: Module[]; topics: Topic[] } {
  const root = record(payload);
  if (!Array.isArray(root.Modules))
    throw new TudelftError('FORMAT_CHANGED', 'Brightspace returned an unfamiliar course content tree.');
  const modules: Module[] = [];
  const topics: Topic[] = [];
  const seen = new Set<string>();
  const walk = (nodes: unknown[], path: string[], depth: number): void => {
    if (depth > 25) return;
    for (const raw of nodes) {
      const node = record(raw);
      if (node.IsHidden === true) continue;
      const id = str(node.ModuleId ?? node.Id);
      if (!/^\d+$/.test(id) || seen.has(`m${id}`)) continue;
      seen.add(`m${id}`);
      const title = str(node.Title).trim();
      const trail = [...path, title];
      const moduleTopics = array(node.Topics)
        .map(record)
        .filter((topic) => topic.IsHidden !== true);
      modules.push({
        id,
        title,
        path: trail,
        description: describe(node.Description),
        topicCount: moduleTopics.length,
        opensAt: typeof node.StartDateTime === 'string' ? node.StartDateTime : null,
        closesAt: typeof node.EndDateTime === 'string' ? node.EndDateTime : null,
        lastModified: typeof node.LastModifiedDate === 'string' ? node.LastModifiedDate : null,
      });
      for (const topic of moduleTopics) {
        const topicId = str(topic.TopicId ?? topic.Id);
        if (!/^\d+$/.test(topicId) || seen.has(`t${topicId}`)) continue;
        seen.add(`t${topicId}`);
        const resourceUrl = safeLink(topic.Url, origin);
        topics.push({
          id: topicId,
          title: str(topic.Title).trim(),
          module: trail.join(' / '),
          modulePath: trail,
          ...classify(topic, origin),
          typeIdentifier: str(topic.TypeIdentifier),
          activityType: Number.isFinite(Number(topic.ActivityType)) ? Number(topic.ActivityType) : null,
          ...(resourceUrl ? { resourceUrl } : {}),
          url: `${origin}/d2l/le/content/${courseId}/viewContent/${topicId}/View`,
          description: describe(topic.Description),
          links: richLinks(topic.Description, origin),
          opensAt: typeof topic.StartDateTime === 'string' ? topic.StartDateTime : null,
          closesAt: typeof topic.EndDateTime === 'string' ? topic.EndDateTime : null,
          dueDate: typeof topic.DueDate === 'string' ? topic.DueDate : null,
          lastModified: typeof topic.LastModifiedDate === 'string' ? topic.LastModifiedDate : null,
          locked: topic.IsLocked === true,
          broken: topic.IsBroken === true,
          unread: topic.Unread === true,
        });
      }
      walk(array(node.Modules), trail, depth + 1);
    }
  };
  walk(root.Modules, [], 0);
  return { modules, topics };
}

export async function courseContent(
  ctx: AppContext,
  courseId: string,
): Promise<{ modules: Module[]; topics: Topic[] }> {
  const id = numericId(courseId, 'course id');
  const result = flattenToc(await ctx.brightspace.get('le', `${id}/content/toc`), id, ctx.brightspace.origin);
  const library = await getLibrary(ctx);
  const fetchedAt = new Date().toISOString();
  await library.putMany([
    ...result.modules
      .filter((module) => module.description)
      .map((module) => ({
        id: `${id}:module:${module.id}`,
        courseId: id,
        kind: 'module',
        title: module.path.join(' / '),
        text: module.description,
        url: `${ctx.brightspace.origin}/d2l/le/content/${id}/Home`,
        fetchedAt,
      })),
    ...result.topics
      .filter((topic) => topic.description)
      .map((topic) => ({
        id: `${id}:topicdesc:${topic.id}`,
        courseId: id,
        kind: 'topic',
        title: `${topic.module} / ${topic.title}`,
        text: topic.description,
        url: topic.url,
        fetchedAt,
      })),
  ]);
  return result;
}

export interface MaterialOptions {
  offset?: number;
  maxChars?: number;
  download?: boolean;
}

/** Read one content topic: extract file text (indexing it) or describe the link. */
export async function readMaterial(
  ctx: AppContext,
  courseId: string,
  topicId: string,
  options: MaterialOptions = {},
): Promise<Record<string, unknown>> {
  const id = numericId(courseId, 'course id');
  const topic = numericId(topicId, 'topic id');
  const offset = options.offset ?? 0;
  const maxChars = Math.max(1, Math.min(100_000, options.maxChars ?? 20_000));
  const origin = ctx.brightspace.origin;
  const source = `${origin}/d2l/le/content/${id}/viewContent/${topic}/View`;
  const meta = record(await ctx.brightspace.get('le', `${id}/content/topics/${topic}`));
  const title = str(meta.Title);
  const resourceUrl = safeLink(meta.Url, origin);
  const links = richLinks(meta.Description, origin);
  const description = describe(meta.Description);
  const base = {
    courseId: id,
    topicId: topic,
    title,
    url: source,
    resourceUrl,
    description,
    links,
    fetchedAt: new Date().toISOString(),
  };
  if (Number(meta.TopicType) !== 1) {
    const external = Boolean(resourceUrl) && new URL(resourceUrl!).origin !== origin;
    return {
      ...base,
      kind: external ? 'external_link' : 'activity_link',
      text: description,
      indexed: false,
      note: external
        ? 'This topic points to another service. Open the link with its own sign-in.'
        : 'This topic is a Brightspace activity (quiz, assignment, discussion or page). Use the matching tool or the link.',
    };
  }
  const file = await ctx.brightspace.download(
    await ctx.brightspace.apiUrl('le', `${id}/content/topics/${topic}/file`),
  );
  let filename = file.filename;
  if (!filename) {
    try {
      filename = decodeURIComponent(
        new URL(str(meta.Url) || file.url, origin).pathname.split('/').pop() ?? 'file',
      );
    } catch {
      filename = 'file';
    }
  }
  const document = await extractDocument(file.bytes, filename, file.contentType);
  const text = redactLinks(document.text);
  if (text.trim()) {
    const library = await getLibrary(ctx);
    await library.put({
      id: `${id}:topic:${topic}`,
      courseId: id,
      kind: 'file',
      title: title || filename,
      url: source,
      text,
      fetchedAt: base.fetchedAt,
    });
  }
  let localPath: string | undefined;
  if (options.download) {
    const identity = await ctx.brightspace.identity();
    localPath = await saveDownload(
      join(ctx.config.downloadsDir, accountKey(ctx, identity.id), id),
      filename,
      file.bytes,
    );
  }
  const slice = text.slice(offset, offset + maxChars);
  return {
    ...base,
    kind: 'file',
    filename,
    format: document.format,
    pages: document.pages,
    bytes: file.bytes.length,
    warnings: document.warnings,
    indexed: text.trim().length > 0,
    localPath,
    totalChars: text.length,
    offset,
    text: slice,
    nextOffset: offset + maxChars < text.length ? offset + maxChars : null,
  };
}

/** Download a file and extract it, indexing the result under the given id. Shared by attachments and submissions. */
export async function readFileResource(
  ctx: AppContext,
  input: {
    apiPath: string;
    indexId: string;
    courseId: string;
    kind: string;
    title: string;
    sourceUrl: string;
    filename?: string;
    download?: boolean;
    offset?: number;
    maxChars?: number;
  },
): Promise<Record<string, unknown>> {
  const file = await ctx.brightspace.download(await ctx.brightspace.apiUrl('le', input.apiPath));
  const filename = input.filename || file.filename || 'file';
  const document = await extractDocument(file.bytes, filename, file.contentType);
  const text = redactLinks(document.text);
  const fetchedAt = new Date().toISOString();
  if (text.trim()) {
    const library = await getLibrary(ctx);
    await library.put({
      id: input.indexId,
      courseId: input.courseId,
      kind: input.kind,
      title: input.title || filename,
      url: input.sourceUrl,
      text,
      fetchedAt,
    });
  }
  let localPath: string | undefined;
  if (input.download) {
    const identity = await ctx.brightspace.identity();
    localPath = await saveDownload(
      join(ctx.config.downloadsDir, accountKey(ctx, identity.id), input.courseId),
      filename,
      file.bytes,
    );
  }
  const offset = input.offset ?? 0;
  const maxChars = Math.max(1, Math.min(100_000, input.maxChars ?? 20_000));
  return {
    courseId: input.courseId,
    title: input.title,
    filename,
    url: input.sourceUrl,
    format: document.format,
    pages: document.pages,
    bytes: file.bytes.length,
    warnings: document.warnings,
    indexed: text.trim().length > 0,
    localPath,
    totalChars: text.length,
    offset,
    text: text.slice(offset, offset + maxChars),
    nextOffset: offset + maxChars < text.length ? offset + maxChars : null,
    fetchedAt,
  };
}
