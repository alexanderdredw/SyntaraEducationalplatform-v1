import { setRequestLocale } from 'next-intl/server';
import { LessonPage } from '@/components/learn/lesson-page';
import { requireOwned } from '@/lib/require-owned';

/** /learn/topics/:id?tab=overview|quiz|ai (8.4.3–8.4.4). Тема не видна ученику (BR-VIS-01) → 404. */
export default async function Page({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  await requireOwned(`/api/student/topics/${encodeURIComponent(id)}`);
  return <LessonPage topicId={id} timeZone={process.env.PLATFORM_TZ ?? 'Asia/Almaty'} />;
}
