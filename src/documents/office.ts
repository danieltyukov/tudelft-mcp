import { load } from 'cheerio';
import { strFromU8, unzipSync, type Unzipped } from 'fflate';
import { posix } from 'node:path';
import { TudelftError } from '../errors.js';
import type { DocumentText } from './extract.js';

const MAX_ENTRIES = 8192;
const MAX_XML_BYTES = 40 * 1024 * 1024;
const MAX_SLIDES = 600;
const MAX_SHEETS = 100;
const MAX_CELLS = 200_000;

/** Unzip only XML parts of an Office package, with size guards. */
export function officeXml(bytes: Uint8Array): Unzipped {
  let count = 0;
  let xmlBytes = 0;
  return unzipSync(bytes, {
    filter: (entry) => {
      if (++count > MAX_ENTRIES)
        throw new TudelftError('FILE_TOO_LARGE', 'The Office file has too many parts to extract.');
      if (entry.name.includes('..') || entry.name.startsWith('/'))
        throw new TudelftError('DOCUMENT_PARSE_FAILED', 'The Office file contains unsafe paths.');
      if (!/\.(?:xml|rels)$/i.test(entry.name)) return false;
      xmlBytes += Math.max(entry.originalSize, 0);
      if (xmlBytes > MAX_XML_BYTES)
        throw new TudelftError('FILE_TOO_LARGE', 'The Office XML exceeds the extraction limit.');
      return true;
    },
  });
}

type Xml = ReturnType<typeof load>;

function xml(bytes: Uint8Array): Xml {
  const text = strFromU8(bytes);
  if (/<!DOCTYPE|<!ENTITY/i.test(text))
    throw new TudelftError(
      'DOCUMENT_PARSE_FAILED',
      'Office XML with document type declarations is not supported.',
    );
  return load(text, { xml: true });
}

function localName(name: string): string {
  return name.split(':').at(-1) ?? name;
}

function elements($: Xml, name: string) {
  return $('*').filter((_, element) => 'name' in element && localName(element.name) === name);
}

function textRuns($: Xml): string {
  return elements($, 't')
    .toArray()
    .map((element) => $(element).text())
    .join('');
}

function paragraphs($: Xml): string {
  const out: string[] = [];
  elements($, 'p').each((_, paragraph) => {
    const text = $(paragraph)
      .find('*')
      .filter((_, element) => 'name' in element && localName(element.name) === 't')
      .toArray()
      .map((element) => $(element).text())
      .join('');
    if (text.trim()) out.push(text.trim());
  });
  return out.length ? out.join('\n') : textRuns($);
}

function relationships(bytes: Uint8Array | undefined, base: string): Map<string, string> {
  const result = new Map<string, string>();
  if (!bytes) return result;
  const $ = xml(bytes);
  elements($, 'Relationship').each((_, element) => {
    const id = $(element).attr('Id');
    const target = $(element).attr('Target');
    if (!id || !target || $(element).attr('TargetMode') === 'External' || /^[a-z]+:/i.test(target)) return;
    const path = target.startsWith('/')
      ? posix.normalize(target.slice(1))
      : posix.normalize(posix.join(base, target));
    if (!path.startsWith('../')) result.set(id, path);
  });
  return result;
}

/** PPTX: slide text in presentation order plus speaker notes. */
export function extractSlides(zip: Unzipped): DocumentText {
  const warnings: string[] = [];
  let names: string[] = [];
  if (zip['ppt/presentation.xml']) {
    const rels = relationships(zip['ppt/_rels/presentation.xml.rels'], 'ppt');
    const $ = xml(zip['ppt/presentation.xml']);
    elements($, 'sldId').each((_, element) => {
      const rid = $(element).attr('r:id') ?? $(element).attr('id');
      const path = rid ? rels.get(rid) : undefined;
      if (path && /^ppt\/slides\/[^/]+\.xml$/.test(path) && zip[path]) names.push(path);
    });
  }
  if (!names.length) {
    names = Object.keys(zip)
      .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
      .sort((a, b) => Number(/slide(\d+)/.exec(a)?.[1]) - Number(/slide(\d+)/.exec(b)?.[1]));
    if (names.length) warnings.push('Slide order was taken from file numbering.');
  }
  if (!names.length)
    throw new TudelftError('DOCUMENT_PARSE_FAILED', 'This presentation has no readable slides.');
  const parts = names.slice(0, MAX_SLIDES).map((name, index) => {
    const rels = relationships(
      zip[posix.join(posix.dirname(name), '_rels', `${posix.basename(name)}.rels`)],
      posix.dirname(name),
    );
    const notes = [...rels.values()].find((path) => /^ppt\/notesSlides\/[^/]+\.xml$/.test(path) && zip[path]);
    const body = paragraphs(xml(zip[name]!));
    const noteText = notes ? paragraphs(xml(zip[notes]!)).replace(/^\d+$/m, '').trim() : '';
    return `[Slide ${index + 1}]\n${body}${noteText ? `\n[Speaker notes]\n${noteText}` : ''}`;
  });
  if (names.length > MAX_SLIDES) warnings.push(`Only the first ${MAX_SLIDES} slides were extracted.`);
  warnings.push('Images and diagrams are not extracted.');
  return { text: parts.join('\n\n'), format: 'pptx', pages: names.length, warnings };
}

function columnName(index: number): string {
  let name = '';
  let n = index;
  while (n > 0) {
    name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
}

/** XLSX: cell values as stored (formulas are not evaluated). */
export function extractSpreadsheet(zip: Unzipped): DocumentText {
  if (!zip['xl/workbook.xml'])
    throw new TudelftError('DOCUMENT_PARSE_FAILED', 'The workbook has no workbook.xml.');
  const warnings = ['Formulas are not evaluated; cached values are shown. Charts and images are omitted.'];
  const workbook = xml(zip['xl/workbook.xml']);
  const rels = relationships(zip['xl/_rels/workbook.xml.rels'], 'xl');
  const shared: string[] = [];
  const sharedPath =
    [...rels.values()].find((name) => /sharedStrings\.xml$/i.test(name)) ?? 'xl/sharedStrings.xml';
  if (zip[sharedPath]) {
    const $ = xml(zip[sharedPath]);
    elements($, 'si').each((_, si) => {
      shared.push(
        $(si)
          .find('*')
          .filter((_, e) => 'name' in e && localName(e.name) === 't')
          .toArray()
          .map((e) => $(e).text())
          .join(''),
      );
    });
  }
  const sheets = elements(workbook, 'sheet').toArray();
  if (sheets.length > MAX_SHEETS) warnings.push(`Only the first ${MAX_SHEETS} sheets were extracted.`);
  const out: string[] = [];
  let cells = 0;
  for (const sheet of sheets.slice(0, MAX_SHEETS)) {
    const name = workbook(sheet).attr('name') ?? 'Sheet';
    const attribs = (sheet as unknown as { attribs?: Record<string, string> }).attribs ?? {};
    const rid = Object.entries(attribs).find(([key]) => localName(key) === 'id' && key.includes(':'))?.[1];
    const path = rid ? rels.get(rid) : undefined;
    if (!path || !zip[path]) continue;
    const $ = xml(zip[path]);
    const rows: string[] = [];
    elements($, 'row').each((_, row) => {
      const values: string[] = [];
      $(row)
        .children()
        .each((_, cell) => {
          if (localName(cell.name) !== 'c') return;
          if (++cells > MAX_CELLS) return;
          const ref = $(cell).attr('r') ?? '';
          const type = $(cell).attr('t');
          let value = '';
          if (type === 'inlineStr') value = $(cell).text();
          else {
            const v = $(cell)
              .children()
              .filter((_, e) => localName(e.name) === 'v')
              .first()
              .text();
            if (type === 's') value = shared[Number(v)] ?? '';
            else if (type === 'b') value = v === '1' ? 'TRUE' : 'FALSE';
            else value = v;
          }
          if (value !== '') values.push(`${ref || columnName(values.length + 1)}=${value}`);
        });
      if (values.length) rows.push(values.join(' | '));
    });
    out.push(`[Sheet ${name}]\n${rows.join('\n')}`);
    if (cells > MAX_CELLS) {
      warnings.push('The spreadsheet was cut after 200,000 cells.');
      break;
    }
  }
  return { text: out.join('\n\n'), format: 'xlsx', pages: sheets.length, warnings };
}
