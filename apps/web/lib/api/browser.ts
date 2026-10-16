import { type ApiErrorBody } from '@syntara/shared';

/** Cookie `csrf` (double-submit, API-GEN-02) — читается клиентом и уходит в заголовке X-CSRF-Token. */
export function csrfToken(): string | undefined {
  if (typeof document === 'undefined') return undefined;
  const match = /(?:^|;\s*)csrf=([^;]+)/.exec(document.cookie);
  return match ? decodeURIComponent(match[1]!) : undefined;
}

export type ApiResult<T> =
  | { kind: 'ok'; status: number; data: T }
  | { kind: 'http'; status: number; error: ApiErrorBody }
  | { kind: 'network' }
  | { kind: 'timeout' };

export interface ApiRequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  headers?: Record<string, string>;
  locale?: string;
  /** REQ-NFR-PERF-03: клиентский таймаут форм — 15 с. */
  timeoutMs?: number;
}

/**
 * Запрос браузера к api того же origin. Различает ответ сервера, обрыв сети и таймаут —
 * это разные состояния SM-FORM (8.1.9). Для изменяющих запросов добавляет X-CSRF-Token.
 */
export async function apiRequest<T>(path: string, options: ApiRequestOptions = {}): Promise<ApiResult<T>> {
  const { method = 'GET', body, headers = {}, locale, timeoutMs = 15_000 } = options;
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const csrf = method === 'GET' ? undefined : csrfToken();
  try {
    const res = await fetch(path, {
      method,
      credentials: 'same-origin',
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(locale ? { 'Accept-Language': locale } : {}),
        ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    const json = text ? (JSON.parse(text) as unknown) : undefined;
    if (res.ok) return { kind: 'ok', status: res.status, data: json as T };
    return { kind: 'http', status: res.status, error: json as ApiErrorBody };
  } catch {
    return timedOut ? { kind: 'timeout' } : { kind: 'network' };
  } finally {
    clearTimeout(timer);
  }
}
