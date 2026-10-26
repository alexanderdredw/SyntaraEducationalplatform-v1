'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { GraduationCap, Users } from 'lucide-react';
import { type LoginEntry, LOGIN_PATTERN, type UserRole } from '@syntara/shared';
import { cn } from '@syntara/ui';
import { useRouter } from '@/i18n/navigation';
import { apiRequest } from '@/lib/api/browser';
import { HOME_BY_ROLE, safeReturnTo } from '@/lib/auth';
import type { components } from '@/lib/api/schema';
import { AppLink } from '../app-link';
import { useErrorText } from '../forms/form-parts';
import {
  AuthCard,
  AuthConsent,
  AuthPanel,
  type AuthTab,
  authInputClass as inputClass,
  FieldRow,
  PasswordInput,
  SubmitButton,
} from './auth-card';
import { SchoolCombobox, type SchoolValue } from './school-combobox';
import { WrongRoleMessage, wrongRoleOf } from './wrong-role';

type Me = components['schemas']['MeDto'];
type Tab = AuthTab;
type RegisterField = 'displayName' | 'login' | 'password' | 'email' | 'school' | 'code';

/**
 * Экран ученика «Вход или регистрация» (REQ-GEN-AUTH-02, эталон docs/media/student-auth.png, BR-CLS-04):
 * вкладки «Регистрация» / «Вход»; регистрация — API-AUTH-03S (код класса необязателен; верный код — сразу в
 * классе), вход — API-AUTH-01. Обращение на «ты».
 */
export function StudentAuth({
  initialCode = '',
  initialTab = 'register',
  onLoggedIn,
  returnTo = null,
}: {
  initialCode?: string;
  initialTab?: Tab;
  /** Встраивание (например, на /join): что делать после входа вместо перехода в кабинет. */
  onLoggedIn?: (me: Me, via: 'register' | 'login') => void;
  /** Куда вернуться после входа (раздел 4: только внутренний путь из белого списка). */
  returnTo?: string | null;
}) {
  const t = useTranslations('studentAuth');
  const tj = useTranslations('join');
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
  const [wrongRole, setWrongRole] = useState<LoginEntry | null>(null);

  const afterAuth = (me: Me, via: 'register' | 'login') => {
    if (onLoggedIn) return onLoggedIn(me, via);
    const target = safeReturnTo(returnTo);
    if (me.mustChangePassword) router.replace('/auth/login?change=1');
    else router.replace(target !== '/' ? target : HOME_BY_ROLE[me.activeRole as UserRole]);
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
    setWrongRole(null);
    if (!loginForm.email.trim() || !loginForm.password) return setLoginError(errorText('required') ?? '');
    setPending(true);
    const res = await apiRequest<{ user: Me }>('/api/auth/login', {
      method: 'POST',
      locale,
      // BR-AUTH-01: форма «Я ученик» впускает только аккаунт ученика.
      body: { ...loginForm, role: 'student' },
    });
    setPending(false);
    if (res.kind === 'ok') return afterAuth(res.data.user, 'login');
    if (res.kind === 'http' && res.status === 401) return setLoginError(tAuth('invalid'));
    const expected = wrongRoleOf(res);
    if (expected) return setWrongRole(expected);
    setLoginError(res.kind === 'network' ? tf('networkError') : tf('serverError'));
  };

  const err = (field: RegisterField) => errorText(errors[field]);
  const describe = (id: string, hint: boolean, field: RegisterField) =>
    [hint ? `${id}-hint` : null, errors[field] ? `${id}-error` : null].filter(Boolean).join(' ') || undefined;

  return (
    <AuthCard
      ns="studentAuth"
      prefix="student"
      icon={<GraduationCap aria-hidden="true" />}
      tab={tab}
      onTab={setTab}
      footer={
        <>
          {tab === 'register' ? <AuthConsent ns="studentAuth" /> : null}
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
        </>
      }
    >
      {tab === 'register' ? (
        <AuthPanel prefix="student" tab="register" onSubmit={() => void register()}>
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
              ns="studentAuth"
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
          <FieldRow
            id="student-code"
            label={t('code')}
            hint={t('codeHint')}
            icon={<Users aria-hidden="true" className="size-4" />}
            error={
              // BR-CODE-04: код Battle в поле «Код класса» — подсказка со ссылкой на вход ученика.
              errors.code === 'isBattleCode'
                ? tj.rich('isBattleCode', {
                    link: (chunks) => (
                      <AppLink href="/auth/start?role=student" className="font-semibold underline">
                        {chunks}
                      </AppLink>
                    ),
                  })
                : err('code')
            }
          >
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
          <SubmitButton pending={pending}>{t('submit')}</SubmitButton>
        </AuthPanel>
      ) : (
        <AuthPanel prefix="student" tab="login" onSubmit={() => void signIn()}>
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
              ns="studentAuth"
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
          {wrongRole ? (
            <WrongRoleMessage expected={wrongRole} returnTo={returnTo} testId="student-login-wrong-role" />
          ) : null}
          <SubmitButton pending={pending}>{t('loginSubmit')}</SubmitButton>
          <AppLink
            href="/auth/login?forgot=1"
            className="self-center text-sm text-[var(--text-muted)] underline"
          >
            {t('forgotLink')}
          </AppLink>
        </AuthPanel>
      )}
    </AuthCard>
  );
}
