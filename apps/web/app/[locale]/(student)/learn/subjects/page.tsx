import { HydrationBoundary } from '@tanstack/react-query';
import { cookies } from 'next/headers';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { getMe } from '@/lib/api/server';
import { prefetchState } from '@/lib/api/prefetch';
import { StudentCatalog } from '@/components/learn/catalog';
import { catalogQueryKey } from '@/components/learn/query-keys';

/**
 * /learn/subjects — «Каталог» (REQ-NAV-12, U13): у ученика заголовок страницы «Предметы платформы» и только
 * базовые предметы; карточка класса и «Подключиться к классу» — в «Мой класс» (REQ-NAV-11). Гость и вошедший без
 * роли ученика (REQ-NAV-04) видят каталог базовых уроков как раньше (BR-VIS-04).
 */
export default async function StudentSubjectsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations();
  // OPT-05 (О4-2): каталог — уже в HTML (у гостя и ученика — один и тот же API-PUB-10).
  const [me, state] = await Promise.all([
    getMe((await cookies()).toString()),
    prefetchState(locale, [{ key: catalogQueryKey(locale), path: '/api/public/catalog' }]),
  ]);
  const student = me?.roles.includes('student');
  return (
    <HydrationBoundary state={state}>
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
    </HydrationBoundary>
  );
}
