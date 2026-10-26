import { describe, expect, it } from 'vitest';
import {
  isSpreadsheetContent,
  isSpreadsheetFile,
  mayHideSpreadsheet,
  SPREADSHEET_EXTENSIONS,
  zipEntryNames,
} from './spreadsheet';
import { MATERIAL_TYPES } from './content';

/** Минимальный ZIP (метод stored, CRC не проверяется разбором). */
function zip(entries: Record<string, string>): Uint8Array {
  const enc = new TextEncoder();
  const parts: number[] = [];
  const central: number[] = [];
  const u16 = (a: number[], v: number) => a.push(v & 0xff, (v >> 8) & 0xff);
  const u32 = (a: number[], v: number) =>
    a.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff);
  for (const [name, content] of Object.entries(entries)) {
    const n = [...enc.encode(name)];
    const d = [...enc.encode(content)];
    const offset = parts.length;
    u32(parts, 0x04034b50);
    u16(parts, 20);
    u16(parts, 0);
    u16(parts, 0);
    u32(parts, 0);
    u32(parts, 0);
    u32(parts, d.length);
    u32(parts, d.length);
    u16(parts, n.length);
    u16(parts, 0);
    parts.push(...n, ...d);
    u32(central, 0x02014b50);
    u16(central, 20);
    u16(central, 20);
    u16(central, 0);
    u16(central, 0);
    u32(central, 0);
    u32(central, 0);
    u32(central, d.length);
    u32(central, d.length);
    u16(central, n.length);
    u16(central, 0);
    u16(central, 0);
    u16(central, 0);
    u16(central, 0);
    u32(central, 0);
    u32(central, offset);
    central.push(...n);
  }
  const count = Object.keys(entries).length;
  const end: number[] = [];
  u32(end, 0x06054b50);
  u16(end, 0);
  u16(end, 0);
  u16(end, count);
  u16(end, count);
  u32(end, central.length);
  u32(end, parts.length);
  u16(end, 0);
  return new Uint8Array([...parts, ...central, ...end]);
}

/** Составной файл (CFB) с одним потоком в каталоге: Workbook — книга Excel, WordDocument — старый Word. */
function cfb(stream: string): Uint8Array {
  const data = new Uint8Array(1024);
  data.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  const entry = (at: number, name: string, type: number) => {
    for (let i = 0; i < name.length; i++) data[at + i * 2] = name.charCodeAt(i);
    data[at + 64] = (name.length + 1) * 2;
    data[at + 66] = type;
  };
  entry(512, 'Root Entry', 5);
  entry(640, stream, 2);
  return data;
}

const XLSX = zip({ '[Content_Types].xml': '<Types/>', 'xl/workbook.xml': '<workbook/>' });
const DOCX = zip({ '[Content_Types].xml': '<Types/>', 'word/document.xml': '<w:document/>' });

describe('BR-FILE-09 spreadsheets are not uploaded', () => {
  it('BR-FILE-09 by extension and MIME: xlsx, xls, xlsm, xlsb, csv, ods', () => {
    for (const ext of SPREADSHEET_EXTENSIONS)
      expect(isSpreadsheetFile(`Таблица.${ext.toUpperCase()}`)).toBe(true);
    expect(isSpreadsheetFile('notes.txt', 'text/csv; charset=utf-8')).toBe(true);
    expect(isSpreadsheetFile('cover.png', 'application/vnd.ms-excel')).toBe(true);
    expect(isSpreadsheetFile('Конспект.pdf', 'application/pdf')).toBe(false);
    expect(isSpreadsheetFile('notes.txt', 'text/plain')).toBe(false);
  });

  it('BR-FILE-02 lesson materials are PDF, DOCX, PPTX, ODT and TXT only', () => {
    expect(Object.keys(MATERIAL_TYPES).sort()).toEqual(['docx', 'odt', 'pdf', 'pptx', 'txt']);
  });

  it('BR-FILE-09 by content: xlsx renamed to .docx, ODF spreadsheet, Excel 97 workbook', () => {
    expect(zipEntryNames(XLSX)).toContain('xl/workbook.xml');
    expect(isSpreadsheetContent(XLSX)).toBe(true);
    expect(isSpreadsheetContent(zip({ 'xl/workbook.bin': '' }))).toBe(true);
    expect(
      isSpreadsheetContent(
        zip({ mimetype: 'application/vnd.oasis.opendocument.spreadsheet', 'content.xml': '' }),
      ),
    ).toBe(true);
    expect(isSpreadsheetContent(cfb('Workbook'))).toBe(true);
    expect(isSpreadsheetContent(cfb('Book'))).toBe(true);
  });

  it('BR-FILE-09 documents are not spreadsheets', () => {
    expect(isSpreadsheetContent(DOCX)).toBe(false);
    expect(
      isSpreadsheetContent(zip({ mimetype: 'application/vnd.oasis.opendocument.text', 'content.xml': '' })),
    ).toBe(false);
    expect(isSpreadsheetContent(cfb('WordDocument'))).toBe(false);
    expect(isSpreadsheetContent(new TextEncoder().encode('%PDF-1.4'))).toBe(false);
    expect(isSpreadsheetContent(new TextEncoder().encode('a;b\n1;2'))).toBe(false);
    expect(mayHideSpreadsheet(DOCX)).toBe(true);
    expect(mayHideSpreadsheet(new TextEncoder().encode('%PDF-1.4'))).toBe(false);
  });
});
