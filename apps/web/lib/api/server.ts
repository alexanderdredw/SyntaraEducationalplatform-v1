import 'server-only';
import { type Locale } from '@syntara/shared';
import { createApiClient } from './client';
import type { components } from './schema';

export type PublicSubject = components['schemas']['PublicSubjectDto'];
export type PublicConfig = components['schemas']['PublicConfigDto'];

const API_URL = process.env.API_INTERNAL_URL ?? 'http://localhost:3001';
const TIMEOUT_MS = 5000;

/**
 * Запросы SSR к api (API_INTERNAL_URL). При недоступности api страница всё равно отрисуется:
 * данные заменяются пустыми значениями, ошибка пишется в журнал сервера.
 */
async function safely<T>(label: string, fallback: T, run: () => Promise<{ data?: T }>): Promise<T> {
  try {
    const { data } = await run();
    return data ?? fallback;
  } catch (err) {
    console.error(`[web] ${label} failed: ${(err as Error).message}`);
    return fallback;
  }
}

const api = () => createApiClient(API_URL);
const signal = () => AbortSignal.timeout(TIMEOUT_MS);

/** API-PUB-01 */
export function getPublicSubjects(locale: Locale): Promise<PublicSubject[]> {
  return safely('GET /api/public/subjects', [], () =>
    api().GET('/api/public/subjects', {
      headers: { 'Accept-Language': locale },
      signal: signal(),
      cache: 'no-store',
    }),
  );
}

/** API-PUB-07 */
export function getPublicConfig(): Promise<PublicConfig | null> {
  return safely<PublicConfig | null>('GET /api/public/config', null, () =>
    api().GET('/api/public/config', { signal: signal(), cache: 'no-store' }),
  );
}
