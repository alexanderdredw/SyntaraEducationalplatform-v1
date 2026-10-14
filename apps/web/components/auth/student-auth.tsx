'use client';

import { useState, type ReactNode } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Eye, EyeOff, GraduationCap } from 'lucide-react';
import { LOGIN_PATTERN, type UserRole } from '@syntara/shared';
import { cn } from '@syntara/ui';
import { useRouter } from '@/i18n/navigation';
import { apiRequest } from '@/lib/api/browser';
import { HOME_BY_ROLE } from '@/lib/auth';
import type { components } from '@/lib/api/schema';
import { AppLink } from '../app-link';
import { useErrorText } from '../forms/form-parts';
import { SchoolCombobox, type SchoolValue } from './school-combobox';

type Me = components['schemas']['MeDto'];
type Tab = 'register' | 'login';
type RegisterField = 'displayName' | 'login' | 'password' | 'email' | 'school' | 'code';

const inputClass =
  'min-h-12 w-full rounded-xl border border-[var(--border)] bg-[var(--field)] px-4 text-base text-[var(--text)] placeholder:text-[var(--text-muted)] aria-[invalid=true]:border-[var(--danger)]';

/** Поле формы ученика: подпись над полем, подсказка и ошибка под ним (эталон student-auth.png). */
function FieldRow({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="text-sm text-[var(--text-muted)]">
        {label}
      </label>
      {children}
      {hint ? (
        <p id={`${id}-hint`} className="text-xs text-[var(--text-muted)]">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} className="text-xs text-[var(--danger-text)]">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function PasswordInput({
  id,
  value,
  onChange,
  autoComplete,
  invalid,
  describedBy,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete: string;
  invalid?: boolean;
  describedBy?: string;
}) {
  const t = useTranslations('studentAuth');
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <input
        id={id}
        type={visible ? 'text' : 'password'}
        className={cn(inputClass, 'pr-12')}
        value={value}
        autoComplete={autoComplete}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        onChange={(e) => onChange(e.target.value)}
      />
      <button
        type="button"
        aria-label={visible ? t('hidePassword') : t('showPassword')}
        aria-pressed={visible}
        onClick={() => setVisible((v) => !v)}
        className="absolute right-1 top-1/2 inline-flex size-11 -translate-y-1/2 items-center justify-center text-[var(--text-muted)] hover:text-[var(--text)]"
      >
        {visible ? (
          <EyeOff aria-hidden="true" className="size-4" />
        ) : (
          <Eye aria-hidden="true" className="size-4" />
        )}
      </button>
    </div>
  );
}

/**
 * Экран ученика «Вход или регистрация» (REQ-GEN-AUTH-02, эталон docs/media/student-auth.png, BR-CLS-04):
 * вкладки «Регистрация» / «Вход»; регистрация — API-AUTH-03S (код класса необязателен; верный код — сразу в
 * классе), вход — API-AUTH-01. Обращение на «ты».
 */
export function StudentAuth({
  initialCode = '',
  initialTab = 'register',
  onLoggedIn,
}: {
  initialCode?: string;
  initialTab?: Tab;
  /** Встраивание (например, на /join): что делать после входа вместо перехода в кабинет. */
  onLoggedIn?: (me: Me, via: 'register' | 'login') => void;
}) {
  const t = useTranslations('studentAuth');
  const tAuth = useTranslations('auth.login');
  const tf = useTranslations('forms');
  const errorText = useErrorText();
  const locale = useLocale();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>(initialTab);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  const [form, setForm] = useState({
    displayName: '',
    login: '',
    password: '',
    email: '',
    code: initialCode,
  });
  const [school, setSchool] = useState<SchoolValue>({ schoolId: '', schoolName: '', manual: false });
  const [errors, setErrors] = useState<Partial<Record<RegisterField, string>>>({});
  const [loginForm, setLoginForm] = useState({ email: '', password: '' });
  const [loginError, setLoginError] = useState<string | null>(null);

  const afterAuth = (me: Me, via: 'register' | 'login') => {
    if (onLoggedIn) return onLoggedIn(me, via);
    if (me.mustChangePassword) router.replace('/auth/login?change=1');
    else router.replace(HOME_BY_ROLE[me.activeRole as UserRole]);
    router.refresh();
  };

  const validate = (): Partial<Record<RegisterField, string>> => {
    const e: Partial<Record<RegisterField, string>> = {};
    if (!form.displayName.trim()) e.displayName = 'required';
    const login = form.login.trim().toLowerCase();
    if (!login) e.login = 'required';
    else if (login.includes('@')) e.login = 'loginIsEmail';
    else if (!LOGIN_PATTERN.test(login)) e.login = 'invalidLogin';
    if (form.password.length < 8) e.password = 'passwordTooShort';
    if (form.email.trim() && !/^\S+@\S+\.\S+$/.test(form.email.trim())) e.email = 'email';
    return e;
  };

  const register = async () => {
    const local = validate();
    setErrors(local);
    setFailed(null);
    if (Object.keys(local).length) {
      const first = (['displayName', 'login', 'password', 'email'] as const).find((k) => local[k]);
      if (first) document.getElementById(`student-${first}`)?.focus();
      return;
    }
    setPending(true);
    const res = await apiRequest<{ user: Me }>('/api/auth/register-student', {
      method: 'POST',
      locale,
      body: {
        displayName: form.displayName,
        login: form.login,
        password: form.password,
        email: form.email.trim(),
        code: form.code.trim(),
        ...(school.manual
          ? { schoolName: school.schoolName.trim() }
          : school.schoolId
            ? { schoolId: school.schoolId }
            : {}),
      },
    });
    setPending(false);
    if (res.kind === 'ok') return afterAuth(res.data.user, 'register');
    if (res.kind === 'http' && res.error?.fieldErrors) {
      const fe = res.error.fieldErrors;
      setErrors({
        displayName: fe.displayName,
        login: fe.login,
        password: fe.password,
        email: fe.email,
        code: fe.code,
        school: fe.schoolId ?? fe.schoolName,
      });
      return;
    }
    setFailed(res.kind === 'network' ? tf('networkError') : tf('serverError'));
  };

  const signIn = async () => {
    setLoginError(null);
    if (!loginForm.email.trim() || !loginForm.password) return setLoginError(errorText('required') ?? '');
    setPending(true);
    const res = await apiRequest<{ user: Me }>('/api/auth/login', {
      method: 'POST',
      locale,
      body: loginForm,
    });
    setPending(false);
    if (res.kind === 'ok') return afterAuth(res.data.user, 'login');
    if (res.kind === 'http' && res.status === 401) return setLoginError(tAuth('invalid'));
    setLoginError(res.kind === 'network' ? tf('networkError') : tf('serverError'));
  };

  const tabButton = (value: Tab, label: string) => (
    <button
      type="button"
      role="tab"
      id={`student-tab-${value}`}
      aria-selected={tab === value}
      aria-controls={`student-panel-${value}`}
      onClick={() => setTab(value)}
      className={cn(
        'min-h-11 flex-1 rounded-xl px-4 text-sm font-semibold',
        tab === value
          ? 'bg-[var(--accent-strong)] text-white shadow'
          : 'text-[var(--text-muted)] hover:text-[var(--text)]',
      )}
    >
      {label}
    </button>
  );

  const err = (field: RegisterField) => errorText(errors[field]);
  const describe = (id: string, hint: boolean, field: RegisterField) =>
    [hint ? `${id}-hint` : null, errors[field] ? `${id}-error` : null].filter(Boolean).join(' ') || undefined;

  return (
    <div className="mx-auto w-full max-w-[380px]" data-testid="student-auth">
      <p className="text-center text-2xl font-bold text-[var(--accent)]">Syntara</p>
      <p className="mt-3 text-center text-xs font-semibold tracking-[0.2em] text-[var(--text-muted)]">
        {t('label')}
      </p>
      <div className="mt-4 rounded-[24px] border border-[var(--border)] bg-[var(--surface)] p-5 sm:p-6">
        <div className="flex justify-center">
          <span className="inline-flex size-14 items-center justify-center rounded-2xl border border-[var(--border)] bg-[var(--field)]">
            <GraduationCap aria-hidden="true" className="size-6 text-[var(--text)]" />
          </span>
        </div>
        <h1 className="mt-4 text-center text-2xl font-bold">{t('title')}</h1>

        <div
          role="tablist"
          aria-label={t('tabsLabel')}
          className="mt-5 flex gap-1 rounded-2xl border border-[var(--border)] bg-[var(--field)] p-1"
        >
          {tabButton('register', t('tabRegister'))}
          {tabButton('login', t('tabLogin'))}
        </div>

        {tab === 'register' ? (
          <form
            id="student-panel-register"
            role="tabpanel"
            aria-labelledby="student-tab-register"
            noValidate
            className="mt-5 flex flex-col gap-5"
            onSubmit={(e) => {
              e.preventDefault();
              void register();
            }}
          >
            <FieldRow id="student-displayName" label={t('name')} error={err('displayName')}>
              <input
                id="student-displayName"
                className={inputClass}
                value={form.displayName}
                placeholder={t('namePlaceholder')}
                autoComplete="name"
                aria-required="true"
                aria-invalid={errors.displayName ? true : undefined}
                aria-describedby={describe('student-displayName', false, 'displayName')}
                onChange={(e) => setForm({ ...form, displayName: e.target.value })}
              />
            </FieldRow>
            <FieldRow id="student-login" label={t('login')} error={err('login')}>
              <input
                id="student-login"
                className={inputClass}
                value={form.login}
                autoComplete="username"
                autoCapitalize="none"
                aria-required="true"
                aria-invalid={errors.login ? true : undefined}
                aria-describedby={describe('student-login', false, 'login')}
                onChange={(e) => {
                  const login = e.target.value;
                  setForm({ ...form, login });
                  // Подсказка сразу, как только в логине появился «@» (REQ-GEN-AUTH-02).
                  setErrors((prev) => ({ ...prev, login: login.includes('@') ? 'loginIsEmail' : undefined }));
                }}
              />
            </FieldRow>
            <FieldRow
              id="student-password"
              label={t('password')}
              hint={t('passwordHint')}
              error={err('password')}
            >
              <PasswordInput
                id="student-password"
                value={form.password}
                autoComplete="new-password"
                invalid={Boolean(errors.password)}
                describedBy={describe('student-password', true, 'password')}
                onChange={(password) => setForm({ ...form, password })}
              />
            </FieldRow>
            <FieldRow id="student-email" label={t('email')} error={err('email')}>
              <input
                id="student-email"
                type="email"
                className={inputClass}
                value={form.email}
                placeholder={t('emailPlaceholder')}
                autoComplete="email"
                aria-invalid={errors.email ? true : undefined}
                aria-describedby={describe('student-email', false, 'email')}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </FieldRow>
            <div className="flex flex-col gap-2">
              <label htmlFor="student-school" className="text-sm text-[var(--text-muted)]">
                {t('school')}
              </label>
              <SchoolCombobox id="student-school" value={school} onChange={setSchool} error={err('school')} />
              {errors.school ? (
                <p id="student-school-error" className="text-xs text-[var(--danger-text)]">
                  {err('school')}
                </p>
              ) : null}
            </div>
            <FieldRow id="student-code" label={t('code')} hint={t('codeHint')} error={err('code')}>
              <input
                id="student-code"
                className={cn(inputClass, 'text-center tracking-[0.3em] uppercase')}
                value={form.code}
                placeholder={t('codePlaceholder')}
                autoComplete="off"
                autoCapitalize="characters"
                maxLength={32}
                aria-invalid={errors.code ? true : undefined}
                aria-describedby={describe('student-code', true, 'code')}
                onChange={(e) => setForm({ ...form, code: e.target.value })}
              />
            </FieldRow>

            {failed ? (
              <p role="alert" className="text-sm text-[var(--danger-text)]">
                {failed}
              </p>
            ) : null}
            <button
              type="submit"
              disabled={pending}
              className="min-h-12 w-full rounded-[var(--radius-pill)] bg-[var(--accent-strong)] text-base font-semibold text-white hover:brightness-110 disabled:opacity-60"
            >
              {t('submit')}
            </button>
          </form>
        ) : (
          <form
            id="student-panel-login"
            role="tabpanel"
            aria-labelledby="student-tab-login"
            noValidate
            className="mt-5 flex flex-col gap-5"
            onSubmit={(e) => {
              e.preventDefault();
              void signIn();
            }}
          >
            <FieldRow id="student-identifier" label={t('identifier')}>
              <input
                id="student-identifier"
                className={inputClass}
                value={loginForm.email}
                autoComplete="username"
                autoCapitalize="none"
                onChange={(e) => setLoginForm({ ...loginForm, email: e.target.value })}
              />
            </FieldRow>
            <FieldRow id="student-login-password" label={t('password')}>
              <PasswordInput
                id="student-login-password"
                value={loginForm.password}
                autoComplete="current-password"
                onChange={(password) => setLoginForm({ ...loginForm, password })}
              />
            </FieldRow>
            {loginError ? (
              <p role="alert" data-testid="student-login-error" className="text-sm text-[var(--danger-text)]">
                {loginError}
              </p>
            ) : null}
            <button
              type="submit"
              disabled={pending}
              className="min-h-12 w-full rounded-[var(--radius-pill)] bg-[var(--accent-strong)] text-base font-semibold text-white hover:brightness-110 disabled:opacity-60"
            >
              {t('loginSubmit')}
            </button>
            <AppLink
              href="/auth/login?forgot=1"
              className="self-center text-sm text-[var(--text-muted)] underline"
            >
              {t('forgotLink')}
            </AppLink>
          </form>
        )}

        <div className="mt-6 flex flex-col gap-4 text-center text-xs text-[var(--text-muted)]">
          {tab === 'register' ? (
            <p>
              {t.rich('consent', {
                terms: (chunks) => (
                  <AppLink href="/terms" className="underline hover:text-[var(--text)]">
                    {chunks}
                  </AppLink>
                ),
                privacy: (chunks) => (
                  <AppLink href="/privacy" className="underline hover:text-[var(--text)]">
                    {chunks}
                  </AppLink>
                ),
              })}
            </p>
          ) : null}
          <p>{t('accountNote')}</p>
          <p>
            {t('forgotNote')}{' '}
            <AppLink href="/auth/login?forgot=1" className="underline hover:text-[var(--text)]">
              {t('forgotLink')}
            </AppLink>
          </p>
          <AppLink
            href="/"
            data-testid="continue-as-guest"
            className="inline-flex min-h-11 items-center justify-center text-sm text-[var(--text-muted)] hover:text-[var(--text)]"
          >
            {t('guest')}
          </AppLink>
        </div>
      </div>
    </div>
  );
}
