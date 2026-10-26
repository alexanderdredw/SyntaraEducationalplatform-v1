import { HydrationBoundary } from '@tanstack/react-query';
import { setRequestLocale } from 'next-intl/server';
import { analyticsQueryKey } from '@/components/learn/query-keys';
import { withAttentionDays, type Analytics } from '@/components/teacher/analytics-data';
import { ClassAnalytics } from '@/components/teacher/class-analytics';
import { prefetchState } from '@/lib/api/prefetch';

/** «Аналитика класса» (8.3.7, T10, API-T-25). */
export default async function Page({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  // OPT-05 (О4-2): аналитика — уже в HTML, в той же форме, что после запроса браузера.
  const state = await prefetchState(locale, [
    {
      key: analyticsQueryKey(id, locale),
      path: `/api/teacher/classes/${encodeURIComponent(id)}/analytics`,
      transform: (data: Analytics) => withAttentionDays(data),
    },
  ]);
  return (
    <HydrationBoundary state={state}>
      <ClassAnalytics classId={id} />
    </HydrationBoundary>
  );
}
