import { type ReactNode } from 'react';
import { cookies } from 'next/headers';
import { getLocale } from 'next-intl/server';
import { HydrationBoundary } from '@tanstack/react-query';
import { type Locale } from '@syntara/shared';
import { prefetchState } from '@/lib/api/prefetch';
import { getMeStats, getPublicConfig, type Me } from '@/lib/api/server';
import { HOME_BY_ROLE, type WorkspaceRole } from '@/lib/auth';
import { CLASS_OVERVIEW_KEY, NAV_BADGES_KEY } from '../learn/query-keys';
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
  const student = role === 'student';
  const locale = await getLocale();
  // OPT-05 (О4-2): у ученика «Мой класс» и счётчики панели (API-S-19, API-S-20) — уже в HTML, без запроса после JS.
  const [config, stats, state] = await Promise.all([
    getPublicConfig(),
    student ? getMeStats((await cookies()).toString()) : null,
    student
      ? prefetchState(locale, [
          { key: [...CLASS_OVERVIEW_KEY, locale], path: '/api/student/class/overview' },
          { key: NAV_BADGES_KEY, path: '/api/student/nav-badges' },
        ])
      : undefined,
  ]);
  const enabledLocales: Locale[] = config?.features.enabledLocales ?? ['ru', 'kk', 'en'];
  const supportEmail = config?.supportEmail ?? null;
  const nav = CABINET_NAV[role]!;
  // Футер всегда внизу: при коротком содержимом прижат к низу окна (колонка контента растягивается под хедером),
  // при длинном — после содержимого. Не fixed/sticky — не перекрывает контент и экранную клавиатуру.
  return (
    <HydrationBoundary state={state}>
      <div className="flex min-h-dvh flex-col">
        <CabinetHeader me={me} role={role} stats={stats} enabledLocales={enabledLocales} nav={nav} />
        <CabinetSidebar nav={nav} role={role} profile={{ name: me.displayName, avatar: me.avatar }} />
        {/* Контент и футер — правее закреплённой панели навигации (эталоны T04, U13: футер начинается у её края). */}
        <div className="flex flex-1 flex-col md:pl-[calc(var(--nav-w)+1rem)]">
          {role === 'teacher' && me.emailVerified === false ? <VerifyEmailBanner /> : null}
          {/* REQ-GEN-SHELL-04: на телефоне — место под плавающими кнопками в конце содержимого. */}
          <main id="main" tabIndex={-1} className="min-w-0 flex-1 outline-none max-md:pb-20">
            {children}
          </main>
          <SiteFooter supportEmail={supportEmail} cabinetHref={HOME_BY_ROLE[role]} />
        </div>
        <FloatingHelp supportEmail={supportEmail} lamp />
      </div>
    </HydrationBoundary>
  );
}
