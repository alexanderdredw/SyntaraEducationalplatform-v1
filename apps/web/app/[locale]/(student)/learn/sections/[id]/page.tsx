import { setRequestLocale } from 'next-intl/server';
import { StudentSection } from '@/components/learn/catalog';
import { requireOwned } from '@/lib/require-owned';

/** /learn/sections/:id (REQ-ST-CAT-03, U03). Нет раздела → 404. */
export default async function Page({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  await requireOwned(`/api/student/sections/${encodeURIComponent(id)}`);
  return <StudentSection id={id} />;
}
