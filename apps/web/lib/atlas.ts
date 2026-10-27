import 'server-only';
import { cache } from 'react';
import { cookies } from 'next/headers';
import { type SubjectModule } from '@syntara/shared';
import type { components } from './api/schema';
import { learnGuest } from './api/prefetch';

const API_URL = process.env.API_INTERNAL_URL ?? 'http://localhost:3001';

type AtlasData = components['schemas']['AtlasDto'];

async function getJson<T>(path: string, locale: string): Promise<T | null> {
  try {
    const res = await fetch(`${API_URL}${path}`, {
      headers: {
        cookie: (await cookies()).toString(),
        Accept: 'application/json',
        'Accept-Language': locale,
      },
      signal: AbortSignal.timeout(5000),
      cache: 'no-store',
    });
    return res.ok ? ((await res.json()) as T) : null;
  } catch (err) {
    console.error(`[web] GET ${path} failed: ${(err as Error).message}`);
    return null;
  }
}

/**
 * Модуль базового предмета (REQ-ATL-01): у «Химии» — atlas-chemistry; null — стандартная страница предмета или
 * предмет не виден (404 решает requireLearnVisible). Один запрос на запрос страницы (layout и page).
 */
export const subjectModule = cache(
  async (subjectId: string, locale: string): Promise<SubjectModule | null> => {
    const guest = await learnGuest();
    const subject = await getJson<{ module?: SubjectModule }>(
      `/api/${guest ? 'public' : 'student'}/subjects/${encodeURIComponent(subjectId)}`,
      locale,
    );
    return subject?.module ?? null;
  },
);

/** Данные атласа для перенаправлений и предзагрузки (API-S-23 / API-PUB-15). */
export const atlasData = cache(async (subjectId: string, locale: string): Promise<AtlasData | null> => {
  const guest = await learnGuest();
  return getJson<AtlasData>(
    `/api/${guest ? 'public' : 'student'}/subjects/${encodeURIComponent(subjectId)}/atlas`,
    locale,
  );
});
