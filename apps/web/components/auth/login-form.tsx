'use client';

import { useTranslations } from 'next-intl';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { LoginDto } from '@syntara/shared';
import { Button, Field, Input } from '@syntara/ui';
import { AppLink } from '../app-link';
import { useErrorText } from '../forms/form-parts';
import { useRoleLogin } from './use-role-login';
import { WrongRoleMessage } from './wrong-role';

type Values = { email: string; password: string };

/**
 * Вход (REQ-GEN-AUTH-01, API-AUTH-01): Email, Пароль, «Войти», «Забыли пароль?». `entry` — форма «Я учитель»
 * (BR-AUTH-01, после подтверждения email); без `entry` — служебный вход сотрудников (как раньше). Основная форма
 * учителя — вкладка «Вход» карточки TeacherAuth.
 */
export function LoginForm({
  returnTo,
  notice,
  entry,
}: {
  returnTo: string | null;
  notice?: string;
  entry?: 'teacher';
}) {
  const t = useTranslations('auth.login');
  const errorText = useErrorText();
  const login = useRoleLogin({ entry, returnTo });
  const form = useForm<Values>({
    resolver: zodResolver(LoginDto),
    defaultValues: { email: '', password: '' },
  });
  const { errors } = form.formState;

  const onSubmit = form.handleSubmit(async (values) => {
    if (!(await login.submit(values))) form.setValue('password', '');
  });

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
      {login.message ? (
        <p role="alert" data-testid="login-error" className="text-sm text-[var(--danger-text)]">
          {login.message}
        </p>
      ) : null}
      {login.wrongRole ? (
        <WrongRoleMessage expected={login.wrongRole} returnTo={returnTo} testId="login-wrong-role" />
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <AppLink
          href="/auth/login?forgot=1"
          className="inline-flex min-h-11 items-center text-sm text-[var(--accent)] hover:underline"
        >
          {t('forgot')}
        </AppLink>
        <Button type="submit" disabled={login.pending} aria-busy={login.pending}>
          {t('submit')}
        </Button>
      </div>
    </form>
  );
}
