'use client';

import { useTranslations } from 'next-intl';
import { BarChart3, BookOpen, ClipboardList, LifeBuoy, Sparkles, Trophy, Users } from 'lucide-react';
import { cn } from '@syntara/ui';
import { usePathname } from '@/i18n/navigation';
import { AppLink } from '../app-link';
import { type CabinetIcon, type CabinetNavItem } from './nav';

const ICONS: Record<CabinetIcon, typeof BookOpen> = {
  courses: BookOpen,
  classes: Users,
  assignments: ClipboardList,
  assistant: Sparkles,
  progress: BarChart3,
  achievements: Trophy,
};

/**
 * Боковая панель кабинета (REQ-GEN-SHELL-03): ~70 px, значки с доступными именами; активный — синяя
 * подложка и полоса слева. ≥ 768 px — «плавающая» панель под хедером, закреплённая у левого края
 * (эталоны U01–T10); на узких экранах — горизонтальная строка под хедером.
 */
export function CabinetSidebar({ items }: { items: CabinetNavItem[] }) {
  const t = useTranslations('cabinet');
  const pathname = usePathname();
  const link = (href: string, label: string, Icon: typeof BookOpen, active: boolean) => (
    <AppLink
      href={href}
      aria-label={label}
      title={label}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'relative inline-flex size-[46px] items-center justify-center rounded-[var(--radius-field)] text-[var(--text-muted)] hover:bg-[var(--field)] hover:text-[var(--text)]',
        active &&
          'bg-[var(--accent-soft)] text-[var(--accent-bright)] before:absolute before:left-1.5 before:top-3 before:h-[22px] before:w-[3px] before:rounded-full before:bg-[var(--accent-bright)] hover:bg-[var(--accent-soft)] hover:text-[var(--accent-bright)]',
      )}
    >
      <Icon aria-hidden="true" className="size-[18px]" strokeWidth={1.75} />
    </AppLink>
  );

  return (
    <nav
      aria-label={t('sidebarLabel')}
      data-testid="cabinet-sidebar"
      className="mx-2 mt-2 rounded-[14px] border border-[var(--chrome-border)] bg-[var(--sidebar)] md:fixed md:bottom-4 md:left-0 md:top-[calc(var(--header-h)+10px)] md:z-20 md:m-0 md:w-[var(--sidebar-w)] md:rounded-l-none md:border-l-0"
    >
      <ul className="flex gap-1 overflow-x-auto px-2 py-1.5 md:h-full md:flex-col md:items-center md:gap-0.5 md:overflow-y-auto md:px-0 md:py-3">
        {items.map((item) => (
          <li key={item.href}>
            {link(
              item.href,
              t(`nav.${item.key}`),
              ICONS[item.icon],
              [item.href, ...(item.also ?? [])].some((p) => pathname === p || pathname.startsWith(`${p}/`)),
            )}
          </li>
        ))}
        <li className="md:mt-auto md:w-full md:border-t md:border-[var(--chrome-border)] md:pt-3 md:text-center">
          {link('/support', t('nav.support'), LifeBuoy, false)}
        </li>
      </ul>
    </nav>
  );
}
