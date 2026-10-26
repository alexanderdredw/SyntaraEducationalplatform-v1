import {
  extensionOf,
  isSpreadsheetContent,
  isSpreadsheetFile,
  MATERIAL_TYPES,
  mayHideSpreadsheet,
  SPREADSHEET_ERROR,
} from '@syntara/shared';
import { apiRequest } from './api/browser';
import type { components } from './api/schema';

type UploadUrl = components['schemas']['UploadUrlResponse'];
type MediaStatus = components['schemas']['MediaStatusDto'];

export type UploadResult = { ok: true; media: MediaStatus } | { ok: false; error: string };

/** MIME из браузера или по расширению (браузеры не всегда знают ODT/CSV). */
function mimeOf(file: File): string {
  if (file.type) return file.type;
  const ext = extensionOf(file.name);
  return ext in MATERIAL_TYPES
    ? MATERIAL_TYPES[ext as keyof typeof MATERIAL_TYPES][0]
    : 'application/octet-stream';
}

/**
 * BR-FILE-09: таблица (по имени, типу или содержимому — xlsx под видом .docx) отклоняется сразу, до загрузки.
 * Это подсказка пользователю; запрет проверяет сервер на каждом этапе.
 */
export async function isSpreadsheetUpload(file: File): Promise<boolean> {
  if (isSpreadsheetFile(file.name, file.type)) return true;
  const head = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  return mayHideSpreadsheet(head) && isSpreadsheetContent(new Uint8Array(await file.arrayBuffer()));
}

const errorKey = (fieldErrors: Record<string, string> | undefined, fallback: string) =>
  (fieldErrors && Object.values(fieldErrors)[0]) || fallback;

/**
 * Загрузка файла (7.8): лимиты проверяет api до выдачи ссылки (API-T-16), файл уходит напрямую в хранилище
 * по подписанной ссылке, затем api повторно проверяет размер и сигнатуру и ставит файл в очередь проверки
 * (API-T-17). Ошибки — ключи `validation.*`.
 */
export async function uploadFile(
  file: File,
  target: { kind: 'cover' } | { kind: 'material'; topicId: string },
  locale: string,
): Promise<UploadResult> {
  if (await isSpreadsheetUpload(file)) return { ok: false, error: SPREADSHEET_ERROR };
  const mime = mimeOf(file);
  const issued = await apiRequest<UploadUrl>('/api/files/upload-url', {
    method: 'POST',
    body: { ...target, fileName: file.name, mime, size: file.size },
    locale,
  });
  if (issued.kind !== 'ok') {
    return {
      ok: false,
      error: issued.kind === 'http' ? errorKey(issued.error.fieldErrors, 'fileType') : 'fileMissing',
    };
  }
  try {
    const put = await fetch(issued.data.uploadUrl, {
      method: 'PUT',
      headers: issued.data.headers,
      body: file,
    });
    if (!put.ok) return { ok: false, error: 'fileMissing' };
  } catch {
    return { ok: false, error: 'fileMissing' };
  }
  const done = await apiRequest<MediaStatus>(`/api/files/${issued.data.mediaId}/complete`, {
    method: 'POST',
    locale,
  });
  if (done.kind !== 'ok') {
    return {
      ok: false,
      error: done.kind === 'http' ? errorKey(done.error.fieldErrors, 'fileSignature') : 'fileMissing',
    };
  }
  return { ok: true, media: done.data };
}
