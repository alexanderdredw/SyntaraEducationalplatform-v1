import { type ReactNode } from 'react';
import { HydrationBoundary } from '@tanstack/react-query';
import { setRequestLocale } from 'next-intl/server';
import { AccountHeader } from '@/components/account/account-header';
import { CabinetShell } from '@/components/cabinet/cabinet-shell';
import { DASHBOARD_KEY, PROFILE_KEY } from '@/components/learn/query-keys';
import { PublicShell } from '@/components/shell/public-shell';
import { prefetchState } from '@/lib/api/prefetch';
import { workspaceRole } from '@/lib/auth';
import { requireUser } from '@/lib/require-user';

/**
 * /account/* (SPEC 8.7, REQ-PRF-01): у ученика и учителя — внутри рабочей среды (хедер + панель) с вкладками
 * «Обзор», «Профиль», «Настройки», «Данные». У служебных ролей — только «Мои данные» в прежней оболочке
 * (REQ-GEN-AUTH-04 без изменений). Без сессии — вход с возвратом.
 */
export default async function Layout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const me = await requireUser(locale);
  const role = workspaceRole(me);
  if (!role) {
    return (
      <PublicShell>
        <section className="px-4 py-12 md:py-16">
          <div className="mx-auto max-w-[640px]">{children}</div>
        </section>
      </PublicShell>
    );
  }
  // OPT-05 (О4-2): профиль и цифры шапки — уже в HTML на всех четырёх вкладках.
  const state = await prefetchState(locale, [
    { key: PROFILE_KEY, path: '/api/me/profile' },
    { key: DASHBOARD_KEY, path: '/api/me/dashboard' },
  ]);
  return (
    <CabinetShell me={me} cabinetRole={role}>
      <HydrationBoundary state={state}>
        <section className="mx-auto flex max-w-[880px] flex-col gap-6 px-4 py-8">
          {/* REQ-PRF-20: шапка профиля с вкладками — одинаковая на четырёх страницах. */}
          <AccountHeader timeZone={process.env.PLATFORM_TZ ?? 'Asia/Almaty'} />
          {children}
        </section>
      </HydrationBoundary>
    </CabinetShell>
  );
}
