import { HydrationBoundary } from '@tanstack/react-query';
import { setRequestLocale } from 'next-intl/server';
import { LessonPage } from '@/components/learn/lesson-page';
import { lessonQueryKey } from '@/components/learn/query-keys';
import type { Lesson } from '@/components/lesson/lesson-view';
import { lessonMarkdown } from '@/components/markdown/lesson-markdown';
import { learnGuest, prefetchState } from '@/lib/api/prefetch';
import { requireLearnVisible } from '@/lib/require-owned';

/** /learn/topics/:id?tab=overview|quiz|ai (8.4.3–8.4.4). Тема не видна ученику (BR-VIS-01) → 404. */
export default async function Page({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const topic = encodeURIComponent(id);
  await requireLearnVisible(`/api/student/topics/${topic}`, `/api/public/topics/${topic}`);
  // OPT-05 (О4-2, О4-4): урок и его Markdown — уже в HTML; браузер не ждёт JS и запрос, футер не сдвигается.
  const guest = await learnGuest();
  const key = lessonQueryKey(id, guest, locale);
  const state = await prefetchState(locale, [
    { key, path: `${guest ? '/api/public' : '/api/student'}/topics/${topic}` },
  ]);
  const lesson = state.queries[0]?.state.data as Lesson | undefined;
  return (
    <HydrationBoundary state={state}>
      <LessonPage
        topicId={id}
        timeZone={process.env.PLATFORM_TZ ?? 'Asia/Almaty'}
        markdown={lesson ? lessonMarkdown(lesson) : undefined}
      />
    </HydrationBoundary>
  );
}
