import { HydrationBoundary } from '@tanstack/react-query';
import { notFound } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import { AccountOverview } from '@/components/account/account-overview';
import { ACTIVITY_KEY } from '@/components/learn/query-keys';
import { workspaceRole } from '@/lib/auth';
import { prefetchState } from '@/lib/api/prefetch';
import { requireUser } from '@/lib/require-user';

/** /account — «Личный кабинет», вкладка «Обзор» (REQ-PRF-02…04). Только ученик и учитель (служебные роли — 404). */
export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const role = workspaceRole(await requireUser(locale));
  if (!role) notFound();
  // OPT-05 (О4-2): календарь активности ученика (API-ME-15) — уже в HTML; профиль и цифры — в layout.
  const state = await prefetchState(
    locale,
    role === 'student' ? [{ key: ACTIVITY_KEY, path: '/api/me/activity?weeks=12' }] : [],
  );
  return (
    <HydrationBoundary state={state}>
      <AccountOverview timeZone={process.env.PLATFORM_TZ ?? 'Asia/Almaty'} />
    </HydrationBoundary>
  );
}
