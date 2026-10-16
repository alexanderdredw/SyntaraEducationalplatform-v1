import { type ReactNode } from 'react';
import { type Locale } from '@syntara/shared';
import { cookies } from 'next/headers';
import { getMe, getPublicConfig } from '@/lib/api/server';
import { HOME_BY_ROLE } from '@/lib/auth';
import { CookieBanner } from './cookie-banner';
import { FloatingHelp } from './floating-help';
import { PublicHeader } from './public-header';
import { SiteFooter } from './site-footer';

/** Оболочка публичных страниц (3.3): хедер, контент, футер, плавающие кнопки, cookie-баннер. */
export async function PublicShell({ children }: { children: ReactNode }) {
  const config = await getPublicConfig();
  // При недоступности api доступны все языки интерфейса (PH-04 по умолчанию — ru, kk, en).
  const enabledLocales: Locale[] = config?.features.enabledLocales ?? ['ru', 'kk', 'en'];
  const supportEmail = config?.supportEmail ?? null;
  // REQ-GEN-SHELL-01: у вошедшего пользователя вместо «Войти» — «Кабинет» его активной роли.
  const me = await getMe((await cookies()).toString());
  const cabinetHref = me ? HOME_BY_ROLE[me.activeRole as keyof typeof HOME_BY_ROLE] : undefined;
  return (
    <>
      <PublicHeader enabledLocales={enabledLocales} cabinetHref={cabinetHref} />
      <main id="main" tabIndex={-1} className="outline-none">
        {children}
      </main>
      <SiteFooter supportEmail={supportEmail} />
      <FloatingHelp supportEmail={supportEmail} />
      <CookieBanner />
    </>
  );
}
