import { type ReactNode } from 'react';
import { setRequestLocale } from 'next-intl/server';
import { CabinetShell } from '@/components/cabinet/cabinet-shell';
import { requireUser } from '@/lib/require-user';

/** Кабинет (3.3, REQ-GEN-SHELL-02..04): только роль student; без сессии — вход с возвратом. */
export default async function Layout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const me = await requireUser(locale, 'student');
  return (
    <CabinetShell me={me} cabinetRole="student">
      {children}
    </CabinetShell>
  );
}
