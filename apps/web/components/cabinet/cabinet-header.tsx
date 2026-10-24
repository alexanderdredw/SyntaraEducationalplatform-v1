'use client';

import { Fragment, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { DropdownMenu, Popover } from 'radix-ui';
import { Bell, ChevronDown, Flame, Zap } from 'lucide-react';
import { type Locale, type UserRole } from '@syntara/shared';
import { BrandMark, Capsule, Header, Wordmark } from '@syntara/ui';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from '@/i18n/navigation';
import { apiRequest } from '@/lib/api/browser';
import { HOME_BY_ROLE, ROLE_HOME } from '@/lib/auth';
import type { components } from '@/lib/api/schema';
import { AppLink } from '../app-link';
import { ActiveRowMark, MenuSection, menuRowClass, MobileMenu } from '../shell/mobile-menu';
import {
  capsuleControlClass,
  DataSaverToggle,
  LanguageSegments,
  LanguageSwitcher,
  MenuDataSaverButton,
  MenuThemeButton,
  ThemeToggle,
} from '../shell/preference-controls';
import { LogoutButton } from '../staff/logout-button';
import { NAV_ICONS } from './cabinet-sidebar';
import { type NavItem, type RoleNav } from './nav';
import { NavBadge, navBadgeState, useNavBadgeLabel } from './nav-badge';
import { useNavState } from './nav-state';

type Me = components['schemas']['MeDto'];
type Notification = components['schemas']['NotificationDto'];

// Капсулы вне группы настроек (уведомления, профиль): 44 px, рамка --capsule-border; hover — подложка светлее.
const pill =
  'inline-flex min-h-[var(--control-h)] items-center gap-2 rounded-[var(--radius-pill)] border border-[var(--capsule-border)] bg-[var(--capsule)] px-2 text-sm';
const pillAction = `${pill} hover:border-[var(--border-strong)] hover:bg-[var(--field)]`;

/** Смена языка перемонтирует хедер (сегмент [locale]); открытое меню остаётся открытым (UX-10, п. 7). */
let reopenMenuAfterLocaleSwitch = false;

/**
 * Хедер кабинетов (REQ-GEN-SHELL-02): выбор роли, язык, трафик, тема, уведомления, профиль (буква аватара
 * и имя), «Выйти»; у ученика — серия и XP (API-S-16). Логотип — на главную роли (REQ-NAV-06).
 * < 768 px (REQ-NAV-07): логотип, серия и XP, уведомления и «Меню»; в меню — «Мой кабинет», «Платформа»,
 * «Помощь», «Язык», «Настройки» (тема, трафик, роль, профиль, «Выйти»).
 */
export function CabinetHeader({
  me,
  role,
  stats: initialStats,
  enabledLocales,
  nav,
}: {
  me: Me;
  role: UserRole;
  stats: { streakDays: number; xpTotal: number } | null;
  enabledLocales: Locale[];
  nav: RoleNav;
}) {
  const t = useTranslations('cabinet');
  const ts = useTranslations('shell');
  const locale = useLocale();
  const router = useRouter();
  const { activeHref, badges } = useNavState(nav, role);
  const badgeLabel = useNavBadgeLabel();
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [reopened] = useState(() => {
    const value = reopenMenuAfterLocaleSwitch;
    reopenMenuAfterLocaleSwitch = false;
    return value;
  });
  const [menuOpen, setMenuOpen] = useState(reopened);
  const firstItemRef = useRef<HTMLAnchorElement>(null);
  const languageRef = useRef<HTMLElement>(null);
  // Серия и XP «живые»: после урока и квиза запрос ['me', 'stats'] обновляется (API-S-16).
  const statsQuery = useQuery({
    queryKey: ['me', 'stats'],
    enabled: initialStats !== null,
    initialData: initialStats ?? undefined,
    queryFn: async () => {
      const res = await apiRequest<{ streakDays: number; xpTotal: number }>('/api/me/stats', { locale });
      if (res.kind !== 'ok') throw new Error('stats');
      return res.data;
    },
  });
  const stats = initialStats ? (statsQuery.data ?? initialStats) : null;
  const notifications = useQuery({
    queryKey: ['me', 'notifications'],
    enabled: notificationsOpen,
    queryFn: async () => {
      const res = await apiRequest<Notification[]>('/api/me/notifications', { locale });
      return res.kind === 'ok' ? res.data : [];
    },
  });

  // API-ME-03: смена роли и переход на главную страницу роли.
  const switchRole = async (next: UserRole) => {
    const res = await apiRequest('/api/me/active-role', { method: 'POST', body: { role: next } });
    if (res.kind === 'ok') {
      router.push(HOME_BY_ROLE[next]);
      router.refresh();
    }
  };

  const logo = (
    <AppLink
      href={ROLE_HOME[role]}
      aria-label={ts('logoLabel')}
      onClick={() => setMenuOpen(false)}
      className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-2.5 rounded-[var(--radius-field)] text-xl"
    >
      <BrandMark />
      {/* < 400 px — только знак: серия, уведомления и «Меню» помещаются в одну строку (REQ-GEN-SHELL-07). */}
      <Wordmark className="hidden min-[400px]:inline" />
    </AppLink>
  );

  const menuLink = (item: NavItem, index: number) => {
    const Icon = NAV_ICONS[item.icon];
    const active = item.href === activeHref;
    const label = t(`nav.${item.key}`);
    const badge = navBadgeState(item.badge, badges);
    return (
      <li key={item.href}>
        <AppLink
          ref={index === 0 ? firstItemRef : undefined}
          href={item.href}
          onClick={() => setMenuOpen(false)}
          aria-current={active ? 'page' : undefined}
          aria-label={badge ? badgeLabel(label, item.badge, badges) : undefined}
          className={menuRowClass(active)}
        >
          {active ? <ActiveRowMark /> : null}
          <Icon aria-hidden="true" className="size-5 shrink-0" strokeWidth={1.75} />
          {label}
          {/* REQ-NAV-14, п. 6: те же числа и точки, что в панели. */}
          {badge ? <NavBadge state={badge} placement="row" /> : null}
        </AppLink>
      </li>
    );
  };

  return (
    <Header data-testid="cabinet-header">
      {logo}
      <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
        {/* < 768 px от капсулы остаются серия и XP; роль, язык и настройки — в меню (REQ-NAV-07). */}
        <Capsule className="flex-wrap max-md:contents">
          {stats ? (
            // Видимо — числа (эталоны U01–U13: «🔥 1 │ ⚡ 20 XP»), доступное имя — «Серия: N дн.», «N XP».
            <span
              data-testid="cabinet-stats"
              className="inline-flex min-h-11 items-center gap-2 rounded-[var(--radius-pill)] border border-[var(--capsule-border)] bg-[var(--chrome)] px-3 text-xs"
            >
              <span className="inline-flex items-center gap-1.5">
                <Flame aria-hidden="true" className="size-3.5 text-[var(--text-muted)]" />
                <span className="sr-only">{t('streak', { days: stats.streakDays })}</span>
                <span aria-hidden="true">{stats.streakDays}</span>
              </span>
              <span aria-hidden="true" className="h-4 w-px bg-[var(--capsule-border)]" />
              <span className="inline-flex items-center gap-1.5">
                <Zap aria-hidden="true" className="size-3.5 text-[var(--text-muted)]" />
                <span>{t('xp', { xp: stats.xpTotal })}</span>
              </span>
            </span>
          ) : null}

          <span className="contents max-md:hidden">
            {me.roles.length > 1 ? (
              <DropdownMenu.Root>
                <DropdownMenu.Trigger
                  className={capsuleControlClass}
                  aria-label={`${t('roleLabel')}: ${t(`roles.${role}`)}`}
                >
                  <span aria-hidden="true" className="text-[10px] text-[var(--warning)]">
                    ◆
                  </span>
                  {t(`roles.${role}`)}
                  <ChevronDown aria-hidden="true" className="size-3 text-[var(--text-muted)]" />
                </DropdownMenu.Trigger>
                <DropdownMenu.Portal>
                  <DropdownMenu.Content
                    align="end"
                    sideOffset={6}
                    className="z-50 rounded-[var(--radius-field)] border border-[var(--border)] bg-[var(--surface)] p-1 text-[var(--text)] shadow-popover"
                  >
                    {me.roles.map((r) => (
                      <DropdownMenu.Item
                        key={r}
                        onSelect={() => void switchRole(r)}
                        className="flex min-h-11 cursor-pointer items-center rounded-[var(--radius-item)] px-3 outline-none data-[highlighted]:bg-[var(--field)]"
                      >
                        {t(`roles.${r}`)}
                      </DropdownMenu.Item>
                    ))}
                  </DropdownMenu.Content>
                </DropdownMenu.Portal>
              </DropdownMenu.Root>
            ) : (
              <span className={capsuleControlClass} data-testid="cabinet-role">
                <span aria-hidden="true" className="text-[10px] text-[var(--warning)]">
                  ◆
                </span>
                {t(`roles.${role}`)}
              </span>
            )}

            <LanguageSwitcher enabledLocales={enabledLocales} />
            <span className="hidden xl:inline-flex">
              <DataSaverToggle />
            </span>
            <span className="xl:hidden">
              <DataSaverToggle compact />
            </span>
            <ThemeToggle />
          </span>
        </Capsule>

        <Popover.Root open={notificationsOpen} onOpenChange={setNotificationsOpen}>
          <Popover.Trigger
            aria-label={t('notifications')}
            className={`${pillAction} min-w-11 justify-center px-0`}
          >
            <Bell aria-hidden="true" className="size-4" />
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content
              align="end"
              sideOffset={6}
              className="z-50 w-[min(90vw,320px)] rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-4 text-sm text-[var(--text)] shadow-popover"
            >
              <h2 className="font-semibold">{t('notifications')}</h2>
              {notifications.data && notifications.data.length > 0 ? (
                <ul className="mt-2 space-y-2">
                  {notifications.data.map((n) => (
                    <li key={n.id}>{n.type}</li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-[var(--text-muted)]" role="status">
                  {t('noNotifications')}
                </p>
              )}
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>

        <AppLink
          href="/account/privacy"
          className={`${pillAction} max-md:hidden`}
          aria-label={`${t('profile')}: ${me.displayName}`}
        >
          <span
            aria-hidden="true"
            className="inline-flex size-7 items-center justify-center rounded-full bg-[#f97316] text-xs font-semibold text-[#050505]"
          >
            {me.initials.charAt(0)}
          </span>
          {/* Роль показывается один раз — в выборе роли (REQ-GEN-SHELL-02, решение владельца 2026-10-16). */}
          <span className="hidden pr-2 sm:inline">{me.displayName}</span>
        </AppLink>
        <span className="max-md:hidden">
          <LogoutButton label={t('logout')} />
        </span>
        <MobileMenu
          open={menuOpen}
          onOpenChange={setMenuOpen}
          label={ts('menu')}
          closeLabel={ts('closeMenu')}
          hiddenFrom="md"
          logo={logo}
          // UX-10, п. 13: фокус — на первый пункт; после смены языка — на выбранный язык.
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            const language = reopened
              ? languageRef.current?.querySelector<HTMLElement>('[data-state="on"]')
              : null;
            (language ?? firstItemRef.current)?.focus();
          }}
        >
          <nav aria-label={t('sidebarLabel')} data-testid="cabinet-menu-nav" className="flex flex-col gap-4">
            {/* Группы — как в панели; «Главная» — сверху первой группы (REQ-NAV-07, REQ-NAV-10). */}
            {nav.groups.map((group, g) => (
              <Fragment key={group.key}>
                <MenuSection id={`cabinet-menu-${group.key}`} title={t(`navGroups.${group.key}`)}>
                  <ul className="flex flex-col gap-2">
                    {(g === 0 ? [nav.home, ...group.items] : group.items).map((item, i) =>
                      menuLink(item, g === 0 ? i : -1),
                    )}
                  </ul>
                </MenuSection>
                <hr className="border-[var(--border)]" />
              </Fragment>
            ))}
            <MenuSection id="cabinet-menu-help" title={t(`nav.${nav.help.key}`)}>
              <ul className="flex flex-col gap-2">{menuLink(nav.help, -1)}</ul>
            </MenuSection>
          </nav>
          <hr className="border-[var(--border)]" />
          <MenuSection ref={languageRef} id="cabinet-menu-language" title={ts('language')}>
            <LanguageSegments
              enabledLocales={enabledLocales}
              stretch
              onBeforeSwitch={() => {
                reopenMenuAfterLocaleSwitch = true;
              }}
            />
          </MenuSection>
          <hr className="border-[var(--border)]" />
          <MenuSection id="cabinet-menu-settings" title={ts('settings')}>
            <div className="flex items-center gap-3">
              <MenuThemeButton />
              <MenuDataSaverButton />
            </div>
            {me.roles.length > 1 ? (
              <div role="group" aria-label={t('roleLabel')} className="flex flex-col gap-2">
                {me.roles.map((r) => (
                  <button
                    key={r}
                    type="button"
                    aria-pressed={r === role}
                    onClick={() => {
                      setMenuOpen(false);
                      void switchRole(r);
                    }}
                    className={menuRowClass(r === role)}
                  >
                    {t(`roles.${r}`)}
                  </button>
                ))}
              </div>
            ) : null}
            <div className="flex flex-wrap items-center gap-2">
              <AppLink
                href="/account/privacy"
                onClick={() => setMenuOpen(false)}
                className={pillAction}
                aria-label={`${t('profile')}: ${me.displayName}`}
              >
                <span
                  aria-hidden="true"
                  className="inline-flex size-7 items-center justify-center rounded-full bg-[#f97316] text-xs font-semibold text-[#050505]"
                >
                  {me.initials.charAt(0)}
                </span>
                <span className="pr-2">{me.displayName}</span>
              </AppLink>
              <LogoutButton label={t('logout')} />
            </div>
          </MenuSection>
        </MobileMenu>
      </div>
    </Header>
  );
}
