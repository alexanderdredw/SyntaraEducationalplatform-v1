import { cookies } from 'next/headers';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { getMe } from '@/lib/api/server';
import { StudentClassCard } from '@/components/cabinet/student-class-card';
import { StudentCatalog } from '@/components/learn/catalog';

/** /learn/subjects (8.4.2, U13): карточка класса (REQ-ST-CAT-01) и «Предметы платформы» (REQ-ST-CAT-02). */
export default async function StudentSubjectsPage({ params }: { params: Promise<{ locale: string }> }) {
  setRequestLocale((await params).locale);
  const t = await getTranslations();
  // Гость видит каталог базовых уроков без карточки класса (BR-VIS-04).
  const guest = !(await getMe((await cookies()).toString()));
  return (
    <section className="mx-auto flex max-w-[1000px] flex-col gap-6 px-4 py-8">
      <h1 className="text-cabinet-title font-bold">{t('student.subjects.title')}</h1>
      {guest ? null : <StudentClassCard />}
      <StudentCatalog />
    </section>
  );
}
