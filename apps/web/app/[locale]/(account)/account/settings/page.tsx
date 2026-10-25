import { notFound } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import { type Locale, PASSWORD_MIN_LENGTH } from '@syntara/shared';
import { AccountSettings } from '@/components/account/account-settings';
import { getPublicConfig } from '@/lib/api/server';
import { workspaceRole } from '@/lib/auth';
import { requireUser } from '@/lib/require-user';

/** /account/settings — «Настройки аккаунта» (REQ-PRF-06…09). Только ученик и учитель (служебные роли — 404). */
export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  if (!workspaceRole(await requireUser(locale))) notFound();
  const config = await getPublicConfig();
  const enabledLocales: Locale[] = config?.features.enabledLocales ?? ['ru', 'kk', 'en'];
  return (
    <AccountSettings
      timeZone={process.env.PLATFORM_TZ ?? 'Asia/Almaty'}
      enabledLocales={enabledLocales}
      minPasswordLength={PASSWORD_MIN_LENGTH}
    />
  );
}
