import 'server-only';
import { cookies, headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { type UserRole } from '@syntara/shared';
import { redirect } from '@/i18n/navigation';
import { getMe, type Me } from './api/server';

/**
 * Пользователь страницы кабинета: без сессии — на /auth/login с возвратом (раздел 4), без нужной роли — 404.
 * Это только выбор отрисовки; данные защищает api (AG-04).
 */
export async function requireUser(locale: string, role?: UserRole): Promise<Me> {
  const me = await getMe((await cookies()).toString());
  if (!me) {
    const path = (await headers()).get('x-pathname') ?? '/';
    redirect({ href: `/auth/login?returnTo=${encodeURIComponent(path)}`, locale });
    throw new Error('unreachable');
  }
  if (role && !me.roles.includes(role)) notFound();
  return me;
}
