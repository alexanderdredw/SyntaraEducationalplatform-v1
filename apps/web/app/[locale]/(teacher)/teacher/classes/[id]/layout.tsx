import { type ReactNode } from 'react';
import { setRequestLocale } from 'next-intl/server';
import { ClassTabs } from '@/components/teacher/class-tabs';
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
  await requireOwned(`/api/teacher/classes/${encodeURIComponent(id)}/roster`);
  return (
    <section className="mx-auto flex max-w-[792px] flex-col gap-6 px-4 py-8">
      <ClassTabs classId={id} />
      {children}
    </section>
  );
}
