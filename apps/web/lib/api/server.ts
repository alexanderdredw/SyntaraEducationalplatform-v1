import 'server-only';
import { cache } from 'react';
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

export type Me = components['schemas']['MeDto'];

/**
 * API-ME-01 для SSR: пользователь по cookie запроса или null (нет сессии, api недоступен).
 * Права проверяет api (AG-04); здесь — только выбор, что отрисовать.
 */
export const getMe = cache(async (cookieHeader: string): Promise<Me | null> => {
  if (!cookieHeader.includes('sid=')) return null;
  return safely<Me | null>('GET /api/me', null, () =>
    api().GET('/api/me', { headers: { cookie: cookieHeader }, signal: signal(), cache: 'no-store' }),
  );
});

export type MeStats = components['schemas']['MeStatsDto'];

/** API-S-16 для хедера ученика; при ошибке — нули. */
export async function getMeStats(cookieHeader: string): Promise<MeStats> {
  return safely<MeStats>('GET /api/me/stats', { streakDays: 0, xpTotal: 0 }, () =>
    api().GET('/api/me/stats', { headers: { cookie: cookieHeader }, signal: signal(), cache: 'no-store' }),
  );
}
