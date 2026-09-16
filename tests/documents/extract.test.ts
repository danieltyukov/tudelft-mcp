import { zipSync, strToU8 } from 'fflate';
import { describe, expect, it } from 'vitest';
import { extractDocument, isExtractable } from '../../src/documents/extract.js';
import { extractDelimited, extractNotebook } from '../../src/documents/tabular.js';
import { safeFilename } from '../../src/documents/download.js';

function pptx(): Buffer {
  const files: Record<string, Uint8Array> = {
    'ppt/presentation.xml': strToU8(
      '<p:presentation xmlns:p="p" xmlns:r="r"><p:sldIdLst><p:sldId id="256" r:id="rId2"/><p:sldId id="257" r:id="rId1"/></p:sldIdLst></p:presentation>',
    ),
    'ppt/_rels/presentation.xml.rels': strToU8(
      '<Relationships><Relationship Id="rId1" Target="slides/slide1.xml"/><Relationship Id="rId2" Target="slides/slide2.xml"/></Relationships>',
    ),
    'ppt/slides/slide1.xml': strToU8(
      '<p:sld xmlns:a="a" xmlns:p="p"><p:txBody><a:p><a:r><a:t>First slide</a:t></a:r></a:p></p:txBody></p:sld>',
    ),
    'ppt/slides/slide2.xml': strToU8(
      '<p:sld xmlns:a="a" xmlns:p="p"><p:txBody><a:p><a:r><a:t>Second </a:t></a:r><a:r><a:t>slide</a:t></a:r></a:p></p:txBody></p:sld>',
    ),
    'ppt/slides/_rels/slide2.xml.rels': strToU8(
      '<Relationships><Relationship Id="rId9" Target="../notesSlides/notesSlide2.xml"/></Relationships>',
    ),
    'ppt/notesSlides/notesSlide2.xml': strToU8(
      '<p:notes xmlns:a="a" xmlns:p="p"><p:txBody><a:p><a:r><a:t>Remember the derivation</a:t></a:r></a:p></p:txBody></p:notes>',
    ),
  };
  return Buffer.from(zipSync(files));
}

function xlsx(): Buffer {
  const files: Record<string, Uint8Array> = {
    'xl/workbook.xml': strToU8(
      '<workbook xmlns:r="r"><sheets><sheet name="Data" sheetId="1" r:id="rId1"/></sheets></workbook>',
    ),
    'xl/_rels/workbook.xml.rels': strToU8(
      '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="sharedStrings.xml"/></Relationships>',
    ),
    'xl/sharedStrings.xml': strToU8('<sst><si><t>Name</t></si><si><t>Score</t></si></sst>'),
    'xl/worksheets/sheet1.xml': strToU8(
      '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>Ann</t></is></c><c r="B2"><v>8.5</v></c></row></sheetData></worksheet>',
    ),
  };
  return Buffer.from(zipSync(files));
}

describe('extractDocument', () => {
  it('reads slides in presentation order with speaker notes', async () => {
    const result = await extractDocument(pptx(), 'deck.pptx');
    expect(result.format).toBe('pptx');
    expect(result.pages).toBe(2);
    expect(result.text.indexOf('Second slide')).toBeLessThan(result.text.indexOf('First slide'));
    expect(result.text).toContain('[Speaker notes]\nRemember the derivation');
  });
  it('reads spreadsheet cells with shared strings', async () => {
    const result = await extractDocument(xlsx(), 'grades.xlsx');
    expect(result.text).toContain('[Sheet Data]');
    expect(result.text).toContain('A1=Name | B1=Score');
    expect(result.text).toContain('A2=Ann | B2=8.5');
  });
  it('handles text, html and unknown binaries', async () => {
    expect((await extractDocument(Buffer.from('hello'), 'a.txt')).text).toBe('hello');
    expect((await extractDocument(Buffer.from('<h1>T</h1><p>body</p>'), 'a.html')).text).toBe('T\nbody');
    const bin = await extractDocument(Buffer.from([0, 1, 2]), 'a.zip');
    expect(bin.text).toBe('');
    expect(bin.warnings[0]).toMatch(/not available/);
  });
  it('recognises extractable extensions', () => {
    expect(isExtractable('x.pdf')).toBe(true);
    expect(isExtractable('x.PPTX')).toBe(true);
    expect(isExtractable('x.zip')).toBe(false);
  });
});

describe('tabular', () => {
  it('parses quoted csv', () => {
    expect(extractDelimited('a,"b,c",d\n1,2,3', 'csv').text).toBe('a | b,c | d\n1 | 2 | 3');
  });
  it('reads notebook cells and outputs', () => {
    const nb = JSON.stringify({
      cells: [
        { cell_type: 'markdown', source: ['# Title'] },
        {
          cell_type: 'code',
          source: 'print(1)',
          outputs: [{ text: ['1\n'] }, { data: { 'image/png': 'xx' } }],
        },
      ],
    });
    const result = extractNotebook(nb);
    expect(result.text).toContain('[Cell 1: markdown]\n# Title');
    expect(result.text).toContain('[Output]\n1');
    expect(result.text).toContain('[image output omitted]');
  });
});

describe('safeFilename', () => {
  it('strips paths and reserved names', () => {
    expect(safeFilename('../../etc/passwd')).toBe('passwd');
    expect(safeFilename('a:b?c.pdf')).toBe('a_b_c.pdf');
    expect(safeFilename('CON')).toBe('file');
    expect(safeFilename('')).toBe('file');
  });
});

function minimalPdf(text: string): Buffer {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${`BT /F1 18 Tf 20 100 Td (${text}) Tj ET`.length} >>\nstream\nBT /F1 18 Tf 20 100 Td (${text}) Tj ET\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let body = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, 'latin1');
}

describe('pdf worker', () => {
  it('extracts text from a real PDF through the worker thread', async () => {
    const result = await extractDocument(minimalPdf('Hello PDF world'), 'hello.pdf', 'application/pdf');
    expect(result.format).toBe('pdf');
    expect(result.pages).toBe(1);
    expect(result.text).toContain('[Page 1]');
    expect(result.text).toContain('Hello PDF world');
  });
  it('reports damaged PDFs cleanly', async () => {
    await expect(extractDocument(Buffer.from('%PDF-1.4 garbage'), 'x.pdf')).rejects.toMatchObject({
      code: 'DOCUMENT_PARSE_FAILED',
    });
  });
});
