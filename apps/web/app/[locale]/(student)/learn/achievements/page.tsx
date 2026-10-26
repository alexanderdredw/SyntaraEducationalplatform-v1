import { HydrationBoundary } from '@tanstack/react-query';
import { setRequestLocale } from 'next-intl/server';
import { achievementsQueryKey } from '@/components/learn/query-keys';
import { StudentAchievements } from '@/components/learn/student-achievements';
import { prefetchState } from '@/lib/api/prefetch';

/** /learn/achievements (8.4.7, U10): «Достижения». */
export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  // OPT-05 (О4-2): достижения — уже в HTML.
  const state = await prefetchState(locale, [
    { key: achievementsQueryKey(locale), path: '/api/student/achievements' },
  ]);
  return (
    <HydrationBoundary state={state}>
      <StudentAchievements />
    </HydrationBoundary>
  );
}
