import 'server-only';
import { cache } from 'react';
import { cookies } from 'next/headers';
import { type SubjectModule } from '@syntara/shared';
import type { components } from './api/schema';
import { notFound } from 'next/navigation';
import { type DehydratedState } from '@tanstack/react-query';
import { lessonQueryKey } from '@/components/learn/query-keys';
import { type AtlasRoute, parseAtlasPath } from '@/components/subjects/atlas-chemistry/routes';
import { learnGuest, prefetchState } from './api/prefetch';
import { requireLearnVisible } from './require-owned';

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

/**
 * Страница раздела атласа (REQ-ATL-01, docs/ATLAS_MAP.md, раздел 2): предмет не виден → 404 (BR-VIS-01/04); предмет
 * без модуля, неизвестный адрес или элемент → 404. Урок окна (элемента или «Учёных-химиков») — уже в HTML:
 * прямой заход и обновление страницы показывают окно.
 */
export async function atlasScreen(
  locale: string,
  subjectId: string,
  segments: string[],
): Promise<{ route: AtlasRoute; state: DehydratedState | undefined }> {
  const route = parseAtlasPath(segments);
  if (!route) notFound();
  await requireLearnVisible(
    `/api/student/subjects/${encodeURIComponent(subjectId)}`,
    `/api/public/subjects/${encodeURIComponent(subjectId)}`,
  );
  if ((await subjectModule(subjectId, locale)) !== 'atlas-chemistry') notFound();
  const data = await atlasData(subjectId, locale);
  let topicId: string | undefined;
  if (route.screen === 'explore' && route.code) {
    topicId = data?.elements.find((e) => e.code === route.code)?.topicId;
    if (data && !topicId) notFound();
  } else if (route.screen === 'scientists') topicId = data?.scientists?.topicId;
  const guest = await learnGuest();
  const state = topicId
    ? await prefetchState(locale, [
        {
          key: lessonQueryKey(topicId, guest, locale),
          path: `${guest ? '/api/public' : '/api/student'}/topics/${encodeURIComponent(topicId)}`,
        },
      ])
    : undefined;
  return { route, state };
}
