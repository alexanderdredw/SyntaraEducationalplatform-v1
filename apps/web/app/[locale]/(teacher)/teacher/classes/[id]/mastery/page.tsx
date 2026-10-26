import { HydrationBoundary } from '@tanstack/react-query';
import { setRequestLocale } from 'next-intl/server';
import { masteryQueryKey } from '@/components/learn/query-keys';
import { ClassMastery } from '@/components/teacher/class-mastery';
import { prefetchState } from '@/lib/api/prefetch';

/** «Карта освоения» (REQ-TCH-AN-01, API-T-29): ученики × темы выбранного предмета. */
export default async function Page({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  // OPT-05 (О4-2): карта предмета по умолчанию (без выбора) — уже в HTML.
  const state = await prefetchState(locale, [
    {
      key: masteryQueryKey(id, null, locale),
      path: `/api/teacher/classes/${encodeURIComponent(id)}/mastery`,
    },
  ]);
  return (
    <HydrationBoundary state={state}>
      <ClassMastery classId={id} />
    </HydrationBoundary>
  );
}
