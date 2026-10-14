'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Button, Field, Input } from '@syntara/ui';
import { useRouter } from '@/i18n/navigation';
import { apiRequest } from '@/lib/api/browser';
import { AppLink } from '../app-link';
import { useErrorText } from '../forms/form-parts';

/** «Забыли пароль?» (API-AUTH-04): ответ всегда одинаковый — существование аккаунта не раскрывается. */
export function ForgotPasswordForm() {
  const t = useTranslations('auth.forgot');
  const tf = useTranslations('forms');
  const errorText = useErrorText();
  const locale = useLocale();
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [sent, setSent] = useState(false);
  const [failed, setFailed] = useState(false);
  const [pending, setPending] = useState(false);

  const submit = async () => {
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return setError('email');
    setError(undefined);
    setFailed(false);
    setPending(true);
    const res = await apiRequest('/api/auth/password/forgot', {
      method: 'POST',
      locale,
      body: { email: email.trim() },
    });
    setPending(false);
    if (res.kind === 'ok') setSent(true);
    else setFailed(true);
  };

  return (
    <form
      noValidate
      data-testid="forgot-form"
      className="flex flex-col gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <p className="text-[var(--text-muted)]">{t('text')}</p>
      <Field id="forgot-email" label={t('email')} required error={errorText(error)}>
        <Input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </Field>
      <p role="status" data-testid="forgot-sent">
        {sent ? t('sent') : ''}
      </p>
      {failed ? (
        <p role="alert" className="text-sm text-[var(--danger-text)]">
          {tf('serverError')}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <AppLink
          href="/auth/login"
          className="inline-flex min-h-11 items-center text-sm text-[var(--accent)] hover:underline"
        >
          {t('back')}
        </AppLink>
        <Button type="submit" disabled={pending}>
          {t('submit')}
        </Button>
      </div>
    </form>
  );
}

/** Новый пароль по ссылке из письма (API-AUTH-04): после успеха — вход с сообщением. */
export function ResetPasswordForm({ token }: { token: string }) {
  const t = useTranslations('auth.reset');
  const tForgot = useTranslations('auth.forgot');
  const tf = useTranslations('forms');
  const errorText = useErrorText();
  const locale = useLocale();
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [invalid, setInvalid] = useState(false);
  const [failed, setFailed] = useState(false);
  const [pending, setPending] = useState(false);

  const submit = async () => {
    if (password.length < 8) return setError('passwordTooShort');
    setError(undefined);
    setPending(true);
    const res = await apiRequest('/api/auth/password/reset', {
      method: 'POST',
      locale,
      body: { token, password },
    });
    setPending(false);
    if (res.kind === 'ok') {
      router.replace('/auth/login?reset=done');
      return;
    }
    if (res.kind === 'http' && res.error?.fieldErrors?.token) setInvalid(true);
    else if (res.kind === 'http' && res.error?.fieldErrors?.password)
      setError(res.error.fieldErrors.password);
    else setFailed(true);
  };

  return (
    <form
      noValidate
      data-testid="reset-form"
      className="flex flex-col gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <Field id="reset-password" label={t('password')} hint={t('hint')} required error={errorText(error)}>
        <Input
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </Field>
      {invalid ? (
        <p role="alert" className="text-sm text-[var(--danger-text)]">
          {t('invalid')}{' '}
          <AppLink href="/auth/login?forgot=1" className="text-[var(--accent)] underline">
            {tForgot('title')}
          </AppLink>
        </p>
      ) : null}
      {failed ? (
        <p role="alert" className="text-sm text-[var(--danger-text)]">
          {tf('serverError')}
        </p>
      ) : null}
      <div>
        <Button type="submit" disabled={pending}>
          {t('submit')}
        </Button>
      </div>
    </form>
  );
}
