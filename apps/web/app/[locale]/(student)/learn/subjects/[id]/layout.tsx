import { type ReactNode } from 'react';
import { HydrationBoundary } from '@tanstack/react-query';
import { setRequestLocale } from 'next-intl/server';
import { AtlasShell } from '@/components/subjects/atlas-chemistry/atlas-shell';
import { atlasQueryKey } from '@/components/subjects/atlas-chemistry/routes';
import { learnGuest, prefetchState } from '@/lib/api/prefetch';
import { subjectModule } from '@/lib/atlas';

/**
 * Предмет с модулем «Mendeleev Atlas» (REQ-ATL-01, docs/CHEM_TZ_2.md): все его адреса — внутри оболочки атласа
 * (полоса с логотипом и «таблеткой»); данные экранов — уже в HTML (OPT-05). Остальные предметы — без изменений.
 */
export default async function Layout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  if ((await subjectModule(id, locale)) !== 'atlas-chemistry') return children;
  const guest = await learnGuest();
  const state = await prefetchState(locale, [
    {
      key: atlasQueryKey(id, guest, locale),
      path: `${guest ? '/api/public' : '/api/student'}/subjects/${encodeURIComponent(id)}/atlas`,
    },
  ]);
  return (
    <HydrationBoundary state={state}>
      <AtlasShell subjectId={id} timeZone={process.env.PLATFORM_TZ ?? 'Asia/Almaty'}>
        {children}
      </AtlasShell>
    </HydrationBoundary>
  );
}
