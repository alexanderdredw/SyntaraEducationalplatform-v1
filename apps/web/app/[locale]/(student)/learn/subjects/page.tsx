import { getTranslations, setRequestLocale } from 'next-intl/server';
import { PendingBlock } from '@/components/public/blocks';
import { StudentClassCard } from '@/components/cabinet/student-class-card';

/** /learn/subjects (8.4.2): карточка класса (REQ-ST-CAT-01); каталог предметов (REQ-ST-CAT-02) — итерация 8. */
export default async function StudentSubjectsPage({ params }: { params: Promise<{ locale: string }> }) {
  setRequestLocale((await params).locale);
  const t = await getTranslations();
  return (
    <section className="mx-auto flex max-w-[1000px] flex-col gap-6 px-4 py-8">
      <h1 className="text-cabinet-title font-bold">{t('student.subjects.title')}</h1>
      <StudentClassCard />
      <PendingBlock text={t('common.sectionInDevelopment')} />
    </section>
  );
}
