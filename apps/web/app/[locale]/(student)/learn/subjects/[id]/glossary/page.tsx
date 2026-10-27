import { setRequestLocale } from 'next-intl/server';
import { SubjectGlossary } from '@/components/learn/glossary';
import { requireLearnVisible } from '@/lib/require-owned';

/**
 * /learn/subjects/:id/glossary — глоссарий предмета (REQ-GLOS-02). Предмет не виден или без глоссария → 404
 * (API-S-22, гостю — API-PUB-14, BR-VIS-04).
 */
export default async function Page({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  await requireLearnVisible(
    `/api/student/subjects/${encodeURIComponent(id)}/glossary`,
    `/api/public/subjects/${encodeURIComponent(id)}/glossary`,
  );
  return <SubjectGlossary id={id} />;
}
