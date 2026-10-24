import { cookies } from 'next/headers';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { getMe } from '@/lib/api/server';
import { StudentCatalog } from '@/components/learn/catalog';

/**
 * /learn/subjects — «Каталог» (REQ-NAV-12, U13): у ученика заголовок страницы «Предметы платформы» и только
 * базовые предметы; карточка класса и «Подключиться к классу» — в «Мой класс» (REQ-NAV-11). Гость и вошедший без
 * роли ученика (REQ-NAV-04) видят каталог базовых уроков как раньше (BR-VIS-04).
 */
export default async function StudentSubjectsPage({ params }: { params: Promise<{ locale: string }> }) {
  setRequestLocale((await params).locale);
  const t = await getTranslations();
  const student = (await getMe((await cookies()).toString()))?.roles.includes('student');
  return (
    <section className="mx-auto flex max-w-[1012px] flex-col gap-6 px-4 py-8">
      {student ? (
        <StudentCatalog heading={1} />
      ) : (
        <>
          <h1 className="text-cabinet-title font-bold">{t('student.subjects.title')}</h1>
          <StudentCatalog />
        </>
      )}
    </section>
  );
}
