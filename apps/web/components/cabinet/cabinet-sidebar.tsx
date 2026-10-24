'use client';

import { useSyncExternalStore } from 'react';
import { useTranslations } from 'next-intl';
import {
  BarChart3,
  BookOpen,
  Building2,
  ClipboardList,
  House,
  Info,
  LibraryBig,
  LifeBuoy,
  PanelLeftClose,
  PanelLeftOpen,
  Sparkles,
  Trophy,
  Users,
  Zap,
} from 'lucide-react';
import { cn } from '@syntara/ui';
import { usePathname } from '@/i18n/navigation';
import { SIDEBAR_COLLAPSED, SIDEBAR_STORAGE_KEY } from '@/lib/preferences';
import { AppLink } from '../app-link';
import { isNavActive, type NavIcon, type NavItem, type RoleNav } from './nav';

/** Иконки пунктов (REQ-NAV-03, п. 4): у каждого пункта роли — своя. */
export const NAV_ICONS: Record<NavIcon, typeof BookOpen> = {
  home: House,
  subjects: BookOpen,
  courses: BookOpen,
  classes: Users,
  assignments: ClipboardList,
  assistant: Sparkles,
  battle: Zap,
  progress: BarChart3,
  achievements: Trophy,
  catalog: LibraryBig,
  about: Info,
  schools: Building2,
  help: LifeBuoy,
};

// «Свёрнуто/развёрнуто» живёт в атрибуте data-sidebar на <html>: его до отрисовки ставит SIDEBAR_INIT_SCRIPT,
// ширину панели и контента задаёт CSS (--nav-w), поэтому серверная разметка не зависит от выбора.
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};
const readCollapsed = () => document.documentElement.getAttribute('data-sidebar') === SIDEBAR_COLLAPSED;

function setCollapsed(collapsed: boolean) {
  const root = document.documentElement;
  if (collapsed) root.setAttribute('data-sidebar', SIDEBAR_COLLAPSED);
  else root.removeAttribute('data-sidebar');
  try {
    if (collapsed) localStorage.setItem(SIDEBAR_STORAGE_KEY, SIDEBAR_COLLAPSED);
    else localStorage.removeItem(SIDEBAR_STORAGE_KEY);
  } catch {
    // Хранилище недоступно — выбор действует до перезагрузки.
  }
  listeners.forEach((listener) => listener());
}

const rowClass =
  'relative flex min-h-11 w-full items-center gap-3 rounded-[var(--radius-field)] px-3 text-sm nav-collapsed:mx-auto nav-collapsed:size-[46px] nav-collapsed:min-h-0 nav-collapsed:justify-center nav-collapsed:px-0';

/**
 * Панель навигации кабинета (REQ-NAV-01..03, REQ-GEN-SHELL-03), ≥ 768 px: «Главная», группы «Мой кабинет» и
 * «Платформа» с подписями, внизу «Помощь» и «Свернуть панель». Развёрнутая (~220 px) — иконка и подпись;
 * свёрнутая (~70 px) — иконки с подсказками, подписи групп скрыты, разделители остаются.
 * На телефоне те же пункты — в меню хедера (REQ-NAV-07).
 */
export function CabinetSidebar({ nav }: { nav: RoleNav }) {
  const t = useTranslations('cabinet');
  const pathname = usePathname();
  const collapsed = useSyncExternalStore(subscribe, readCollapsed, () => false);

  const link = (item: NavItem) => {
    const Icon = NAV_ICONS[item.icon];
    const label = t(`nav.${item.key}`);
    const active = isNavActive(pathname, item);
    return (
      <li key={item.href}>
        <AppLink
          href={item.href}
          aria-label={label}
          title={collapsed ? label : undefined}
          aria-current={active ? 'page' : undefined}
          className={cn(
            rowClass,
            active
              ? // Синие иконка и полоса; подпись — основным цветом текста (контраст 4.5:1 в обеих темах).
                'bg-[var(--accent-soft)] font-semibold text-[var(--text)] before:absolute before:left-1.5 before:top-1/2 before:h-[22px] before:w-[3px] before:-translate-y-1/2 before:rounded-full before:bg-[var(--accent-bright)]'
              : 'text-[var(--text-muted)] hover:bg-[var(--field)] hover:text-[var(--text)]',
          )}
        >
          <Icon
            aria-hidden="true"
            className={cn('size-[18px] shrink-0', active && 'text-[var(--accent-bright)]')}
            strokeWidth={1.75}
          />
          <span aria-hidden="true" className="min-w-0 leading-tight nav-collapsed:hidden">
            {label}
          </span>
        </AppLink>
      </li>
    );
  };
  const divider = <hr aria-hidden="true" className="mx-3 my-2 border-[var(--chrome-border)]" />;
  const toggleLabel = collapsed ? t('expandNav') : t('collapseNav');
  const ToggleIcon = collapsed ? PanelLeftOpen : PanelLeftClose;

  return (
    <nav
      aria-label={t('sidebarLabel')}
      data-testid="cabinet-sidebar"
      className="fixed top-[calc(var(--header-h)+10px)] bottom-4 left-0 z-20 hidden w-[var(--nav-w)] flex-col rounded-r-[14px] border border-l-0 border-[var(--chrome-border)] bg-[var(--sidebar)] py-3 md:flex"
    >
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-2">
        <ul className="flex flex-col gap-0.5">{link(nav.home)}</ul>
        {nav.groups.map((group) => (
          <div key={group.key}>
            {divider}
            <p
              id={`nav-group-${group.key}`}
              className="px-3 pb-1.5 text-[11px] font-semibold tracking-[0.12em] text-[var(--text-muted)] uppercase nav-collapsed:sr-only"
            >
              {t(`navGroups.${group.key}`)}
            </p>
            <ul aria-labelledby={`nav-group-${group.key}`} className="flex flex-col gap-0.5">
              {group.items.map(link)}
            </ul>
          </div>
        ))}
      </div>
      <div className="px-2">
        {divider}
        <ul className="flex flex-col gap-0.5">{link(nav.help)}</ul>
        <button
          type="button"
          data-testid="sidebar-toggle"
          aria-label={toggleLabel}
          title={collapsed ? toggleLabel : undefined}
          aria-expanded={!collapsed}
          onClick={() => setCollapsed(!collapsed)}
          className={cn(
            rowClass,
            'mt-0.5 text-[var(--text-muted)] hover:bg-[var(--field)] hover:text-[var(--text)]',
          )}
        >
          <ToggleIcon aria-hidden="true" className="size-[18px] shrink-0" strokeWidth={1.75} />
          <span aria-hidden="true" className="min-w-0 leading-tight nav-collapsed:hidden">
            {toggleLabel}
          </span>
        </button>
      </div>
    </nav>
  );
}
