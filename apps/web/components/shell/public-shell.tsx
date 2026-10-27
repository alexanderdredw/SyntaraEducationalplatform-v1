import { type ReactNode } from 'react';
import { type Locale } from '@syntara/shared';
import { cookies } from 'next/headers';
import { getMe, getPublicConfig } from '@/lib/api/server';
import { HOME_BY_ROLE, workspaceRole } from '@/lib/auth';
import { CabinetShell } from '../cabinet/cabinet-shell';
import { CookieBanner } from './cookie-banner';
import { FloatingHelp } from './floating-help';
import { PublicHeader } from './public-header';
import { SiteFooter } from './site-footer';

/**
 * Оболочка публичных страниц (3.3): хедер, контент, футер, плавающие кнопки, cookie-баннер.
 * REQ-NAV-04: вошедшие ученик и учитель видят те же страницы внутри рабочей среды — в оболочке своего кабинета
 * (хедер кабинета и панель навигации), без выхода из аккаунта.
 */
export async function PublicShell({ children }: { children: ReactNode }) {
  const me = await getMe((await cookies()).toString());
  const role = workspaceRole(me);
  if (me && role) {
    return (
      <CabinetShell me={me} cabinetRole={role}>
        {children}
      </CabinetShell>
    );
  }
  const config = await getPublicConfig();
  // При недоступности api доступны все языки интерфейса (PH-04 по умолчанию — ru, kk, en).
  const enabledLocales: Locale[] = config?.features.enabledLocales ?? ['ru', 'kk', 'en'];
  const supportEmail = config?.supportEmail ?? null;
  // REQ-GEN-SHELL-01: у вошедшего пользователя служебной роли вместо «Войти» — «Кабинет» его роли.
  const cabinetHref = me ? HOME_BY_ROLE[me.activeRole as keyof typeof HOME_BY_ROLE] : undefined;
  // Футер всегда внизу: при коротком содержимом прижат к низу окна (основной блок растягивается), при длинном —
  // после содержимого. Не fixed/sticky — не перекрывает контент и экранную клавиатуру.
  return (
    <div className="flex min-h-dvh flex-col">
      <PublicHeader enabledLocales={enabledLocales} cabinetHref={cabinetHref} />
      {/* REQ-GEN-SHELL-04: на телефоне — место под плавающими кнопками в конце содержимого. */}
      <main id="main" tabIndex={-1} className="flex-1 outline-none max-md:pb-20">
        {children}
      </main>
      <SiteFooter supportEmail={supportEmail} />
      <FloatingHelp supportEmail={supportEmail} />
      <CookieBanner />
    </div>
  );
}
