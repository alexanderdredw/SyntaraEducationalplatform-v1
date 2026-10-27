import { HydrationBoundary } from '@tanstack/react-query';
import { setRequestLocale } from 'next-intl/server';
import AtlasQuizScreen from '@/components/subjects/atlas-chemistry/quiz';
import { atlasScreen } from '@/lib/atlas';

/**
 * /learn/subjects/:id/quiz — квиз «Проверь знания» (REQ-ATL-03, BR-XP-05).
 * Экран — отдельная страница: свой чанк кода (REQ-ATL-06.3).
 */
export default async function Page({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const { state } = await atlasScreen(locale, id, ['quiz']);
  return (
    <HydrationBoundary state={state}>
      <AtlasQuizScreen />
    </HydrationBoundary>
  );
}
