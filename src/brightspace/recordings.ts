import type { AppContext } from '../context.js';
import { courseContent, type Topic } from './content.js';

const MEDIA = /\.(?:mp4|m4v|webm|mov|m3u8|mp3|m4a|wav)$/i;
const CAPTION = /\.(?:vtt|srt|ttml|dfxp)$/i;

export function classifyRecording(
  url: string,
  origin: string,
): { provider: string; native: boolean } | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  const host = parsed.hostname.toLowerCase();
  if (parsed.origin === origin && MEDIA.test(parsed.pathname))
    return { provider: 'Brightspace media', native: true };
  if (host === 'collegeramavideoportal.tudelft.nl' || host === 'collegerama.tudelft.nl')
    return { provider: 'Collegerama', native: false };
  if (host === 'youtu.be' || /(?:^|\.)youtube\.com$/.test(host))
    return { provider: 'YouTube', native: false };
  if (/(?:^|\.)vimeo\.com$/.test(host)) return { provider: 'Vimeo', native: false };
  if (/(?:^|\.)panopto\.(?:com|eu)$/.test(host)) return { provider: 'Panopto', native: false };
  if (
    /(?:^|\.)sharepoint\.com$/.test(host) &&
    (/^\/:v:\//.test(parsed.pathname) ||
      /stream\.aspx$/i.test(parsed.pathname) ||
      MEDIA.test(parsed.pathname))
  )
    return { provider: 'SharePoint Stream', native: false };
  if (/(?:^|\.)(?:kaltura|yuja)\.com$/.test(host))
    return { provider: host.includes('kaltura') ? 'Kaltura' : 'YuJa', native: false };
  if (MEDIA.test(parsed.pathname)) return { provider: 'External media', native: false };
  return undefined;
}

export interface RecordingLink {
  url: string;
  title: string;
  provider: string;
  native: boolean;
  module: string;
  topicId: string;
  topicTitle: string;
  captionLinks: string[];
}

/** Find lecture recording links in the course content tree. Nothing is downloaded or played. */
export async function listRecordings(
  ctx: AppContext,
  courseId: string,
): Promise<{ items: RecordingLink[]; scanned: number }> {
  const content = await courseContent(ctx, courseId);
  const origin = ctx.brightspace.origin;
  const found = new Map<string, RecordingLink>();
  const captions: { topicId: string; url: string }[] = [];
  const consider = (topic: Topic, url: string | undefined, title: string): void => {
    if (!url) return;
    if (CAPTION.test(new URL(url).pathname)) {
      captions.push({ topicId: topic.id, url });
      return;
    }
    const kind = classifyRecording(url, origin);
    if (!kind) return;
    if (!found.has(url))
      found.set(url, {
        url,
        title: title || topic.title,
        ...kind,
        module: topic.module,
        topicId: topic.id,
        topicTitle: topic.title,
        captionLinks: [],
      });
  };
  for (const topic of content.topics) {
    consider(topic, topic.resourceUrl, topic.title);
    for (const link of topic.links) consider(topic, link.url, link.title);
  }
  for (const caption of captions) {
    for (const item of found.values())
      if (item.topicId === caption.topicId) item.captionLinks.push(caption.url);
  }
  return { items: [...found.values()], scanned: content.topics.length };
}
