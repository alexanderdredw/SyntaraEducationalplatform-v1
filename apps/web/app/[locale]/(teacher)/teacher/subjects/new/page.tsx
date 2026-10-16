import { getTranslations, setRequestLocale } from 'next-intl/server';
import { CABINET_FORM_WIDTH } from '@/components/teacher/layout';
import { PageHeader } from '@/components/teacher/parts';
import { SubjectForm } from '@/components/teacher/subject-form';

/** /teacher/subjects/new: «Новый предмет» (8.3.1, T05). */
export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  setRequestLocale((await params).locale);
  const t = await getTranslations('teacher.subjectForm');
  return (
    <section
      className={`mx-auto flex ${CABINET_FORM_WIDTH} flex-col gap-6 px-4 py-8`}
      data-testid="subject-new"
    >
      <PageHeader title={t('newTitle')} back={{ href: '/teacher/courses', label: t('back') }} />
      <SubjectForm mode="create" />
    </section>
  );
}
