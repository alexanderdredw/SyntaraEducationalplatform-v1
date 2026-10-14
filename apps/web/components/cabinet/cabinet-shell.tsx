import { type ReactNode } from 'react';
import { cookies } from 'next/headers';
import { type Locale, type UserRole } from '@syntara/shared';
import { getMeStats, getPublicConfig, type Me } from '@/lib/api/server';
import { HOME_BY_ROLE } from '@/lib/auth';
import { FloatingHelp } from '../shell/floating-help';
import { SiteFooter } from '../shell/site-footer';
import { CabinetHeader } from './cabinet-header';
import { CabinetSidebar } from './cabinet-sidebar';
import { CABINET_NAV } from './nav';

/** Оболочка кабинетов учителя и ученика (3.3): хедер, боковая панель, футер с «Кабинет», плавающие кнопки. */
export async function CabinetShell({
  me,
  cabinetRole: role,
  children,
}: {
  me: Me;
  cabinetRole: UserRole;
  children: ReactNode;
}) {
  const config = await getPublicConfig();
  const enabledLocales: Locale[] = config?.features.enabledLocales ?? ['ru', 'kk', 'en'];
  const supportEmail = config?.supportEmail ?? null;
  const stats = role === 'student' ? await getMeStats((await cookies()).toString()) : null;
  return (
    <>
      <CabinetHeader me={me} role={role} stats={stats} enabledLocales={enabledLocales} />
      <div className="md:flex">
        <CabinetSidebar items={CABINET_NAV[role] ?? []} />
        <main id="main" tabIndex={-1} className="min-w-0 flex-1 outline-none">
          {children}
        </main>
      </div>
      <SiteFooter supportEmail={supportEmail} cabinetHref={HOME_BY_ROLE[role]} />
      <FloatingHelp supportEmail={supportEmail} lamp />
    </>
  );
}
