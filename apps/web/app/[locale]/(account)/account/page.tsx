import { notFound } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import { AccountOverview } from '@/components/account/account-overview';
import { workspaceRole } from '@/lib/auth';
import { requireUser } from '@/lib/require-user';

/** /account — «Личный кабинет», вкладка «Обзор» (REQ-PRF-02…04). Только ученик и учитель (служебные роли — 404). */
export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  if (!workspaceRole(await requireUser(locale))) notFound();
  return <AccountOverview timeZone={process.env.PLATFORM_TZ ?? 'Asia/Almaty'} />;
}
