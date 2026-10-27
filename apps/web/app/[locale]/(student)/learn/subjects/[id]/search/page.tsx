import { HydrationBoundary } from '@tanstack/react-query';
import { setRequestLocale } from 'next-intl/server';
import AtlasSearch from '@/components/subjects/atlas-chemistry/search';
import { atlasScreen } from '@/lib/atlas';

/**
 * /learn/subjects/:id/search — Поиск атласа (REQ-ATL-03).
 * Экран — отдельная страница: свой чанк кода (REQ-ATL-06.3).
 */
export default async function Page({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const { state } = await atlasScreen(locale, id, ['search']);
  return (
    <HydrationBoundary state={state}>
      <AtlasSearch />
    </HydrationBoundary>
  );
}
