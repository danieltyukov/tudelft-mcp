import { createHash } from 'node:crypto';
import { load } from 'cheerio';

export type Row = Record<string, unknown>;

export const record = (value: unknown): Row =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Row) : {};
export const array = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
export const str = (value: unknown): string =>
  typeof value === 'string'
    ? value
    : typeof value === 'number' && Number.isFinite(value)
      ? String(value)
      : '';
export const num = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return undefined;
};
export const bool = (value: unknown): boolean | undefined => (typeof value === 'boolean' ? value : undefined);

/** Convert Brightspace rich text ({Text, Html}) or raw HTML into readable plain text. */
export function plainText(value: unknown): string {
  if (value == null) return '';
  if (typeof value !== 'string') {
    const row = record(value);
    return plainText(row.Html || row.Text || row.Content || '');
  }
  if (!/<[a-z!/]/i.test(value))
    return value
      .replace(/\r/g, '')
      .replace(/[\t ]+/g, ' ')
      .trim();
  const $ = load(value);
  $('script,style,noscript,template,input,button').remove();
  $('br').replaceWith('\n');
  $('p,div,li,tr,h1,h2,h3,h4,h5,h6,blockquote,pre').append('\n');
  return $.root()
    .text()
    .replace(/\r/g, '')
    .replace(/[\t ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function clip(value: unknown, max = 1500): string {
  const text = plainText(value);
  return text.length > max ? text.slice(0, max) + '…' : text;
}

/** Numeric Brightspace identifier as a string. */
export function numericId(value: unknown, label = 'identifier'): string {
  const id = str(value).trim();
  if (!/^\d{1,18}$/.test(id)) throw new InvalidId(label);
  return id;
}

class InvalidId extends Error {
  constructor(label: string) {
    super(`Use the numeric ${label} returned by another tool.`);
    this.name = 'InvalidId';
  }
}

/** Highlight the first query match inside text for search snippets. */
export function snippet(text: string, query: string, length = 500): string {
  const tokens = query.toLocaleLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? [];
  const lower = text.toLocaleLowerCase();
  const positions = tokens.map((token) => lower.indexOf(token)).filter((index) => index >= 0);
  const start = Math.max(0, (positions.length ? Math.min(...positions) : 0) - 80);
  const end = Math.min(text.length, start + length);
  return (start > 0 ? '…' : '') + text.slice(start, end) + (end < text.length ? '…' : '');
}

export function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}
