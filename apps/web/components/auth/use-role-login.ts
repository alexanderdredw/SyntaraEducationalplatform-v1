'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { type LoginEntry, type UserRole } from '@syntara/shared';
import { useRouter } from '@/i18n/navigation';
import { apiRequest } from '@/lib/api/browser';
import { HOME_BY_ROLE, safeReturnTo } from '@/lib/auth';
import { wrongRoleOf } from './wrong-role';

type Problem = 'invalid' | 'rateLimited' | 'network' | 'server' | null;

/**
 * Вход по email и паролю (REQ-GEN-AUTH-01, API-AUTH-01) — для формы учителя и служебного входа. `entry` — роль
 * формы (BR-AUTH-01): сервер впускает только аккаунт с этой ролью, иначе — 403 и подсказка со ссылкой на нужную
 * форму. После входа — returnTo из белого списка или страница по роли; с временным паролем — смена пароля
 * (BR-CLS-05). `submit` возвращает false при ошибке (форма очищает пароль).
 */
export function useRoleLogin({ entry, returnTo }: { entry?: 'teacher'; returnTo: string | null }) {
  const t = useTranslations('auth.login');
  const tf = useTranslations('forms');
  const locale = useLocale();
  const router = useRouter();
  const [problem, setProblem] = useState<Problem>(null);
  const [wrongRole, setWrongRole] = useState<LoginEntry | null>(null);
  const [retryMinutes, setRetryMinutes] = useState(1);
  const [pending, setPending] = useState(false);

  const submit = async (values: { email: string; password: string }): Promise<boolean> => {
    setPending(true);
    setProblem(null);
    setWrongRole(null);
    const result = await apiRequest<{
      user: { roles: UserRole[]; activeRole: UserRole; mustChangePassword: boolean };
    }>('/api/auth/login', {
      method: 'POST',
      body: entry ? { ...values, role: entry } : values,
      locale,
    });
    if (result.kind === 'ok') {
      if (result.data.user.mustChangePassword) {
        router.replace('/auth/login?change=1');
        router.refresh();
        return true;
      }
      const target = safeReturnTo(returnTo);
      router.replace(target !== '/' ? target : HOME_BY_ROLE[result.data.user.activeRole]);
      router.refresh();
      return true;
    }
    setPending(false);
    const expected = wrongRoleOf(result);
    if (result.kind === 'network') setProblem('network');
    else if (result.kind === 'http' && result.status === 401) setProblem('invalid');
    else if (expected) setWrongRole(expected);
    else if (result.kind === 'http' && result.status === 429) {
      setRetryMinutes(Math.max(1, Math.ceil((result.error.retryAfterSeconds ?? 60) / 60)));
      setProblem('rateLimited');
    } else setProblem('server');
    return false;
  };

  const message =
    problem === 'invalid'
      ? t('invalid')
      : problem === 'rateLimited'
        ? t('rateLimited', { minutes: retryMinutes })
        : problem === 'network'
          ? tf('networkError')
          : problem === 'server'
            ? tf('serverError')
            : null;

  return { submit, pending, message, wrongRole };
}
