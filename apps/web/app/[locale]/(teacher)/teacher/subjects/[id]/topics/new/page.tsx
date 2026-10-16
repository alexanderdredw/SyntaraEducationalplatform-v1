import { redirect } from '@/i18n/navigation';

/**
 * /teacher/subjects/:id/topics/new (раздел 4): отдельного экрана нет (решение владельца 2026-10-16) — тема
 * создаётся кнопкой «+ Добавить тему» на странице предмета (API-T-09 → редактор, REQ-TCH-ACC-02).
 */
export default async function Page({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  redirect({ href: `/teacher/subjects/${encodeURIComponent(id)}`, locale });
}
