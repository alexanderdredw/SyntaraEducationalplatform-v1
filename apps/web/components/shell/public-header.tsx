'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { type Locale } from '@syntara/shared';
import { BrandMark, Capsule, cn, Header, Wordmark } from '@syntara/ui';
import { usePathname } from '@/i18n/navigation';
import { AppLink } from '../app-link';
import { ActiveRowMark, MenuSection, menuRowClass, MobileMenu } from './mobile-menu';
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
  // Флаг сбрасывается после монтирования, а не при рендере: прерванный рендер (переход) не должен его «съесть».
  const [reopened] = useState(() => reopenMenuAfterLocaleSwitch);
  useEffect(() => {
    reopenMenuAfterLocaleSwitch = false;
  }, []);
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
              className={menuRowClass(active)}
            >
              {active ? <ActiveRowMark /> : null}
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
        <MobileMenu
          open={menuOpen}
          onOpenChange={setMenuOpen}
          label={t('menu')}
          closeLabel={t('closeMenu')}
          hiddenFrom="lg"
          logo={logo}
          actions={loginButton(false)}
          // UX-10, п. 13: при открытии фокус — на первый пункт; при закрытии Radix возвращает его на кнопку меню.
          // После смены языка фокус остаётся на выбранном языке.
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            const language = reopened
              ? languageRef.current?.querySelector<HTMLElement>('[data-state="on"]')
              : null;
            (language ?? firstItemRef.current)?.focus();
          }}
        >
          <nav aria-label={t('navLabel')}>{mobileLinks}</nav>
          <hr className="border-[var(--border)]" />
          <MenuSection ref={languageRef} id="mobile-menu-language" title={t('language')}>
            <LanguageSegments
              enabledLocales={enabledLocales}
              stretch
              onBeforeSwitch={() => {
                reopenMenuAfterLocaleSwitch = true;
              }}
            />
          </MenuSection>
          <hr className="border-[var(--border)]" />
          <MenuSection id="mobile-menu-settings" title={t('settings')}>
            <div className="flex items-center gap-3">
              <MenuThemeButton />
              <MenuDataSaverButton />
            </div>
          </MenuSection>
        </MobileMenu>
      </div>
    </Header>
  );
}
