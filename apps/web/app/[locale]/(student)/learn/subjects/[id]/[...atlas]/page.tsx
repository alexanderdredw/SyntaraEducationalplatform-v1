import { HydrationBoundary } from '@tanstack/react-query';
import { notFound } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import { lessonQueryKey } from '@/components/learn/query-keys';
import { AtlasView } from '@/components/subjects/atlas-chemistry/atlas-view';
import { parseAtlasPath } from '@/components/subjects/atlas-chemistry/routes';
import { learnGuest, prefetchState } from '@/lib/api/prefetch';
import { atlasData, subjectModule } from '@/lib/atlas';
import { requireLearnVisible } from '@/lib/require-owned';

/**
 * Разделы и окна «Mendeleev Atlas» (REQ-ATL-01, docs/ATLAS_MAP.md, раздел 2): /explore[/:code[/test]],
 * /scientists[/:code | /test], /quiz, /search, /ai. Предмет не виден → 404 (BR-VIS-01/04); предмет без модуля,
 * неизвестный адрес или элемент → 404. Урок окна — уже в HTML (обновление страницы показывает окно).
 */
export default async function Page({
  params,
}: {
  params: Promise<{ locale: string; id: string; atlas: string[] }>;
}) {
  const { locale, id, atlas } = await params;
  setRequestLocale(locale);
  const route = parseAtlasPath(atlas);
  if (!route) notFound();
  await requireLearnVisible(
    `/api/student/subjects/${encodeURIComponent(id)}`,
    `/api/public/subjects/${encodeURIComponent(id)}`,
  );
  if ((await subjectModule(id, locale)) !== 'atlas-chemistry') notFound();
  const data = await atlasData(id, locale);
  let topicId: string | undefined;
  if (route.screen === 'explore' && route.code) {
    topicId = data?.elements.find((e) => e.code === route.code)?.topicId;
    if (data && !topicId) notFound();
  } else if (route.screen === 'scientists') {
    topicId = data?.scientists?.topicId;
  }
  const guest = await learnGuest();
  const state = topicId
    ? await prefetchState(locale, [
        {
          key: lessonQueryKey(topicId, guest, locale),
          path: `${guest ? '/api/public' : '/api/student'}/topics/${encodeURIComponent(topicId)}`,
        },
      ])
    : undefined;
  return (
    <HydrationBoundary state={state}>
      <AtlasView route={route} />
    </HydrationBoundary>
  );
}
