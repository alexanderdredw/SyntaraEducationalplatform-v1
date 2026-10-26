import { extensionOf } from './content';

/**
 * BR-FILE-09 (решение владельца 2026-10-26): табличные файлы на сайт не загружаются — ни материалами урока, ни
 * картинками, ни через content/. Таблицы часто используют для распространения вредоносного кода (макросы, инъекция
 * формул в CSV), а для учебных материалов достаточно PDF и документов. Проверка — по расширению, по MIME и по
 * содержимому: таблица под чужим расширением (xlsx как .docx) тоже отклоняется.
 */
export const SPREADSHEET_EXTENSIONS = ['xlsx', 'xls', 'xlsm', 'xlsb', 'csv', 'ods'] as const;

/** MIME табличных форматов (с параметрами и без учёта регистра). */
export const SPREADSHEET_MIME = [
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'application/vnd.ms-excel.sheet.macroenabled.12',
  'application/vnd.ms-excel.sheet.binary.macroenabled.12',
  'application/vnd.oasis.opendocument.spreadsheet',
  'text/csv',
  'text/x-csv',
  'text/comma-separated-values',
  'application/csv',
  'application/x-csv',
] as const;

/** Ключ ошибки (422, `validation.fileTypeNotAllowed`). */
export const SPREADSHEET_ERROR = 'fileTypeNotAllowed';

export const isSpreadsheetName = (fileName: string): boolean =>
  (SPREADSHEET_EXTENSIONS as readonly string[]).includes(extensionOf(fileName));

export const isSpreadsheetMime = (mime: string | null | undefined): boolean =>
  (SPREADSHEET_MIME as readonly string[]).includes((mime ?? '').split(';')[0]!.trim().toLowerCase());

/** По имени и заявленному MIME — до загрузки и для уже загруженных файлов. */
export const isSpreadsheetFile = (fileName: string, mime?: string | null): boolean =>
  isSpreadsheetName(fileName) || isSpreadsheetMime(mime);

const ZIP = [0x50, 0x4b, 0x03, 0x04];
const CFB = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const startsWith = (data: Uint8Array, bytes: number[]) =>
  data.length >= bytes.length && bytes.every((b, i) => data[i] === b);

/** Контейнер, в котором может быть таблица (ZIP — OOXML/ODF, CFB — старый Excel): нужен весь файл. */
export const mayHideSpreadsheet = (head: Uint8Array): boolean =>
  startsWith(head, ZIP) || startsWith(head, CFB);

interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  localOffset: number;
}

const view = (data: Uint8Array) => new DataView(data.buffer, data.byteOffset, data.byteLength);
const decoder = new TextDecoder();

/** Записи ZIP из центрального каталога (без распаковки); не ZIP — пустой список. */
export function zipEntries(data: Uint8Array): ZipEntry[] {
  if (data.length < 22) return [];
  const dv = view(data);
  // Конец центрального каталога (EOCD): сигнатура 0x06054b50, комментарий архива — до 65 535 байт.
  const min = Math.max(0, data.length - 22 - 65_535);
  let eocd = -1;
  for (let i = data.length - 22; i >= min; i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return [];
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const entries: ZipEntry[] = [];
  for (let n = 0; n < count && p + 46 <= data.length && dv.getUint32(p, true) === 0x02014b50; n++) {
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    entries.push({
      name: decoder.decode(data.subarray(p + 46, p + 46 + nameLen)),
      method: dv.getUint16(p + 10, true),
      compressedSize: dv.getUint32(p + 20, true),
      localOffset: dv.getUint32(p + 42, true),
    });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

export const zipEntryNames = (data: Uint8Array): string[] => zipEntries(data).map((e) => e.name);

/** Тип документа ODF — запись `mimetype`, по стандарту хранится без сжатия. */
function odfMimetype(data: Uint8Array, entries: ZipEntry[]): string | null {
  const entry = entries.find((e) => e.name === 'mimetype');
  if (!entry || entry.method !== 0 || entry.compressedSize > 200) return null;
  const p = entry.localOffset;
  if (p + 30 > data.length || view(data).getUint32(p, true) !== 0x04034b50) return null;
  const start = p + 30 + view(data).getUint16(p + 26, true) + view(data).getUint16(p + 28, true);
  return decoder.decode(data.subarray(start, start + entry.compressedSize)).trim();
}

/**
 * Книга Excel в составном файле (CFB, .xls): поток `Workbook` (BIFF8) или `Book` (BIFF5) в каталоге. Записи каталога
 * по 128 байт выровнены по 128 байт: имя UTF-16LE, длина имени с нулём (+64), тип 2 — поток (+66).
 */
function cfbHasWorkbook(data: Uint8Array): boolean {
  const dv = view(data);
  const names = ['Workbook', 'Book'];
  for (let p = 512; p + 128 <= data.length; p += 128) {
    if (data[p + 66] !== 2) continue;
    const nameLen = dv.getUint16(p + 64, true);
    for (const name of names) {
      if (nameLen !== (name.length + 1) * 2) continue;
      let match = true;
      for (let i = 0; i < name.length && match; i++)
        match = dv.getUint16(p + i * 2, true) === name.charCodeAt(i);
      if (match) return true;
    }
  }
  return false;
}

/**
 * Таблица по содержимому (весь файл): OOXML-книга (части `xl/` — xlsx, xlsm, xlsb), ODF-таблица (`mimetype`
 * application/vnd.oasis.opendocument.spreadsheet), книга Excel в CFB (xls). CSV по содержимому надёжно не
 * отличить от обычного текста — он отклоняется по расширению и MIME.
 */
export function isSpreadsheetContent(data: Uint8Array): boolean {
  if (startsWith(data, ZIP)) {
    const entries = zipEntries(data);
    if (entries.some((e) => e.name.toLowerCase().startsWith('xl/'))) return true;
    return odfMimetype(data, entries)?.startsWith('application/vnd.oasis.opendocument.spreadsheet') ?? false;
  }
  if (startsWith(data, CFB)) return cfbHasWorkbook(data);
  return false;
}
