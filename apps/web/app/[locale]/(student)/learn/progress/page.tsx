import { HydrationBoundary } from '@tanstack/react-query';
import { setRequestLocale } from 'next-intl/server';
import { progressQueryKey } from '@/components/learn/query-keys';
import { StudentProgress } from '@/components/learn/student-progress';
import { prefetchState } from '@/lib/api/prefetch';

/** /learn/progress (8.4.6, U08): «Мои показатели». */
export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  // OPT-05 (О4-2): показатели за период по умолчанию (30 дней) — уже в HTML.
  const state = await prefetchState(locale, [
    { key: progressQueryKey('30d', locale), path: '/api/student/progress?period=30d' },
  ]);
  return (
    <HydrationBoundary state={state}>
      <StudentProgress timeZone={process.env.PLATFORM_TZ ?? 'Asia/Almaty'} />
    </HydrationBoundary>
  );
}
