import { HydrationBoundary } from '@tanstack/react-query';
import { setRequestLocale } from 'next-intl/server';
import AtlasExplore from '@/components/subjects/atlas-chemistry/explore';
import { atlasScreen } from '@/lib/atlas';

/**
 * /learn/subjects/:id/explore[/:code[/test]] — Explore и окно элемента «Mendeleev Atlas» (REQ-ATL-03).
 * Экран — отдельная страница: свой чанк кода (REQ-ATL-06.3).
 */
export default async function Page({
  params,
}: {
  params: Promise<{ locale: string; id: string; rest?: string[] }>;
}) {
  const { locale, id, rest } = await params;
  setRequestLocale(locale);
  const { route, state } = await atlasScreen(locale, id, ['explore', ...(rest ?? [])]);
  return (
    <HydrationBoundary state={state}>
      <AtlasExplore code={route.code} test={route.test === true} />
    </HydrationBoundary>
  );
}
