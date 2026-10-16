'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Dialog } from 'radix-ui';
import { Menu, X } from 'lucide-react';
import { type Locale } from '@syntara/shared';
import { cn } from '@syntara/ui';
import { usePathname } from '@/i18n/navigation';
import { AppLink } from '../app-link';
import { isActive, NAV_ITEMS } from './nav-items';
import { DataSaverToggle, LanguageSwitcher, ThemeToggle } from './preference-controls';

/**
 * Публичный хедер (REQ-GEN-SHELL-01) и мобильное меню (REQ-GEN-SHELL-06).
 * ≥ 1024 px: логотип, 6 пунктов меню, язык, трафик, тема, «Войти». < 1024 px: логотип, «Войти», «Меню».
 */
export function PublicHeader({
  enabledLocales,
  cabinetHref,
}: {
  enabledLocales: readonly Locale[];
  /** Вошедший пользователь: вместо «Войти» — «Кабинет» его роли (решение владельца 2026-10-16). */
  cabinetHref?: string;
}) {
  const t = useTranslations('shell');
  const tFooter = useTranslations('footer');
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);

  const navLinks = (onNavigate?: () => void, vertical = false) => (
    <ul className={cn('flex gap-1', vertical ? 'flex-col' : 'items-center')}>
      {NAV_ITEMS.map((item) => {
        const active = isActive(pathname, item.href);
        return (
          <li key={item.key}>
            <AppLink
              href={item.href}
              onClick={onNavigate}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'inline-flex min-h-[var(--control-h)] items-center rounded-[var(--radius-pill)] px-4 text-sm',
                vertical && 'w-full text-base',
                active
                  ? 'bg-[var(--text)] text-[var(--bg)]'
                  : 'text-[var(--text-muted)] hover:bg-[var(--field)] hover:text-[var(--text)]',
              )}
            >
              {t(`nav.${item.key}`)}
            </AppLink>
          </li>
        );
      })}
    </ul>
  );

  const loginButton = (
    <AppLink
      href={cabinetHref ?? '/auth/login'}
      data-testid={cabinetHref ? 'header-cabinet' : 'header-login'}
      className="inline-flex min-h-[var(--control-h)] items-center rounded-[var(--radius-pill)] bg-[var(--accent-strong)] px-5 text-sm font-semibold text-white shadow-accent hover:brightness-110 active:scale-[0.98]"
    >
      {cabinetHref ? tFooter('cabinet') : t('login')}
    </AppLink>
  );

  return (
    <header
      data-testid="public-header"
      className="sticky top-0 z-30 border-b border-[var(--border)] bg-[var(--bg)]/95 backdrop-blur"
    >
      <div className="mx-auto flex min-h-[var(--header-h)] max-w-[1600px] items-center gap-4 px-4">
        <AppLink
          href="/"
          aria-label={t('logoLabel')}
          className="inline-flex min-h-11 shrink-0 items-center text-xl font-bold tracking-tight"
        >
          Syntara
        </AppLink>

        <nav aria-label={t('navLabel')} className="hidden flex-1 justify-center lg:flex">
          {navLinks()}
        </nav>

        <div className="ml-auto flex items-center gap-2 lg:ml-0">
          <div className="hidden items-center gap-2 lg:flex">
            <LanguageSwitcher enabledLocales={enabledLocales} />
            <span className="xl:hidden">
              <DataSaverToggle compact />
            </span>
            <span className="hidden xl:inline-flex">
              <DataSaverToggle />
            </span>
            <ThemeToggle />
          </div>
          {loginButton}
          <Dialog.Root open={menuOpen} onOpenChange={setMenuOpen}>
            <Dialog.Trigger className="inline-flex min-h-[var(--control-h)] items-center gap-2 rounded-[var(--radius-pill)] border border-[var(--border)] px-4 text-sm hover:border-[var(--border-strong)] hover:bg-[var(--field)] lg:hidden">
              <Menu aria-hidden="true" className="size-4 text-[var(--accent)]" />
              {t('menu')}
            </Dialog.Trigger>
            <Dialog.Portal>
              <Dialog.Overlay className="fixed inset-0 z-40 bg-black/60 lg:hidden" />
              <Dialog.Content
                aria-describedby={undefined}
                className="fixed inset-y-0 right-0 z-50 flex w-[min(100vw,360px)] flex-col gap-6 overflow-y-auto border-l border-[var(--border)] bg-[var(--bg)] p-4 text-[var(--text)] lg:hidden"
              >
                <div className="flex items-center justify-between">
                  <Dialog.Title className="text-lg font-semibold">{t('menu')}</Dialog.Title>
                  <Dialog.Close
                    aria-label={t('closeMenu')}
                    className="inline-flex size-11 items-center justify-center rounded-full border border-[var(--border)] hover:border-[var(--border-strong)] hover:bg-[var(--field)]"
                  >
                    <X aria-hidden="true" className="size-5" />
                  </Dialog.Close>
                </div>
                <nav aria-label={t('navLabel')}>{navLinks(() => setMenuOpen(false), true)}</nav>
                <div className="flex flex-wrap items-center gap-2">
                  <LanguageSwitcher enabledLocales={enabledLocales} />
                  <ThemeToggle />
                  <DataSaverToggle />
                </div>
              </Dialog.Content>
            </Dialog.Portal>
          </Dialog.Root>
        </div>
      </div>
    </header>
  );
}
