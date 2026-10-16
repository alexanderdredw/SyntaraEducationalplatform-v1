import { redirect } from '@/i18n/navigation';

/**
 * /teacher/subjects/:id/topics/new (раздел 4). Тема создаётся кнопкой «+ Добавить тему» (API-T-09 → редактор,
 * REQ-TCH-ACC-02) — открыть адрес без создания черновика можно только со страницы предмета.
 * TODO(OWNER): нужен ли отдельный экран «Новая тема» до первого сохранения (тогда ИИ-черновик — без темы)?
 */
export default async function Page({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  redirect({ href: `/teacher/subjects/${encodeURIComponent(id)}`, locale });
}
