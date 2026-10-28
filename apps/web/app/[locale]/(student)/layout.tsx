import { type ReactNode } from 'react';
import { cookies, headers } from 'next/headers';
import { setRequestLocale } from 'next-intl/server';
import { CabinetShell } from '@/components/cabinet/cabinet-shell';
import { LearnViewerProvider } from '@/components/learn/viewer';
import { PublicShell } from '@/components/shell/public-shell';
import { getMe } from '@/lib/api/server';
import { type UserRole } from '@syntara/shared';
import { HOME_BY_ROLE, isGuestLearnPath, workspaceRole } from '@/lib/auth';
import { requireUser } from '@/lib/require-user';

/**
 * Кабинет ученика (3.3, REQ-GEN-SHELL-02..04): только роль student; без сессии — вход с возвратом. Исключение —
 * каталог и уроки базовой программы: гость видит их в публичной оболочке (BR-VIS-04, REQ-ST-LES-06).
 */
export default async function Layout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const path = (await headers()).get('x-pathname') ?? '/';
  if (isGuestLearnPath(path)) {
    const me = await getMe((await cookies()).toString());
    // REQ-NAV-04: каталог и «Обзор» базовых уроков открываются у вошедшего без роли ученика (учитель) как у гостя
    // (BR-VIS-04), но внутри его рабочей среды; без входа — в публичной оболочке.
    if (!me?.roles.includes('student')) {
      const role = workspaceRole(me);
      const cabinetHref = me ? HOME_BY_ROLE[me.activeRole as UserRole] : undefined;
      return me && role ? (
        <CabinetShell me={me} cabinetRole={role}>
          <LearnViewerProvider guest cabinetHref={cabinetHref} teacher={me.activeRole === 'teacher'}>
            {children}
          </LearnViewerProvider>
        </CabinetShell>
      ) : (
        <PublicShell>
          <LearnViewerProvider guest cabinetHref={cabinetHref}>
            {children}
          </LearnViewerProvider>
        </PublicShell>
      );
    }
  }
  const me = await requireUser(locale, 'student');
  return (
    <CabinetShell me={me} cabinetRole="student">
      <LearnViewerProvider guest={false}>{children}</LearnViewerProvider>
    </CabinetShell>
  );
}
