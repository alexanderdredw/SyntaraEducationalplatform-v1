import { type ReactNode } from 'react';
import { cookies } from 'next/headers';
import { type Locale } from '@syntara/shared';
import { getMeStats, getPublicConfig, type Me } from '@/lib/api/server';
import { HOME_BY_ROLE, type WorkspaceRole } from '@/lib/auth';
import { FloatingHelp } from '../shell/floating-help';
import { SiteFooter } from '../shell/site-footer';
import { CabinetHeader } from './cabinet-header';
import { CabinetSidebar } from './cabinet-sidebar';
import { CABINET_NAV } from './nav';
import { VerifyEmailBanner } from './verify-email-banner';

/**
 * Оболочка кабинетов учителя и ученика (3.3) — единая рабочая среда вошедшего (REQ-NAV-01, REQ-NAV-04): хедер,
 * панель навигации (на телефоне — меню хедера), футер с «Кабинет», плавающие кнопки. В ней же вошедший видит
 * публичные страницы и базовые уроки.
 */
export async function CabinetShell({
  me,
  cabinetRole: role,
  children,
}: {
  me: Me;
  cabinetRole: WorkspaceRole;
  children: ReactNode;
}) {
  const config = await getPublicConfig();
  const enabledLocales: Locale[] = config?.features.enabledLocales ?? ['ru', 'kk', 'en'];
  const supportEmail = config?.supportEmail ?? null;
  const stats = role === 'student' ? await getMeStats((await cookies()).toString()) : null;
  const nav = CABINET_NAV[role]!;
  return (
    <>
      <CabinetHeader me={me} role={role} stats={stats} enabledLocales={enabledLocales} nav={nav} />
      <CabinetSidebar nav={nav} />
      {/* Контент и футер — правее закреплённой панели навигации (эталоны T04, U13: футер начинается у её края). */}
      <div className="md:pl-[var(--nav-w)]">
        {role === 'teacher' && me.emailVerified === false ? <VerifyEmailBanner /> : null}
        <main id="main" tabIndex={-1} className="min-w-0 outline-none">
          {children}
        </main>
        <SiteFooter supportEmail={supportEmail} cabinetHref={HOME_BY_ROLE[role]} />
      </div>
      <FloatingHelp supportEmail={supportEmail} lamp />
    </>
  );
}
