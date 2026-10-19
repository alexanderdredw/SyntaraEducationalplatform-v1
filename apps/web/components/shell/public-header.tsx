'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Dialog } from 'radix-ui';
import { Menu, X } from 'lucide-react';
import { type Locale } from '@syntara/shared';
import { BrandMark, Capsule, cn, Header, Wordmark } from '@syntara/ui';
import { usePathname } from '@/i18n/navigation';
import { AppLink } from '../app-link';
import { isActive, NAV_ITEMS } from './nav-items';
import { DataSaverToggle, LanguageSwitcher, ThemeToggle } from './preference-controls';

/**
 * Публичный хедер (REQ-GEN-SHELL-01) и мобильное меню (REQ-GEN-SHELL-06).
 * ≥ 1024 px: «плавающая» панель из трёх групп (UX-01): логотип / меню-капсула / капсула настроек + «Войти».
 * < 1024 px: логотип, «Войти», «Меню».
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
    <ul className={cn('flex gap-0.5', vertical ? 'flex-col' : 'items-center')}>
      {NAV_ITEMS.map((item) => {
        const active = isActive(pathname, item.href);
        return (
          <li key={item.key}>
            <AppLink
              href={item.href}
              onClick={onNavigate}
              aria-current={active ? 'page' : undefined}
              className={cn(
                vertical
                  ? 'inline-flex min-h-[var(--control-h)] w-full items-center rounded-[var(--radius-pill)] px-4 text-base'
                  : 'inline-flex min-h-11 items-center rounded-[var(--radius-pill)] px-4 text-sm',
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
      // UX-04: «Войти» открывает выбор «Как продолжить?»; форма входа — по прямой ссылке и с экранов ролей.
      href={cabinetHref ?? '/auth/start'}
      data-testid={cabinetHref ? 'header-cabinet' : 'header-login'}
      className="inline-flex min-h-[var(--control-h)] items-center rounded-[var(--radius-pill)] bg-[var(--accent-strong)] px-5 text-sm font-semibold text-white hover:brightness-110 active:scale-[0.98]"
    >
      {cabinetHref ? tFooter('cabinet') : t('login')}
    </AppLink>
  );

  return (
    <Header data-testid="public-header">
      <AppLink
        href="/"
        aria-label={t('logoLabel')}
        className="inline-flex min-h-11 shrink-0 items-center gap-2.5 rounded-[var(--radius-field)] text-xl"
      >
        <BrandMark />
        {/* < 400 px — только знак: «Войти» и «Меню» помещаются в одну строку (REQ-GEN-SHELL-06). */}
        <Wordmark className="hidden min-[400px]:inline" />
      </AppLink>

      <nav aria-label={t('navLabel')} className="hidden flex-1 justify-center lg:flex">
        <Capsule>{navLinks()}</Capsule>
      </nav>

      <div className="ml-auto flex items-center gap-2 lg:ml-0">
        <Capsule className="hidden lg:flex">
          <LanguageSwitcher enabledLocales={enabledLocales} />
          <span className="xl:hidden">
            <DataSaverToggle compact />
          </span>
          <span className="hidden xl:inline-flex">
            <DataSaverToggle />
          </span>
          <ThemeToggle />
        </Capsule>
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
    </Header>
  );
}
