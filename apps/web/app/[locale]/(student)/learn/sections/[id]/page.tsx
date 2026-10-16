import { setRequestLocale } from 'next-intl/server';
import { StudentSection } from '@/components/learn/catalog';
import { requireLearnVisible } from '@/lib/require-owned';

/** /learn/sections/:id (REQ-ST-CAT-03, U03). Нет раздела → 404. */
export default async function Page({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  await requireLearnVisible(
    `/api/student/sections/${encodeURIComponent(id)}`,
    `/api/public/sections/${encodeURIComponent(id)}`,
  );
  return <StudentSection id={id} />;
}
