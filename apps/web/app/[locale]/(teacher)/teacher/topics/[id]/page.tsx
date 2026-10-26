import { HydrationBoundary } from '@tanstack/react-query';
import { setRequestLocale } from 'next-intl/server';
import { teacherTopicQueryKey } from '@/components/learn/query-keys';
import { TopicEditor } from '@/components/teacher/topic-editor';
import { prefetchState } from '@/lib/api/prefetch';
import { requireOwned } from '@/lib/require-owned';

/** /teacher/topics/:id: редактор и публикация темы (8.3.3–8.3.4, T06–T07); только владелец. */
export default async function Page({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const path = `/api/teacher/topics/${encodeURIComponent(id)}`;
  // OPT-05 (О4-2): тема — уже в HTML (параллельно с проверкой владения), форма заполняется без второго запроса.
  const [, state] = await Promise.all([
    requireOwned(path),
    prefetchState(locale, [{ key: teacherTopicQueryKey(id), path }]),
  ]);
  return (
    <HydrationBoundary state={state}>
      <TopicEditor id={id} timeZone={process.env.PLATFORM_TZ ?? 'Asia/Almaty'} />
    </HydrationBoundary>
  );
}
