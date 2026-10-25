'use client';

import { useTranslations } from 'next-intl';
import { NavTabs } from '@syntara/ui';
import { usePathname } from '@/i18n/navigation';
import { AppLink } from '../app-link';

/** Вкладки личного кабинета (REQ-PRF-01): «Обзор», «Профиль», «Настройки», «Данные». */
export const ACCOUNT_TABS = [
  { key: 'overview', href: '/account' },
  { key: 'profile', href: '/account/profile' },
  { key: 'settings', href: '/account/settings' },
  { key: 'privacy', href: '/account/privacy' },
] as const;

export function AccountTabs() {
  const t = useTranslations('account');
  const pathname = usePathname();
  return (
    <NavTabs
      label={t('tabsLabel')}
      link={AppLink}
      items={ACCOUNT_TABS.map((tab) => ({
        href: tab.href,
        label: t(`tabs.${tab.key}`),
        active: pathname === tab.href,
      }))}
    />
  );
}
