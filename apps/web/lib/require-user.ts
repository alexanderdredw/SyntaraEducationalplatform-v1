import 'server-only';
import { cookies, headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { type UserRole } from '@syntara/shared';
import { redirect } from '@/i18n/navigation';
import { getMe, type Me } from './api/server';
import { loginEntryHref } from './auth';

/**
 * Пользователь страницы кабинета: без сессии — на /auth/login с возвратом (раздел 4), без нужной роли — 404.
 * Это только выбор отрисовки; данные защищает api (AG-04).
 */
export async function requireUser(locale: string, role?: UserRole): Promise<Me> {
  const me = await getMe((await cookies()).toString());
  if (!me) {
    const path = (await headers()).get('x-pathname') ?? '/';
    redirect({ href: loginEntryHref(path), locale });
    throw new Error('unreachable');
  }
  if (role && !me.roles.includes(role)) notFound();
  // BR-CLS-05: временный пароль от учителя нужно сменить до работы в кабинете.
  if (me.mustChangePassword) {
    redirect({ href: '/auth/login?change=1', locale });
    throw new Error('unreachable');
  }
  return me;
}
