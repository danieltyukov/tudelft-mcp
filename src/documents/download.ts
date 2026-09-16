import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { TudelftError } from '../errors.js';

/** A filename safe on every platform: no path separators, control characters or reserved names. */
export function safeFilename(input: string): string {
  const name = (input.split(/[\\/]/).pop() ?? '')
    .normalize('NFC')
    // eslint-disable-next-line no-control-regex
    .replace(/[<>:"/\\|?*\x00-\x1f\x7f]/g, '_')
    .slice(0, 150)
    .replace(/[. ]+$/, '');
  return !name || /^(con|prn|aux|nul|com\d|lpt\d)(?:\.|$)/i.test(name) ? 'file' : name;
}

/** Write bytes under the downloads directory, deduplicated by content hash. */
export async function saveDownload(directory: string, filename: string, bytes: Buffer): Promise<string> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 10);
  const path = join(directory, `${hash}-${safeFilename(filename)}`);
  try {
    await writeFile(path, bytes, { mode: 0o600, flag: 'wx' });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    const existing = await stat(path);
    if (existing.size !== bytes.length || !(await readFile(path)).equals(bytes)) {
      throw new TudelftError('INTERNAL_ERROR', 'A different file already exists at the download path.');
    }
  }
  return path;
}
