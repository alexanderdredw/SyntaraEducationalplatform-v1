import { setRequestLocale } from 'next-intl/server';
import { QuizEditor } from '@/components/teacher/quiz-editor';
import { requireOwned } from '@/lib/require-owned';

/** /teacher/topics/:id/quiz: вопросы квиза (8.3.5, T08); только владелец. */
export default async function Page({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  await requireOwned(`/api/teacher/topics/${encodeURIComponent(id)}/quiz`);
  return <QuizEditor topicId={id} />;
}
