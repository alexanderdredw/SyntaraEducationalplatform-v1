import { type ReactNode } from 'react';
import { HydrationBoundary } from '@tanstack/react-query';
import { setRequestLocale } from 'next-intl/server';
import { TEACHER_CLASSES_KEY } from '@/components/learn/query-keys';
import { ClassTabs } from '@/components/teacher/class-tabs';
import { prefetchState } from '@/lib/api/prefetch';
import { requireOwned } from '@/lib/require-owned';

/** /teacher/classes/:id/* (8.3.7, REQ-TCH-AN-01): шапка класса и вкладки. Чужой класс → 404 (BR-ACL-02). */
export default async function Layout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  // OPT-05 (О4-2): список классов для шапки — уже в HTML (параллельно с проверкой владения).
  const [, state] = await Promise.all([
    requireOwned(`/api/teacher/classes/${encodeURIComponent(id)}/roster`),
    prefetchState(locale, [{ key: TEACHER_CLASSES_KEY, path: '/api/teacher/classes' }]),
  ]);
  return (
    <HydrationBoundary state={state}>
      <section className="mx-auto flex max-w-[792px] flex-col gap-6 px-4 py-8">
        <ClassTabs classId={id} />
        {children}
      </section>
    </HydrationBoundary>
  );
}
