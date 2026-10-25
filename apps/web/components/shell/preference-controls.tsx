'use client';

import { useSyncExternalStore } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { usePathname, useRouter } from 'next/navigation';
import { DropdownMenu } from 'radix-ui';
import { ChevronDown, Globe, Moon, Sun, Wifi } from 'lucide-react';
import { LOCALES, type Locale } from '@syntara/shared';
import { cn, SegmentedControl } from '@syntara/ui';
import { COOKIE, writeCookie } from '@/lib/preferences';
import { syncPreferences } from '@/lib/sync-preferences';
import { usePreferences } from '../preferences/preferences-provider';

/** Фактическая тема из атрибута data-theme на <html> (его ставит скрипт до отрисовки или переключатель). */
function subscribeTheme(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  return () => observer.disconnect();
}
export function useCurrentTheme(): 'light' | 'dark' {
  return useSyncExternalStore(
    subscribeTheme,
    () => (document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark'),
    () => 'dark',
  );
}

/**
 * Капсула внутри общей группы хедера (UX-01, эталоны U01–T10): своя тонкая рамка на фоне группы;
 * 44 × 44 px (REQ-GEN-SHELL-07) — на эталонах ≈ 34 px, применён ближайший допустимый размер.
 */
export const capsuleControlClass =
  'inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-[var(--radius-pill)] border border-[var(--capsule-border)] bg-[var(--chrome)] px-3 text-[13px] text-[var(--text)] hover:border-[var(--border-strong)] hover:bg-[var(--field)]';
const controlClass = capsuleControlClass;

/**
 * Переключатель языка (REQ-GEN-PREF-01/-02): клиентская навигация на тот же путь с другим префиксом,
 * без перезагрузки; query и якорь сохраняются. Языки вне PH-04 показываются недоступными с «скоро».
 */
function useSwitchLocale() {
  const locale = useLocale() as Locale;
  const pathname = usePathname();
  const router = useRouter();
  return (next: Locale) => {
    if (next === locale) return;
    writeCookie(COOKIE.locale, next);
    syncPreferences({ locale: next });
    const rest = pathname.replace(/^\/(ru|kk|en)(?=\/|$)/, '');
    router.replace(`/${next}${rest}${window.location.search}${window.location.hash}`, { scroll: false });
  };
}

/** Языки сегментами RU / KK / EN (экран «Как продолжить?», UX-04); логика — как у LanguageSwitcher. */
export function LanguageSegments({
  enabledLocales,
  stretch = false,
  onBeforeSwitch,
}: {
  enabledLocales: readonly Locale[];
  /** На всю ширину (мобильное меню, UX-10). */
  stretch?: boolean;
  /** Вызывается перед сменой языка (мобильное меню запоминает, что его нужно снова открыть). */
  onBeforeSwitch?: () => void;
}) {
  const ts = useTranslations('shell');
  const locale = useLocale() as Locale;
  const switchTo = useSwitchLocale();
  return (
    <SegmentedControl
      label={ts('language')}
      stretch={stretch}
      value={locale}
      onValueChange={(v) => {
        if (v === locale) return;
        onBeforeSwitch?.();
        switchTo(v as Locale);
      }}
      options={LOCALES.map((code) => ({
        value: code,
        label: code.toUpperCase(),
        disabled: !enabledLocales.includes(code),
      }))}
    />
  );
}

export function LanguageSwitcher({ enabledLocales }: { enabledLocales: readonly Locale[] }) {
  const t = useTranslations('locale');
  const ts = useTranslations('shell');
  const locale = useLocale() as Locale;
  const switchTo = useSwitchLocale();

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        className={controlClass}
        aria-label={`${ts('language')}: ${t(`names.${locale}`)}`}
      >
        <Globe aria-hidden="true" className="size-4 text-[var(--text-muted)]" />
        <span className="font-semibold">{t(locale)}</span>
        <ChevronDown aria-hidden="true" className="size-3 text-[var(--text-muted)]" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={6}
          className="z-50 min-w-44 rounded-[var(--radius-field)] border border-[var(--border)] bg-[var(--capsule)] p-1 text-[var(--text)] shadow-popover"
        >
          {LOCALES.map((code) => {
            const enabled = enabledLocales.includes(code);
            return (
              <DropdownMenu.Item
                key={code}
                disabled={!enabled}
                onSelect={() => switchTo(code)}
                lang={code}
                aria-current={code === locale ? 'true' : undefined}
                className={cn(
                  'group flex min-h-11 cursor-pointer items-center gap-3 rounded-[var(--radius-item)] px-3 text-sm outline-none data-[disabled]:cursor-not-allowed data-[disabled]:opacity-60 data-[highlighted]:bg-[var(--field)]',
                  // Выбранный язык — светло-синяя заливка (эталон U09).
                  code === locale &&
                    'bg-[var(--accent-bright)] text-[#050505] data-[highlighted]:bg-[var(--accent-bright)]',
                )}
              >
                <span className="flex-1 text-[15px]">{t(`names.${code}`)}</span>
                {!enabled ? <span className="text-xs text-[var(--text-muted)]">{t('soon')}</span> : null}
                <span
                  className={cn(
                    'text-[11px] font-semibold',
                    code === locale ? 'text-[#050505]' : 'text-[var(--text-muted)]',
                  )}
                >
                  {t(code)}
                </span>
              </DropdownMenu.Item>
            );
          })}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

/** Переключатель темы (REQ-GEN-PREF-03). */
export function ThemeToggle() {
  const t = useTranslations('shell.theme');
  const { setTheme } = usePreferences();
  const current = useCurrentTheme();
  const next = current === 'dark' ? 'light' : 'dark';
  return (
    <button
      type="button"
      className={controlClass}
      onClick={() => setTheme(next)}
      aria-label={next === 'light' ? t('toLight') : t('toDark')}
      data-testid="theme-toggle"
    >
      {current === 'dark' ? (
        <Sun aria-hidden="true" className="size-4 text-[var(--text-muted)]" />
      ) : (
        <Moon aria-hidden="true" className="size-4 text-[var(--text-muted)]" />
      )}
    </button>
  );
}

/**
 * Экономия трафика (REQ-GEN-PREF-04): подпись «Экономия трафика» и статус «выключена/включена» мелким
 * приглушённым текстом (UX-01, эталоны U01–T10); доступное имя — полный текст «Экономия трафика выключена».
 * `compact` — только значок (узкие экраны).
 */
export function DataSaverToggle({ compact = false }: { compact?: boolean }) {
  const t = useTranslations('shell.dataSaver');
  const { dataSaver, setDataSaver } = usePreferences();
  const label = dataSaver ? t('on') : t('off');
  return (
    <button
      type="button"
      className={cn(controlClass, dataSaver && 'border-[var(--accent)]')}
      onClick={() => setDataSaver(!dataSaver)}
      aria-pressed={dataSaver}
      aria-label={label}
      title={compact ? label : undefined}
      data-testid="data-saver-toggle"
    >
      <Wifi aria-hidden="true" className="size-4 text-[var(--text-muted)]" />
      {compact ? null : (
        <span aria-hidden="true" className="inline-flex items-baseline gap-1.5 whitespace-nowrap">
          {t('label')}
          <span className="text-[11px] text-[var(--text-muted)]">
            {dataSaver ? t('stateOn') : t('stateOff')}
          </span>
        </span>
      )}
    </button>
  );
}

/** Круглая кнопка-значок блока «Настройки» мобильного меню (UX-10): 48 × 48 px, рамка. */
const roundControlClass =
  'inline-flex size-12 items-center justify-center rounded-full border border-[var(--capsule-border)] bg-[var(--capsule)] text-[var(--text-muted)] hover:border-[var(--border-strong)] hover:text-[var(--text)]';

/** Тема в мобильном меню (UX-10): «Тёмная тема» с aria-pressed; подсказка — текущее состояние. */
export function MenuThemeButton() {
  const t = useTranslations('shell.theme');
  const { setTheme } = usePreferences();
  const current = useCurrentTheme();
  const dark = current === 'dark';
  return (
    <button
      type="button"
      className={roundControlClass}
      onClick={() => setTheme(dark ? 'light' : 'dark')}
      aria-label={t('dark')}
      aria-pressed={dark}
      title={dark ? t('darkOn') : t('darkOff')}
      data-testid="theme-toggle"
    >
      {dark ? <Sun aria-hidden="true" className="size-5" /> : <Moon aria-hidden="true" className="size-5" />}
    </button>
  );
}

/** Экономия трафика в мобильном меню (UX-10): включённый режим — синяя рамка и значок. */
export function MenuDataSaverButton() {
  const t = useTranslations('shell.dataSaver');
  const { dataSaver, setDataSaver } = usePreferences();
  return (
    <button
      type="button"
      className={cn(
        roundControlClass,
        dataSaver && 'border-[var(--accent)] text-[var(--accent-bright)] hover:border-[var(--accent)]',
      )}
      onClick={() => setDataSaver(!dataSaver)}
      aria-label={t('label')}
      aria-pressed={dataSaver}
      title={dataSaver ? t('on') : t('off')}
      data-testid="data-saver-toggle"
    >
      <Wifi aria-hidden="true" className="size-5" />
    </button>
  );
}
