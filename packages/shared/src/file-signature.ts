import { COVER_MIME, MATERIAL_TYPES, type MaterialExtension } from './content';

/**
 * Сигнатуры файлов (BR-FILE-01, BR-FILE-02): содержимое должно соответствовать заявленному типу —
 * расширение и MIME из запроса не доверяются. `head` — первые байты файла (достаточно 8 КБ).
 */
const startsWith = (head: Uint8Array, bytes: number[], offset = 0) =>
  head.length >= offset + bytes.length && bytes.every((b, i) => head[offset + i] === b);
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));

const ZIP = [0x50, 0x4b, 0x03, 0x04];

/** Текст: без NUL-байтов и управляющих символов, кроме табуляции и переводов строк (TXT, CSV). */
function looksLikeText(head: Uint8Array): boolean {
  for (const b of head) {
    if (b === 0) return false;
    if (b < 0x09 || (b > 0x0d && b < 0x20)) return false;
  }
  return true;
}

export function materialSignatureOk(ext: MaterialExtension, head: Uint8Array): boolean {
  switch (ext) {
    case 'pdf':
      return startsWith(head, ascii('%PDF-'));
    // OOXML и ODF — ZIP-контейнеры.
    case 'docx':
    case 'xlsx':
    case 'pptx':
    case 'odt':
      return startsWith(head, ZIP);
    case 'txt':
    case 'csv':
      return looksLikeText(head);
  }
}

export function coverSignatureOk(mime: (typeof COVER_MIME)[number], head: Uint8Array): boolean {
  switch (mime) {
    case 'image/jpeg':
      return startsWith(head, [0xff, 0xd8, 0xff]);
    case 'image/png':
      return startsWith(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case 'image/gif':
      return startsWith(head, ascii('GIF87a')) || startsWith(head, ascii('GIF89a'));
    case 'image/webp':
      return startsWith(head, ascii('RIFF')) && startsWith(head, ascii('WEBP'), 8);
  }
}

export const isMaterialExtension = (ext: string): ext is MaterialExtension => ext in MATERIAL_TYPES;
export const isCoverMime = (mime: string): mime is (typeof COVER_MIME)[number] =>
  (COVER_MIME as readonly string[]).includes(mime);

/** Офисные форматы, которые проверяет olevba (BR-FILE-03). */
export const OFFICE_EXTENSIONS: readonly MaterialExtension[] = ['docx', 'xlsx', 'pptx', 'odt'];
