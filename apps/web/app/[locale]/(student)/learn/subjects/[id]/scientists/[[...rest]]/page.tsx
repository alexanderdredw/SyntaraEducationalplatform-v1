import { HydrationBoundary } from '@tanstack/react-query';
import { setRequestLocale } from 'next-intl/server';
import AtlasScientists from '@/components/subjects/atlas-chemistry/scientists';
import { atlasScreen } from '@/lib/atlas';

/**
 * /learn/subjects/:id/scientists[/:code | /test] — «Учёные» атласа (REQ-ATL-03, решение А-5).
 * Экран — отдельная страница: свой чанк кода (REQ-ATL-06.3).
 */
export default async function Page({
  params,
}: {
  params: Promise<{ locale: string; id: string; rest?: string[] }>;
}) {
  const { locale, id, rest } = await params;
  setRequestLocale(locale);
  const { route, state } = await atlasScreen(locale, id, ['scientists', ...(rest ?? [])]);
  return (
    <HydrationBoundary state={state}>
      <AtlasScientists code={route.code} test={route.test === true} />
    </HydrationBoundary>
  );
}
