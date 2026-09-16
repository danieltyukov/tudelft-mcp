import { Worker } from 'node:worker_threads';
import { extname } from 'node:path';
import mammoth from 'mammoth';
import { zipSync } from 'fflate';
import { TudelftError } from '../errors.js';
import { plainText } from '../util/text.js';
import { extractSlides, extractSpreadsheet, officeXml } from './office.js';
import { extractDelimited, extractNotebook } from './tabular.js';

export interface DocumentText {
  text: string;
  format: string;
  pages?: number;
  warnings: string[];
}

const MAX_FILE_BYTES = 50 * 1024 * 1024;
const MAX_TEXT = 2_000_000;
const TEXT_EXTENSIONS = new Set([
  '.txt',
  '.md',
  '.markdown',
  '.json',
  '.xml',
  '.vtt',
  '.srt',
  '.py',
  '.java',
  '.js',
  '.ts',
  '.r',
  '.c',
  '.cpp',
  '.h',
  '.tex',
  '.m',
  '.sql',
  '.yaml',
  '.yml',
  '.sh',
  '.log',
  '.rst',
  '.v',
  '.vhd',
  '.sv',
]);

/** The worker is plain JavaScript next to this module in src and next to cli.js in dist. */
function workerUrl(): URL {
  return new URL('./pdf-worker.js', import.meta.url);
}

/** PDF text extraction in a worker thread with time and memory limits. */
export async function extractPdf(bytes: Buffer, timeoutMs = 45_000): Promise<DocumentText> {
  const url = workerUrl();
  const data = new Uint8Array(bytes.byteLength);
  data.set(bytes);
  return new Promise((resolve, reject) => {
    const worker = new Worker(url, {
      workerData: { bytes: data, maxPages: 800, maxTextLength: MAX_TEXT },
      transferList: [data.buffer],
      execArgv: [],
      resourceLimits: { maxOldGenerationSizeMb: 512, maxYoungGenerationSizeMb: 64, stackSizeMb: 4 },
      stdout: true,
      stderr: true,
    });
    worker.stdout.resume();
    worker.stderr.resume();
    let settled = false;
    const finish = (error?: TudelftError, result?: DocumentText): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker.terminate().finally(() => (error ? reject(error) : resolve(result!)));
    };
    const timer = setTimeout(
      () =>
        finish(new TudelftError('DOCUMENT_TIMEOUT', 'PDF extraction took too long. Try a smaller document.')),
      timeoutMs,
    );
    worker.once(
      'message',
      (message: { result?: { text: string; pages: number; extractedPages: number }; error?: string }) => {
        if (!message.result) {
          finish(
            new TudelftError(
              'DOCUMENT_PARSE_FAILED',
              'This PDF could not be parsed. It may be damaged or encrypted.',
            ),
          );
          return;
        }
        const { text, pages, extractedPages } = message.result;
        const warnings: string[] = [];
        if (extractedPages < pages)
          warnings.push(`Only the first ${extractedPages} of ${pages} pages were extracted.`);
        if (text.replace(/\[Page \d+\]/g, '').trim().length < 40 * Math.max(1, Math.min(pages, 3)))
          warnings.push('Very little text was found; this PDF may be scanned images. OCR is not available.');
        finish(undefined, { text, format: 'pdf', pages, warnings });
      },
    );
    worker.once('error', () =>
      finish(
        new TudelftError(
          'DOCUMENT_PARSE_FAILED',
          'PDF extraction stopped unexpectedly or ran out of memory.',
        ),
      ),
    );
    worker.once('exit', () =>
      finish(new TudelftError('DOCUMENT_PARSE_FAILED', 'PDF extraction ended without a result.')),
    );
  });
}

function decodeText(bytes: Buffer): { text: string; warnings: string[] } {
  const encoding =
    bytes[0] === 0xff && bytes[1] === 0xfe
      ? 'utf-16le'
      : bytes[0] === 0xfe && bytes[1] === 0xff
        ? 'utf-16be'
        : 'utf-8';
  try {
    return {
      text: new TextDecoder(encoding, { fatal: true }).decode(bytes).replace(/^\uFEFF/, ''),
      warnings: [],
    };
  } catch {
    return {
      text: new TextDecoder(encoding).decode(bytes),
      warnings: ['Some characters could not be decoded and were replaced.'],
    };
  }
}

/** Extract readable text from a downloaded file. Unsupported formats return empty text with a warning. */
export async function extractDocument(
  bytes: Buffer,
  filename: string,
  contentType = '',
): Promise<DocumentText> {
  if (bytes.length > MAX_FILE_BYTES)
    throw new TudelftError('FILE_TOO_LARGE', 'This file exceeds the 50 MB extraction limit.');
  try {
    const result = await extract(bytes, filename, contentType.toLowerCase());
    if (result.text.length > MAX_TEXT) {
      result.text = result.text.slice(0, MAX_TEXT);
      result.warnings.push('Extracted text was cut at 2,000,000 characters.');
    }
    return result;
  } catch (error) {
    if (error instanceof TudelftError) throw error;
    throw new TudelftError(
      'DOCUMENT_PARSE_FAILED',
      'This file could not be parsed. It may be damaged, encrypted or in an unsupported format.',
    );
  }
}

async function extract(bytes: Buffer, filename: string, contentType: string): Promise<DocumentText> {
  const ext = extname(filename).toLowerCase();
  if (
    bytes.subarray(0, 5).toString() === '%PDF-' ||
    ext === '.pdf' ||
    contentType.includes('application/pdf')
  )
    return extractPdf(bytes);
  if (ext === '.docx' || contentType.includes('wordprocessingml')) {
    const zip = officeXml(bytes);
    if (!zip['word/document.xml'])
      throw new TudelftError('DOCUMENT_PARSE_FAILED', 'The Word document has no document.xml.');
    const result = await mammoth.extractRawText({ buffer: Buffer.from(zipSync(zip, { level: 0 })) });
    return {
      text: result.value.trim(),
      format: 'docx',
      warnings: result.messages.length ? ['Some formatting could not be read.'] : [],
    };
  }
  if (ext === '.pptx' || contentType.includes('presentationml')) return extractSlides(officeXml(bytes));
  if (ext === '.xlsx' || contentType.includes('spreadsheetml')) return extractSpreadsheet(officeXml(bytes));
  if (ext === '.ipynb' || contentType.includes('x-ipynb')) {
    const decoded = decodeText(bytes);
    const result = extractNotebook(decoded.text);
    result.warnings.push(...decoded.warnings);
    return result;
  }
  if (
    ext === '.csv' ||
    ext === '.tsv' ||
    contentType.includes('text/csv') ||
    contentType.includes('tab-separated')
  ) {
    const decoded = decodeText(bytes);
    const result = extractDelimited(
      decoded.text,
      ext === '.tsv' || contentType.includes('tab-separated') ? 'tsv' : 'csv',
    );
    result.warnings.push(...decoded.warnings);
    return result;
  }
  if (ext === '.html' || ext === '.htm' || contentType.includes('html')) {
    const decoded = decodeText(bytes);
    return { text: plainText(decoded.text), format: 'html', warnings: decoded.warnings };
  }
  if (TEXT_EXTENSIONS.has(ext) || contentType.startsWith('text/') || contentType.includes('json')) {
    const decoded = decodeText(bytes);
    return { text: decoded.text, format: ext.slice(1) || 'text', warnings: decoded.warnings };
  }
  return {
    text: '',
    format: ext.slice(1) || contentType || 'binary',
    warnings: ['Text extraction is not available for this format; the file can still be downloaded.'],
  };
}

export function isExtractable(filename: string): boolean {
  const ext = extname(filename).toLowerCase();
  return (
    ['.pdf', '.docx', '.pptx', '.xlsx', '.ipynb', '.csv', '.tsv', '.html', '.htm'].includes(ext) ||
    TEXT_EXTENSIONS.has(ext)
  );
}
