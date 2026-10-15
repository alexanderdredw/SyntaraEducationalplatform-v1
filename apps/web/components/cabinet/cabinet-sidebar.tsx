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
 * подложка и полоса слева. На узких экранах — горизонтальная строка под хедером.
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
        'relative inline-flex size-11 items-center justify-center rounded-[var(--radius-field)] text-[var(--text-muted)] hover:bg-[var(--field)] hover:text-[var(--text)]',
        active &&
          'bg-[var(--accent-strong)]/20 text-[var(--text)] before:absolute before:left-0 before:top-2 before:h-7 before:w-1 before:rounded-full before:bg-[var(--accent)]',
      )}
    >
      <Icon aria-hidden="true" className="size-5" />
    </AppLink>
  );

  return (
    <nav
      aria-label={t('sidebarLabel')}
      data-testid="cabinet-sidebar"
      className="border-b border-[var(--border)] bg-[var(--sidebar)] md:sticky md:top-[var(--header-h)] md:h-[calc(100vh-var(--header-h))] md:w-[var(--sidebar-w)] md:shrink-0 md:border-b-0 md:border-r"
    >
      <ul className="flex gap-2 overflow-x-auto px-3 py-2 md:h-full md:flex-col md:items-center md:overflow-visible md:py-4">
        {items.map((item) => (
          <li key={item.href}>
            {link(
              item.href,
              t(`nav.${item.key}`),
              ICONS[item.icon],
              pathname === item.href || pathname.startsWith(`${item.href}/`),
            )}
          </li>
        ))}
        <li className="md:mt-auto">{link('/support', t('nav.support'), LifeBuoy, false)}</li>
      </ul>
    </nav>
  );
}
