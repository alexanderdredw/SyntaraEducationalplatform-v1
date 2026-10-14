'use client';

import { useEffect, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Button, Card, Field, Input, Modal } from '@syntara/ui';
import { useRouter } from '@/i18n/navigation';
import { apiRequest } from '@/lib/api/browser';
import { AppLink } from '../app-link';
import { useErrorText } from '../forms/form-parts';
import { usePreservedState } from '../preferences/preserved-state';

type Viewer = 'guest' | 'student' | 'other';
type Check = 'idle' | 'valid' | 'invalid' | 'tooMany' | 'error';
type Fields = 'displayName' | 'login' | 'password' | 'email';

/**
 * /join (REQ-GEN-AUTH-03, BR-CLS-02, PH-44): до входа — только проверка годности кода (API-PUB-08);
 * гостю — вход с возвратом или регистрация ученика по коду; вошедшему ученику — подтверждение
 * «Присоединиться к классу?» и API-S-01. Код хранится в памяти вкладки и переживает переход на вход.
 */
export function JoinFlow({ viewer }: { viewer: Viewer }) {
  const t = useTranslations('join');
  const th = useTranslations('help');
  const tf = useTranslations('forms');
  const errorText = useErrorText();
  const locale = useLocale();
  const router = useRouter();
  const [code, setCode] = usePreservedState('join.code', '');
  const [check, setCheck] = useState<Check>('idle');
  const [retryMinutes, setRetryMinutes] = useState(1);
  const [confirm, setConfirm] = useState(false);
  const [pending, setPending] = useState(false);
  const [form, setForm] = useState<Record<Fields, string>>({
    displayName: '',
    login: '',
    password: '',
    email: '',
  });
  const [errors, setErrors] = useState<Partial<Record<Fields, string>>>({});

  const tooMany = (seconds: number | undefined) => {
    setRetryMinutes(Math.max(1, Math.ceil((seconds ?? 60) / 60)));
    setCheck('tooMany');
  };

  const runCheck = async () => {
    if (!code.trim()) return;
    setPending(true);
    const res = await apiRequest<{ valid: boolean }>('/api/public/join/check', {
      method: 'POST',
      body: { code },
      locale,
    });
    setPending(false);
    if (res.kind === 'ok') {
      setCheck(res.data.valid ? 'valid' : 'invalid');
      if (res.data.valid && viewer === 'student') setConfirm(true);
    } else if (res.kind === 'http' && res.status === 429) tooMany(res.error.retryAfterSeconds);
    else setCheck('error');
  };

  const join = async () => {
    setPending(true);
    const res = await apiRequest('/api/student/join', { method: 'POST', body: { code }, locale });
    setPending(false);
    setConfirm(false);
    if (res.kind === 'ok') {
      setCode('');
      router.push('/learn/subjects');
    } else if (res.kind === 'http' && res.status === 404) setCheck('invalid');
    else if (res.kind === 'http' && res.status === 429) tooMany(res.error.retryAfterSeconds);
    else setCheck('error');
  };

  // REQ-GEN-AUTH-03: после входа с кодом — сразу экран подтверждения «Присоединиться к классу?».
  const autoChecked = useRef(false);
  useEffect(() => {
    if (autoChecked.current || viewer !== 'student' || !code.trim()) return;
    autoChecked.current = true;
    void runCheck();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const register = async () => {
    setPending(true);
    setErrors({});
    const res = await apiRequest('/api/auth/register-student', {
      method: 'POST',
      locale,
      body: { code, ...form, email: form.email.trim() },
    });
    setPending(false);
    if (res.kind === 'ok') {
      setCode('');
      router.replace('/learn/subjects');
      router.refresh();
      return;
    }
    if (res.kind === 'http' && res.error?.fieldErrors) {
      const fe = res.error.fieldErrors;
      if (fe.code) return setCheck('invalid');
      setErrors(
        Object.fromEntries(Object.entries(fe).filter(([k]) => k in form)) as Partial<Record<Fields, string>>,
      );
      return;
    }
    if (res.kind === 'http' && res.status === 404) return setCheck('invalid');
    if (res.kind === 'http' && res.status === 429) return tooMany(res.error.retryAfterSeconds);
    setCheck('error');
  };

  const field = (name: Fields, type = 'text', hint?: string, required = true) => (
    <Field
      id={`join-${name}`}
      label={t(`register.${name}`)}
      hint={hint}
      required={required}
      error={errorText(errors[name])}
    >
      <Input
        type={type}
        value={form[name]}
        autoComplete={
          name === 'password'
            ? 'new-password'
            : name === 'login'
              ? 'username'
              : name === 'email'
                ? 'email'
                : 'name'
        }
        onChange={(e) => setForm({ ...form, [name]: e.target.value })}
      />
    </Field>
  );

  return (
    <div className="flex flex-col gap-6" data-testid="join-flow">
      <Card>
        <form
          className="flex flex-col gap-3 sm:flex-row sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            void runCheck();
          }}
        >
          <div className="flex-1">
            <Field id="join-code" label={t('codeLabel')}>
              <Input
                value={code}
                autoComplete="off"
                autoCapitalize="characters"
                onChange={(e) => {
                  setCode(e.target.value);
                  setCheck('idle');
                }}
              />
            </Field>
          </div>
          <Button type="submit" disabled={pending || !code.trim()}>
            {t('check')}
          </Button>
        </form>

        <div className="mt-4" aria-live="polite">
          {check === 'valid' && viewer === 'guest' ? (
            <div className="flex flex-wrap items-center gap-3" data-testid="join-valid">
              <p>{t('valid')}</p>
              <AppLink
                href="/auth/login?returnTo=%2Fjoin"
                className="inline-flex min-h-11 items-center font-semibold text-[var(--accent)] hover:underline"
              >
                {t('login')}
              </AppLink>
            </div>
          ) : null}
          {check === 'valid' && viewer === 'other' ? (
            <p data-testid="join-only-students">{t('onlyStudents')}</p>
          ) : null}
          {check === 'invalid' ? (
            <div className="flex flex-wrap items-center gap-3" data-testid="join-invalid">
              <p className="text-[var(--danger-text)]">{t('invalid')}</p>
              <AppLink
                href="/support"
                className="inline-flex min-h-11 items-center text-[var(--accent)] hover:underline"
              >
                {th('supportLink')}
              </AppLink>
            </div>
          ) : null}
          {check === 'tooMany' ? (
            <p className="text-[var(--danger-text)]">{t('tooMany', { minutes: retryMinutes })}</p>
          ) : null}
          {check === 'error' ? <p className="text-[var(--danger-text)]">{tf('serverError')}</p> : null}
        </div>
      </Card>

      {check === 'valid' && viewer === 'guest' ? (
        <Card data-testid="join-register">
          <h2 className="text-xl font-semibold">{t('register.title')}</h2>
          <form
            noValidate
            className="mt-4 flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              void register();
            }}
          >
            {field('displayName')}
            {field('login', 'text', t('register.loginHint'))}
            {field('password', 'password')}
            {field('email', 'email', undefined, false)}
            <p className="text-xs text-[var(--text-muted)]">{tf('consent')}</p>
            <div>
              <Button type="submit" disabled={pending}>
                {t('register.submit')}
              </Button>
            </div>
          </form>
        </Card>
      ) : null}

      <Modal open={confirm} onOpenChange={setConfirm} title={t('confirmTitle')} closeLabel={t('cancel')}>
        <div className="flex flex-wrap justify-end gap-3">
          <Button variant="secondary" onClick={() => setConfirm(false)}>
            {t('cancel')}
          </Button>
          <Button onClick={() => void join()} disabled={pending}>
            {t('confirm')}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
