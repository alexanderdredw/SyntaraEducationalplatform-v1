import type { Metadata } from 'next';
import { cookies, headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { hasLocale, NextIntlClientProvider } from 'next-intl';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { type ReactNode } from 'react';
import { routing } from '@/i18n/routing';
import { Providers } from '@/components/providers';
import { PreferencesProvider } from '@/components/preferences/preferences-provider';
import { COOKIE, parseConsent, parseTheme, SIDEBAR_INIT_SCRIPT, THEME_INIT_SCRIPT } from '@/lib/preferences';
import { fontVariables } from '../fonts';
import '../globals.css';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'common' });
  return { title: t('appName'), description: t('tagline') };
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'common' });

  // REQ-GEN-PREF-03/-04: тема и экономия трафика из cookie выставляются на <html> ещё на сервере;
  // без ручного выбора тему до отрисовки ставит скрипт по prefers-color-scheme.
  const jar = await cookies();
  const theme = parseTheme(jar.get(COOKIE.theme)?.value);
  const dataSaver = jar.get(COOKIE.dataSaver)?.value === '1';
  const consent = parseConsent(jar.get(COOKIE.consent)?.value);
  const nonce = (await headers()).get('x-nonce') ?? undefined;

  return (
    <html
      lang={locale}
      className={fontVariables}
      data-theme={theme}
      data-data-saver={String(dataSaver)}
      suppressHydrationWarning
    >
      <head>
        <script
          nonce={nonce}
          suppressHydrationWarning
          dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT + SIDEBAR_INIT_SCRIPT }}
        />
      </head>
      <body>
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-[var(--radius-pill)] focus:bg-[var(--accent-strong)] focus:px-4 focus:py-2 focus:text-white"
        >
          {t('skipToContent')}
        </a>
        <NextIntlClientProvider>
          <PreferencesProvider initialTheme={theme} initialDataSaver={dataSaver} initialConsent={consent}>
            <Providers>{children}</Providers>
          </PreferencesProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
