import { setRequestLocale } from 'next-intl/server';
import { StudentSubject } from '@/components/learn/catalog';
import AtlasHome from '@/components/subjects/atlas-chemistry/home';
import { subjectModule } from '@/lib/atlas';
import { requireLearnVisible } from '@/lib/require-owned';

/**
 * /learn/subjects/:id — страница предмета ученика (решение владельца 2026-10-14). Предмет не виден ученику
 * (BR-VIS-01) → 404. Гость — только базовые предметы (BR-VIS-04). Предмет с модулем атласа — Главная атласа
 * (REQ-ATL-01).
 */
export default async function Page({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  await requireLearnVisible(
    `/api/student/subjects/${encodeURIComponent(id)}`,
    `/api/public/subjects/${encodeURIComponent(id)}`,
  );
  if ((await subjectModule(id, locale)) === 'atlas-chemistry') return <AtlasHome />;
  return <StudentSubject id={id} />;
}
