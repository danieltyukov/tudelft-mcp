import type { DocumentText } from './extract.js';
import { record, str } from '../util/text.js';

const MAX_ROWS = 50_000;
const MAX_CELLS_OUTPUT = 20_000;

export function extractDelimited(text: string, format: 'csv' | 'tsv'): DocumentText {
  const delimiter = format === 'tsv' ? '\t' : ',';
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  const warnings: string[] = [];
  const out: string[] = [];
  for (const [index, line] of lines.entries()) {
    if (index >= MAX_ROWS) {
      warnings.push(`Only the first ${MAX_ROWS} rows were extracted.`);
      break;
    }
    if (!line.trim()) continue;
    out.push(splitLine(line, delimiter).join(' | '));
  }
  return { text: out.join('\n'), format, warnings };
}

function splitLine(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let current = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i]!;
    if (quoted) {
      if (char === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (char === '"') quoted = false;
      else current += char;
    } else if (char === '"') quoted = true;
    else if (char === delimiter) {
      cells.push(current);
      current = '';
    } else current += char;
  }
  cells.push(current);
  return cells.map((cell) => cell.trim());
}

/** Jupyter notebooks: markdown, code and text outputs. Nothing is executed. */
export function extractNotebook(json: string): DocumentText {
  let notebook: unknown;
  try {
    notebook = JSON.parse(json);
  } catch {
    return { text: '', format: 'ipynb', warnings: ['The notebook JSON could not be parsed.'] };
  }
  const cells = record(notebook).cells;
  if (!Array.isArray(cells)) return { text: '', format: 'ipynb', warnings: ['The notebook has no cells.'] };
  const warnings = [
    'Notebook code was not executed; saved outputs may be stale. Images and widgets are omitted.',
  ];
  const parts: string[] = [];
  let outputChars = 0;
  cells.slice(0, 5000).forEach((raw, index) => {
    const cell = record(raw);
    const type = str(cell.cell_type) || 'unknown';
    const source = Array.isArray(cell.source) ? cell.source.map(str).join('') : str(cell.source);
    parts.push(`[Cell ${index + 1}: ${type}]\n${source}`);
    if (type !== 'code' || !Array.isArray(cell.outputs)) return;
    for (const rawOutput of cell.outputs) {
      const output = record(rawOutput);
      let text = '';
      if (Array.isArray(output.text)) text = output.text.map(str).join('');
      else if (typeof output.text === 'string') text = output.text;
      else {
        const data = record(output.data);
        const plain = data['text/plain'];
        text = Array.isArray(plain) ? plain.map(str).join('') : str(plain);
        if (!text && Object.keys(data).some((key) => key.startsWith('image/')))
          text = '[image output omitted]';
      }
      if (str(output.ename)) text = `${str(output.ename)}: ${str(output.evalue)}`;
      if (!text) continue;
      const clipped = text.slice(0, MAX_CELLS_OUTPUT);
      outputChars += clipped.length;
      if (outputChars > 500_000) {
        warnings.push('Notebook outputs were cut after 500,000 characters.');
        return;
      }
      parts.push(`[Output]\n${clipped}`);
    }
  });
  return { text: parts.join('\n\n'), format: 'ipynb', warnings };
}
