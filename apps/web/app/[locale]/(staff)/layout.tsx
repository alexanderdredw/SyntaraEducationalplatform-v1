import { type ReactNode } from 'react';
import { cookies, headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import { redirect } from '@/i18n/navigation';
import { getMe } from '@/lib/api/server';
import { STAFF_ROLES } from '@/lib/auth';
import { StaffShell } from '@/components/staff/staff-shell';

/**
 * Служебная поддержка (8.5, REQ-SUP-01): вход только для support_agent / onboarding_agent.
 * Без сессии — на вход с возвратом; учебные роли получают 404 (BR-ACL-04). Данные защищает api (AG-04).
 */
export default async function StaffLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const me = await getMe((await cookies()).toString());
  if (!me) {
    const path = (await headers()).get('x-pathname') ?? '/staff/tickets';
    redirect({ href: `/auth/login?returnTo=${encodeURIComponent(path)}`, locale });
    return null;
  }
  if (!me.roles.some((r) => STAFF_ROLES.includes(r))) notFound();
  return <StaffShell me={me}>{children}</StaffShell>;
}
