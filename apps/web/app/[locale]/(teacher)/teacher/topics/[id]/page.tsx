import { setRequestLocale } from 'next-intl/server';
import { TopicEditor } from '@/components/teacher/topic-editor';
import { requireOwned } from '@/lib/teacher-page';

/** /teacher/topics/:id: редактор и публикация темы (8.3.3–8.3.4, T06–T07); только владелец. */
export default async function Page({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  await requireOwned(`/api/teacher/topics/${encodeURIComponent(id)}`);
  return <TopicEditor id={id} timeZone={process.env.PLATFORM_TZ ?? 'Asia/Almaty'} />;
}
