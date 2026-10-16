/**
 * CSP с nonce на каждый запрос (REQ-NFR-SEC-01); Next проставляет nonce своим скриптам.
 * `storageOrigin` — S3 для загрузки по подписанной ссылке и показа файлов (7.8). Картинки по https —
 * внешние обложки тем (REQ-TCH-TOP-04, «Ссылка на изображение»).
 */
export function buildCsp(nonce: string, dev: boolean, storageOrigin?: string): string {
  const storage = storageOrigin ? ` ${storageOrigin}` : '';
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: https:${storage}`,
    "font-src 'self' data:",
    `connect-src 'self'${storage}${dev ? ' ws: wss:' : ''}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}

/** Origin хранилища из S3_PUBLIC_ENDPOINT или S3_ENDPOINT; некорректный адрес — без источника. */
export function storageOrigin(env: {
  S3_PUBLIC_ENDPOINT?: string;
  S3_ENDPOINT?: string;
}): string | undefined {
  const raw = env.S3_PUBLIC_ENDPOINT || env.S3_ENDPOINT;
  if (!raw) return undefined;
  try {
    return new URL(raw).origin;
  } catch {
    return undefined;
  }
}
