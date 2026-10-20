'use client';

import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Dialog } from 'radix-ui';
import { Menu, X } from 'lucide-react';
import { type Locale } from '@syntara/shared';
import { BrandMark, Capsule, cn, Header, HeaderBar, Wordmark } from '@syntara/ui';
import { usePathname } from '@/i18n/navigation';
import { AppLink } from '../app-link';
import { isActive, NAV_ITEMS } from './nav-items';
import {
  DataSaverToggle,
  LanguageSegments,
  LanguageSwitcher,
  MenuDataSaverButton,
  MenuThemeButton,
  ThemeToggle,
} from './preference-controls';

/**
 * Смена языка перемонтирует оболочку (сегмент [locale]), а меню должно остаться открытым (UX-10, п. 7):
 * флаг живёт в памяти вкладки до следующего монтирования хедера.
 */
let reopenMenuAfterLocaleSwitch = false;

/** Круглая кнопка меню 44 × 44 px с рамкой (UX-10). */
const menuButtonClass =
  'inline-flex size-11 shrink-0 items-center justify-center rounded-full border border-[var(--capsule-border)] bg-[var(--capsule)] text-[var(--text)] hover:border-[var(--border-strong)] hover:bg-[var(--field)]';

/**
 * Публичный хедер (REQ-GEN-SHELL-01) и мобильное меню (REQ-GEN-SHELL-06, UX-10).
 * ≥ 1024 px: «плавающая» панель из трёх групп (UX-01): логотип / меню-капсула / капсула настроек + «Войти».
 * < 1024 px: логотип, «Войти», круглая кнопка меню; меню — панель под верхней капсулой: пункты, язык, настройки.
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
  const [reopened] = useState(() => {
    const value = reopenMenuAfterLocaleSwitch;
    reopenMenuAfterLocaleSwitch = false;
    return value;
  });
  const [menuOpen, setMenuOpen] = useState(reopened);
  const firstItemRef = useRef<HTMLAnchorElement>(null);
  const languageRef = useRef<HTMLElement>(null);

  const desktopLinks = (
    <ul className="flex items-center gap-0.5">
      {NAV_ITEMS.map((item) => {
        const active = isActive(pathname, item.href);
        return (
          <li key={item.key}>
            <AppLink
              href={item.href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'inline-flex min-h-11 items-center rounded-[var(--radius-pill)] px-4 text-sm',
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

  // UX-10, п. 5: строки на всю ширину ≥ 48 px; активная — синеватый фон и рамка, полоса-индикатор слева.
  const mobileLinks = (
    <ul className="flex flex-col gap-2">
      {NAV_ITEMS.map((item, index) => {
        const active = isActive(pathname, item.href);
        return (
          <li key={item.key}>
            <AppLink
              ref={index === 0 ? firstItemRef : undefined}
              href={item.href}
              onClick={() => setMenuOpen(false)}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'relative flex min-h-12 w-full items-center rounded-[14px] border px-4 text-[17px] font-semibold',
                active
                  ? 'border-[color-mix(in_srgb,var(--accent)_45%,transparent)] bg-[color-mix(in_srgb,var(--accent)_14%,var(--surface))] font-bold text-[var(--text)]'
                  : 'border-[var(--capsule-border)] bg-[var(--capsule)] text-[color-mix(in_srgb,var(--text)_80%,transparent)] hover:border-[var(--border-strong)] hover:text-[var(--text)]',
              )}
            >
              {active ? (
                <span
                  aria-hidden="true"
                  className="absolute top-1/2 left-1.5 h-5 w-[3px] -translate-y-1/2 rounded-full bg-[var(--accent-bright)]"
                />
              ) : null}
              {t(`nav.${item.key}`)}
            </AppLink>
          </li>
        );
      })}
    </ul>
  );

  const loginButton = (testId: boolean) => (
    <AppLink
      // UX-04: «Войти» открывает выбор «Как продолжить?»; форма входа — по прямой ссылке и с экранов ролей.
      href={cabinetHref ?? '/auth/start'}
      data-testid={testId ? (cabinetHref ? 'header-cabinet' : 'header-login') : undefined}
      onClick={() => setMenuOpen(false)}
      className="inline-flex min-h-[var(--control-h)] items-center rounded-[var(--radius-pill)] bg-[var(--accent-strong)] px-5 text-sm font-semibold text-white hover:brightness-110 active:scale-[0.98]"
    >
      {cabinetHref ? tFooter('cabinet') : t('login')}
    </AppLink>
  );

  const logo = (
    <AppLink
      href="/"
      aria-label={t('logoLabel')}
      onClick={() => setMenuOpen(false)}
      className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-2.5 rounded-[var(--radius-field)] text-xl"
    >
      <BrandMark />
      {/* < 360 px — только знак: «Войти» и кнопка меню помещаются в одну строку (REQ-GEN-SHELL-06). */}
      <Wordmark className="hidden min-[360px]:inline" />
    </AppLink>
  );

  return (
    <Header data-testid="public-header">
      {logo}

      <nav aria-label={t('navLabel')} className="hidden flex-1 justify-center lg:flex">
        <Capsule>{desktopLinks}</Capsule>
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
        {loginButton(true)}
        <Dialog.Root open={menuOpen} onOpenChange={setMenuOpen}>
          <Dialog.Trigger aria-label={t('menu')} className={cn(menuButtonClass, 'lg:hidden')}>
            <Menu aria-hidden="true" className="size-5" />
          </Dialog.Trigger>
          <Dialog.Portal>
            <Dialog.Overlay className="mobile-menu-overlay fixed inset-0 z-40 bg-black/55 lg:hidden" />
            <Dialog.Content
              aria-describedby={undefined}
              // UX-10, п. 13: при открытии фокус — на первый пункт; при закрытии Radix возвращает его на кнопку меню.
              // После смены языка фокус остаётся на выбранном языке.
              onOpenAutoFocus={(event) => {
                event.preventDefault();
                const language = reopened
                  ? languageRef.current?.querySelector<HTMLElement>('[data-state="on"]')
                  : null;
                (language ?? firstItemRef.current)?.focus();
              }}
              // Обёртка «прозрачна» для нажатий (важнее встроенного стиля Radix): нажатие между капсулой и панелью
              // попадает на подложку — это нажатие вне панели (UX-10, п. 12).
              className="pointer-events-none! fixed inset-0 z-50 flex flex-col px-2 pt-2.5 pb-3 text-[var(--text)] sm:px-4 lg:hidden"
            >
              <Dialog.Title className="sr-only">{t('menu')}</Dialog.Title>
              <HeaderBar className="pointer-events-auto">
                {logo}
                <div className="ml-auto flex items-center gap-2">
                  {loginButton(false)}
                  <Dialog.Close aria-label={t('closeMenu')} className={menuButtonClass}>
                    <X aria-hidden="true" className="size-5" />
                  </Dialog.Close>
                </div>
              </HeaderBar>
              {/* п. 10: прокручивается только панель; прокрутку страницы блокирует Radix Dialog. */}
              <div
                data-testid="mobile-menu-panel"
                className="mobile-menu-panel pointer-events-auto mx-1 mt-2 flex min-h-0 flex-col gap-4 overflow-y-auto overscroll-contain rounded-[24px] border border-[var(--border)] bg-[var(--surface)] px-3 pt-2.5 pb-4 shadow-popover"
              >
                <span
                  aria-hidden="true"
                  className="mx-auto h-1 w-8 shrink-0 rounded-full bg-[var(--border-strong)]"
                />
                <nav aria-label={t('navLabel')}>{mobileLinks}</nav>
                <hr className="border-[var(--border)]" />
                <section
                  ref={languageRef}
                  aria-labelledby="mobile-menu-language"
                  className="flex flex-col gap-2.5 px-1"
                >
                  <h2
                    id="mobile-menu-language"
                    className="text-xs font-semibold tracking-[0.12em] text-[var(--text-muted)] uppercase"
                  >
                    {t('language')}
                  </h2>
                  <LanguageSegments
                    enabledLocales={enabledLocales}
                    stretch
                    onBeforeSwitch={() => {
                      reopenMenuAfterLocaleSwitch = true;
                    }}
                  />
                </section>
                <hr className="border-[var(--border)]" />
                <section aria-labelledby="mobile-menu-settings" className="flex flex-col gap-2.5 px-1">
                  <h2
                    id="mobile-menu-settings"
                    className="text-xs font-semibold tracking-[0.12em] text-[var(--text-muted)] uppercase"
                  >
                    {t('settings')}
                  </h2>
                  <div className="flex items-center gap-3">
                    <MenuThemeButton />
                    <MenuDataSaverButton />
                  </div>
                </section>
              </div>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
      </div>
    </Header>
  );
}
