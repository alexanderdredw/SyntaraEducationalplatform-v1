import { setRequestLocale } from 'next-intl/server';
import { SubjectPage } from '@/components/teacher/subject-page';
import { requireOwned } from '@/lib/teacher-page';

/** /teacher/subjects/:id: доступ классу и темы (8.3.2, T04); только владелец. */
export default async function Page({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  await requireOwned(`/api/teacher/subjects/${encodeURIComponent(id)}`);
  return <SubjectPage id={id} />;
}
