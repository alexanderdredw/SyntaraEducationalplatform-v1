import { type ReactNode } from 'react';
import { setRequestLocale } from 'next-intl/server';
import { AccountTabs } from '@/components/account/account-tabs';
import { CabinetShell } from '@/components/cabinet/cabinet-shell';
import { PublicShell } from '@/components/shell/public-shell';
import { workspaceRole } from '@/lib/auth';
import { requireUser } from '@/lib/require-user';

/**
 * /account/* (SPEC 8.7, REQ-PRF-01): у ученика и учителя — внутри рабочей среды (хедер + панель) с вкладками
 * «Обзор», «Профиль», «Настройки», «Данные». У служебных ролей — только «Мои данные» в прежней оболочке
 * (REQ-GEN-AUTH-04 без изменений). Без сессии — вход с возвратом.
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
  const me = await requireUser(locale);
  const role = workspaceRole(me);
  if (!role) {
    return (
      <PublicShell>
        <section className="px-4 py-12 md:py-16">
          <div className="mx-auto max-w-[640px]">{children}</div>
        </section>
      </PublicShell>
    );
  }
  return (
    <CabinetShell me={me} cabinetRole={role}>
      <section className="mx-auto flex max-w-[880px] flex-col gap-6 px-4 py-8">
        <AccountTabs />
        {children}
      </section>
    </CabinetShell>
  );
}
