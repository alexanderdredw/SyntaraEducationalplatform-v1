'use client';

import { useSyncExternalStore } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { usePathname, useRouter } from 'next/navigation';
import { DropdownMenu } from 'radix-ui';
import { Check, ChevronDown, Gauge, Languages, Moon, Sun } from 'lucide-react';
import { LOCALES, type Locale } from '@syntara/shared';
import { cn } from '@syntara/ui';
import { COOKIE, writeCookie } from '@/lib/preferences';
import { syncPreferences } from '@/lib/sync-preferences';
import { usePreferences } from '../preferences/preferences-provider';

/** Фактическая тема из атрибута data-theme на <html> (его ставит скрипт до отрисовки или переключатель). */
function subscribeTheme(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  return () => observer.disconnect();
}
function useCurrentTheme(): 'light' | 'dark' {
  return useSyncExternalStore(
    subscribeTheme,
    () => (document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark'),
    () => 'dark',
  );
}

const controlClass =
  'inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-[var(--radius-pill)] border border-[var(--border)] px-3 text-sm text-[var(--text)] hover:bg-[var(--field)]';

/**
 * Переключатель языка (REQ-GEN-PREF-01/-02): клиентская навигация на тот же путь с другим префиксом,
 * без перезагрузки; query и якорь сохраняются. Языки вне PH-04 показываются недоступными с «скоро».
 */
export function LanguageSwitcher({ enabledLocales }: { enabledLocales: readonly Locale[] }) {
  const t = useTranslations('locale');
  const ts = useTranslations('shell');
  const locale = useLocale() as Locale;
  const pathname = usePathname();
  const router = useRouter();

  const switchTo = (next: Locale) => {
    if (next === locale) return;
    writeCookie(COOKIE.locale, next);
    syncPreferences({ locale: next });
    const rest = pathname.replace(/^\/(ru|kk|en)(?=\/|$)/, '');
    router.replace(`/${next}${rest}${window.location.search}${window.location.hash}`, { scroll: false });
  };

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        className={controlClass}
        aria-label={`${ts('language')}: ${t(`names.${locale}`)}`}
      >
        <Languages aria-hidden="true" className="size-4 text-[var(--accent)]" />
        <span>{t(locale)}</span>
        <ChevronDown aria-hidden="true" className="size-3" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={6}
          className="z-50 min-w-44 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-1 text-[var(--text)]"
        >
          {LOCALES.map((code) => {
            const enabled = enabledLocales.includes(code);
            return (
              <DropdownMenu.Item
                key={code}
                disabled={!enabled}
                onSelect={() => switchTo(code)}
                lang={code}
                className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-3 text-sm outline-none data-[disabled]:cursor-not-allowed data-[disabled]:opacity-60 data-[highlighted]:bg-[var(--field)]"
              >
                <span className="w-6 font-semibold">{t(code)}</span>
                <span className="flex-1">{t(`names.${code}`)}</span>
                {!enabled ? <span className="text-xs text-[var(--text-muted)]">{t('soon')}</span> : null}
                {code === locale ? (
                  <Check aria-hidden="true" className="size-4 text-[var(--accent)]" />
                ) : null}
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
        <Sun aria-hidden="true" className="size-4 text-[var(--accent)]" />
      ) : (
        <Moon aria-hidden="true" className="size-4 text-[var(--accent)]" />
      )}
    </button>
  );
}

/** Экономия трафика (REQ-GEN-PREF-04): подпись «Экономия трафика выключена/включена». */
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
      aria-label={compact ? label : undefined}
      title={compact ? label : undefined}
      data-testid="data-saver-toggle"
    >
      <Gauge aria-hidden="true" className="size-4 text-[var(--accent)]" />
      {compact ? null : <span className="text-xs">{label}</span>}
    </button>
  );
}
