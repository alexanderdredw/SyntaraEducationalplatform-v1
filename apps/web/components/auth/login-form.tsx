'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { LoginDto, type UserRole } from '@syntara/shared';
import { Button, Field, Input } from '@syntara/ui';
import { useRouter } from '@/i18n/navigation';
import { apiRequest } from '@/lib/api/browser';
import { HOME_BY_ROLE, safeReturnTo } from '@/lib/auth';
import { AppLink } from '../app-link';
import { useErrorText } from '../forms/form-parts';

type Values = { email: string; password: string };
type Problem = 'invalid' | 'rateLimited' | 'network' | 'server' | null;

/**
 * Вход (REQ-GEN-AUTH-01, API-AUTH-01): Email, Пароль, «Войти», «Забыли пароль?».
 * После входа — returnTo из белого списка или страница по роли. Регистрация и сброс пароля — итерация 6.
 */
export function LoginForm({ returnTo, notice }: { returnTo: string | null; notice?: string }) {
  const t = useTranslations('auth.login');
  const tf = useTranslations('forms');
  const errorText = useErrorText();
  const locale = useLocale();
  const router = useRouter();
  const [problem, setProblem] = useState<Problem>(null);
  const [retryMinutes, setRetryMinutes] = useState(1);
  const [pending, setPending] = useState(false);
  const form = useForm<Values>({
    resolver: zodResolver(LoginDto),
    defaultValues: { email: '', password: '' },
  });
  const { errors } = form.formState;

  const onSubmit = form.handleSubmit(async (values) => {
    setPending(true);
    setProblem(null);
    const result = await apiRequest<{ user: { roles: UserRole[]; activeRole: UserRole } }>(
      '/api/auth/login',
      {
        method: 'POST',
        body: values,
        locale,
      },
    );
    if (result.kind === 'ok') {
      const target = safeReturnTo(returnTo);
      router.replace(target !== '/' ? target : HOME_BY_ROLE[result.data.user.activeRole]);
      router.refresh();
      return;
    }
    setPending(false);
    form.setValue('password', '');
    if (result.kind === 'network') return setProblem('network');
    if (result.kind === 'http' && result.status === 401) return setProblem('invalid');
    if (result.kind === 'http' && result.status === 429) {
      setRetryMinutes(Math.max(1, Math.ceil((result.error.retryAfterSeconds ?? 60) / 60)));
      return setProblem('rateLimited');
    }
    setProblem('server');
  });

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

  return (
    <form noValidate onSubmit={onSubmit} data-testid="login-form" className="flex flex-col gap-5">
      {notice ? (
        <p role="status" data-testid="login-notice">
          {notice}
        </p>
      ) : null}
      <Field id="login-email" label={t('email')} required error={errorText(errors.email?.message)}>
        <Input {...form.register('email')} type="email" autoComplete="username" />
      </Field>
      <Field id="login-password" label={t('password')} required error={errorText(errors.password?.message)}>
        <Input {...form.register('password')} type="password" autoComplete="current-password" />
      </Field>
      {message ? (
        <p role="alert" data-testid="login-error" className="text-sm text-[var(--danger-text)]">
          {message}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <AppLink
          href="/auth/login?forgot=1"
          className="inline-flex min-h-11 items-center text-sm text-[var(--accent)] hover:underline"
        >
          {t('forgot')}
        </AppLink>
        <Button type="submit" disabled={pending} aria-busy={pending}>
          {t('submit')}
        </Button>
      </div>
    </form>
  );
}
