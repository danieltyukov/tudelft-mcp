import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export type JsonObject = Record<string, unknown>;

/** Outcome of touching one config file. `manual` is set when the file was left alone on purpose. */
export interface FileChange {
  changed: boolean;
  path: string;
  /** The exact snippet that was (or should be) added. */
  preview: string;
  /** Path of the backup written before the change, when there was a previous version. */
  backup?: string;
  /** Why the file was not written. The preview then has to be added by hand. */
  manual?: string;
}

export interface WriteOutcome {
  changed: boolean;
  backup?: string;
}

export async function readText(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

/** Parse a JSON object file. A missing file gives undefined; anything that is not an object throws. */
export async function readJsonObject(path: string): Promise<JsonObject | undefined> {
  const text = await readText(path);
  if (text === undefined) return undefined;
  if (!text.trim()) return {};
  const parsed: unknown = JSON.parse(text);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new SyntaxError('The file does not contain a JSON object.');
  }
  return parsed as JsonObject;
}

/** Return a copy of `doc` with `value` stored at the key path. Other keys are kept as they are. */
export function setNested(doc: JsonObject, keys: string[], value: unknown): JsonObject {
  const root = structuredClone(doc);
  let cursor = root;
  for (const key of keys.slice(0, -1)) {
    const next = cursor[key];
    if (!next || typeof next !== 'object' || Array.isArray(next)) cursor[key] = {};
    cursor = cursor[key] as JsonObject;
  }
  cursor[keys[keys.length - 1]!] = value;
  return root;
}

/** Write `next` when it differs from the current content, saving the previous version as <path>.bak. */
export async function writeWithBackup(path: string, next: string, dryRun: boolean): Promise<WriteOutcome> {
  const current = await readText(path);
  if (current === next) return { changed: false };
  if (dryRun) return { changed: true };
  await mkdir(dirname(path), { recursive: true });
  let backup: string | undefined;
  if (current !== undefined) {
    backup = `${path}.bak`;
    await writeFile(backup, current, 'utf8');
  }
  await writeFile(path, next, 'utf8');
  return backup ? { changed: true, backup } : { changed: true };
}

const reason = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** Merge `value` into the JSON file at `keys`, keeping everything else in the file. */
export async function mergeJsonFile(
  path: string,
  keys: string[],
  value: unknown,
  dryRun: boolean,
): Promise<FileChange> {
  const preview = JSON.stringify(setNested({}, keys, value), null, 2);
  let doc: JsonObject | undefined;
  try {
    doc = await readJsonObject(path);
  } catch (error) {
    return {
      changed: false,
      path,
      preview,
      manual: `${path} could not be parsed as plain JSON (${reason(error)}), so it was left alone.`,
    };
  }
  const next = `${JSON.stringify(setNested(doc ?? {}, keys, value), null, 2)}\n`;
  try {
    return { path, preview, ...(await writeWithBackup(path, next, dryRun)) };
  } catch (error) {
    return { changed: false, path, preview, manual: `${path} could not be written (${reason(error)}).` };
  }
}

const normalizeHeader = (line: string): string => line.trim().replace(/\s+/g, '');

/**
 * Replace the `[header]` block in a TOML document, or append it when missing.
 * A block runs from its header line to the next line that starts with "[" or to the end.
 */
export function replaceTomlSection(text: string, header: string, body: string): string {
  const lines = text.split('\n');
  const wanted = normalizeHeader(header);
  const start = lines.findIndex((line) => normalizeHeader(line) === wanted);
  const section = `${header}\n${body.replace(/\s+$/, '')}`;
  if (start === -1) {
    const trimmed = text.replace(/\s+$/, '');
    return trimmed ? `${trimmed}\n\n${section}\n` : `${section}\n`;
  }
  let end = start + 1;
  while (end < lines.length && !lines[end]!.trimStart().startsWith('[')) end++;
  const parts = [...lines.slice(0, start), ...section.split('\n')];
  const tail = lines.slice(end);
  if (tail.some((line) => line.trim())) parts.push('', ...tail);
  const out = parts.join('\n');
  return out.endsWith('\n') ? out : `${out}\n`;
}

/** Write or replace one TOML section in the file at `path`. */
export async function mergeTomlSection(
  path: string,
  header: string,
  body: string,
  dryRun: boolean,
): Promise<FileChange> {
  const preview = `${header}\n${body}`;
  try {
    const current = (await readText(path)) ?? '';
    const next = replaceTomlSection(current, header, body);
    return { path, preview, ...(await writeWithBackup(path, next, dryRun)) };
  } catch (error) {
    return { changed: false, path, preview, manual: `${path} could not be written (${reason(error)}).` };
  }
}
