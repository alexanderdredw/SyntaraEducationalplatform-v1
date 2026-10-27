import { HydrationBoundary } from '@tanstack/react-query';
import { permanentRedirect } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import { LessonPage } from '@/components/learn/lesson-page';
import { lessonQueryKey } from '@/components/learn/query-keys';
import type { Lesson } from '@/components/lesson/lesson-view';
import { lessonMarkdown } from '@/components/markdown/lesson-markdown';
import { atlasHref, elementHref } from '@/components/subjects/atlas-chemistry/routes';
import { learnGuest, prefetchState } from '@/lib/api/prefetch';
import { atlasData, subjectModule } from '@/lib/atlas';
import { requireLearnVisible } from '@/lib/require-owned';

/**
 * REQ-ATL-01.2: урок предмета с модулем атласа — постоянное перенаправление (308) на экран атласа: тема-элемент →
 * окно элемента (?tab=quiz → тест, ?tab=ai → Syntara AI), «Учёные-химики» → «Учёные». Задание учителя
 * (?assignment=) сохраняется — так задание открывает атлас и засчитывается.
 */
async function atlasRedirect(
  locale: string,
  topicId: string,
  subjectId: string,
  search: { tab?: string; assignment?: string },
): Promise<void> {
  if ((await subjectModule(subjectId, locale)) !== 'atlas-chemistry') return;
  const data = await atlasData(subjectId, locale);
  if (!data) return;
  const element = data.elements.find((e) => e.topicId === topicId);
  const scientists = data.scientists?.topicId === topicId;
  if (!element && !scientists) return;
  const assignment = search.assignment ? `?assignment=${encodeURIComponent(search.assignment)}` : '';
  let target: string;
  if (search.tab === 'ai')
    target = `${atlasHref(subjectId, 'syntara')}${element ? `?element=${element.code}` : ''}`;
  else if (search.tab === 'quiz')
    target = `${element ? elementHref(subjectId, element.code, true) : atlasHref(subjectId, 'scientists', '/test')}${assignment}`;
  else target = element ? elementHref(subjectId, element.code) : atlasHref(subjectId, 'scientists');
  permanentRedirect(`/${locale}${target}`);
}

/** /learn/topics/:id?tab=overview|quiz|ai (8.4.3–8.4.4). Тема не видна ученику (BR-VIS-01) → 404. */
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ tab?: string; assignment?: string }>;
}) {
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
  if (lesson) await atlasRedirect(locale, id, lesson.subject.id, await searchParams);
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
