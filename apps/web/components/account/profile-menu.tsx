'use client';

import { useTranslations } from 'next-intl';
import { DropdownMenu } from 'radix-ui';
import { ChevronDown, LayoutDashboard, LogOut, Settings, Shield, UserRound } from 'lucide-react';
import { Avatar, type AvatarData } from '@syntara/ui';
import { useRouter } from '@/i18n/navigation';
import { apiRequest } from '@/lib/api/browser';
import { AppLink } from '../app-link';

export const PROFILE_LINKS = [
  { key: 'dashboard', href: '/account', icon: LayoutDashboard },
  { key: 'editProfile', href: '/account/profile', icon: UserRound },
  { key: 'settings', href: '/account/settings', icon: Settings },
  { key: 'privacy', href: '/account/privacy', icon: Shield },
] as const;

const itemClass =
  'flex min-h-11 cursor-pointer items-center gap-2.5 rounded-[var(--radius-item)] px-3 text-sm outline-none data-[highlighted]:bg-[var(--field)]';

/**
 * Меню профиля в хедере (REQ-PRF-10): аватар и имя → «Мой кабинет», «Редактировать профиль», «Настройки»,
 * «Данные и конфиденциальность», разделитель, «Выйти». Клавиатура и Esc — Radix DropdownMenu.
 */
export function ProfileMenu({
  name,
  avatar,
  triggerClassName,
}: {
  name: string;
  avatar: AvatarData;
  triggerClassName: string;
}) {
  const t = useTranslations('account.menu');
  const tc = useTranslations('cabinet');
  const router = useRouter();
  const logout = async () => {
    await apiRequest('/api/auth/logout', { method: 'POST' });
    router.replace('/');
    router.refresh();
  };
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        className={triggerClassName}
        aria-label={`${tc('profile')}: ${name}`}
        data-testid="profile-menu-trigger"
      >
        <Avatar name={name} avatar={avatar} size={32} decorative />
        <span className="hidden max-w-[180px] truncate sm:inline">{name}</span>
        <ChevronDown aria-hidden="true" className="mr-1 size-3 text-[var(--text-muted)]" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={6}
          aria-label={t('label')}
          data-testid="profile-menu"
          className="z-50 min-w-[240px] rounded-[var(--radius-field)] border border-[var(--border)] bg-[var(--surface)] p-1 text-[var(--text)] shadow-popover"
        >
          <DropdownMenu.Label className="flex items-center gap-2.5 px-3 py-2 text-sm font-semibold">
            <Avatar name={name} avatar={avatar} size={40} decorative />
            <span className="truncate">{name}</span>
          </DropdownMenu.Label>
          <DropdownMenu.Separator className="my-1 h-px bg-[var(--border)]" />
          {PROFILE_LINKS.map(({ key, href, icon: Icon }) => (
            <DropdownMenu.Item key={key} asChild className={itemClass}>
              <AppLink href={href}>
                <Icon aria-hidden="true" className="size-4 text-[var(--text-muted)]" />
                {t(key)}
              </AppLink>
            </DropdownMenu.Item>
          ))}
          <DropdownMenu.Separator className="my-1 h-px bg-[var(--border)]" />
          <DropdownMenu.Item
            className={itemClass}
            onSelect={() => void logout()}
            data-testid="profile-menu-logout"
          >
            <LogOut aria-hidden="true" className="size-4 text-[var(--text-muted)]" />
            {tc('logout')}
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

/**
 * Строка профиля (REQ-PRF-10): аватар и имя → «Личный кабинет» (/account). В панели навигации — над «Помощь»
 * (в свёрнутой панели — только аватар), в меню телефона — первым блоком.
 */
export function ProfileRow({
  name,
  avatar,
  className,
  active,
  onNavigate,
  compactLabel,
}: {
  name: string;
  avatar: AvatarData;
  className: string;
  active?: boolean;
  onNavigate?: () => void;
  /** Свёрнутая панель: подпись скрыта, подсказка — имя. */
  compactLabel?: boolean;
}) {
  const t = useTranslations('account.menu');
  return (
    <AppLink
      href="/account"
      onClick={onNavigate}
      aria-label={t('profileRow', { name })}
      aria-current={active ? 'page' : undefined}
      title={compactLabel ? name : undefined}
      data-testid="profile-row"
      className={className}
    >
      <Avatar name={name} avatar={avatar} size={32} decorative />
      <span aria-hidden="true" className="min-w-0 truncate leading-tight nav-collapsed:hidden">
        {name}
      </span>
    </AppLink>
  );
}
