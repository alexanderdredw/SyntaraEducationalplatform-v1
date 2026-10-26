'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { User } from 'lucide-react';
import { LoginDto } from '@syntara/shared';
import { useRouter } from '@/i18n/navigation';
import { apiRequest } from '@/lib/api/browser';
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
import { useRoleLogin } from './use-role-login';
import { WrongRoleMessage } from './wrong-role';

type RegisterField = 'firstName' | 'lastName' | 'email' | 'password' | 'school';
type LoginField = 'email' | 'password';

/**
 * Экран учителя «Вход или регистрация» — та же карточка, что у ученика (эталон docs/media/student-auth.png), подпись
 * «УЧИТЕЛЬ», обращение на «вы». Регистрация (REQ-GEN-AUTH-02, API-AUTH-03): «Имя», «Фамилия», «Email», «Пароль»,
 * «Школа» (необязательно); после — вход, письмо подтверждения и баннер «Подтвердите email». Вход (REQ-GEN-AUTH-01,
 * API-AUTH-01, BR-AUTH-01): только аккаунт учителя.
 */
export function TeacherAuth({
  initialTab,
  returnTo = null,
  notice,
}: {
  initialTab: AuthTab;
  /** Куда вернуться после входа (раздел 4: только внутренний путь из белого списка). */
  returnTo?: string | null;
  notice?: string;
}) {
  const t = useTranslations('teacherAuth');
  const tf = useTranslations('forms');
  const errorText = useErrorText();
  const locale = useLocale();
  const router = useRouter();
  const [tab, setTab] = useState<AuthTab>(initialTab);

  const [form, setForm] = useState({ firstName: '', lastName: '', email: '', password: '' });
  const [school, setSchool] = useState<SchoolValue>({ schoolId: '', schoolName: '', manual: false });
  const [errors, setErrors] = useState<Partial<Record<RegisterField, string>>>({});
  const [failed, setFailed] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const login = useRoleLogin({ entry: 'teacher', returnTo });
  const [loginForm, setLoginForm] = useState({ email: '', password: '' });
  const [loginErrors, setLoginErrors] = useState<Partial<Record<LoginField, string>>>({});

  const register = async () => {
    const local: Partial<Record<RegisterField, string>> = {};
    if (!form.firstName.trim()) local.firstName = 'required';
    if (!form.lastName.trim()) local.lastName = 'required';
    if (!/^\S+@\S+\.\S+$/.test(form.email.trim())) local.email = 'email';
    if (form.password.length < 8) local.password = 'passwordTooShort';
    setErrors(local);
    setFailed(null);
    if (Object.keys(local).length) {
      const first = (['firstName', 'lastName', 'email', 'password'] as const).find((k) => local[k]);
      if (first) document.getElementById(`teacher-${first}`)?.focus();
      return;
    }
    setPending(true);
    const res = await apiRequest('/api/auth/register', {
      method: 'POST',
      locale,
      body: {
        role: 'teacher',
        firstName: form.firstName,
        lastName: form.lastName,
        email: form.email.trim(),
        password: form.password,
        ...(school.manual
          ? { schoolName: school.schoolName.trim() }
          : school.schoolId
            ? { schoolId: school.schoolId }
            : {}),
      },
    });
    setPending(false);
    if (res.kind === 'ok') {
      router.replace('/teacher/courses');
      router.refresh();
      return;
    }
    if (res.kind === 'http' && res.error?.fieldErrors) {
      const fe = res.error.fieldErrors;
      setErrors({
        firstName: fe.firstName,
        lastName: fe.lastName,
        email: fe.email,
        password: fe.password,
        school: fe.schoolId ?? fe.schoolName,
      });
      return;
    }
    setFailed(res.kind === 'network' ? tf('networkError') : tf('serverError'));
  };

  const signIn = async () => {
    const parsed = LoginDto.safeParse(loginForm);
    if (!parsed.success) {
      setLoginErrors(
        Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])) as Partial<
          Record<LoginField, string>
        >,
      );
      return;
    }
    setLoginErrors({});
    if (!(await login.submit(parsed.data))) setLoginForm((f) => ({ ...f, password: '' }));
  };

  const err = (field: RegisterField) => errorText(errors[field]);
  const describe = (id: string, hint: boolean, error: string | undefined) =>
    [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean).join(' ') || undefined;

  const textField = (
    field: 'firstName' | 'lastName' | 'email',
    autoComplete: string,
    placeholder?: string,
  ) => {
    const id = `teacher-${field}`;
    return (
      <FieldRow id={id} label={t(field)} error={err(field)}>
        <input
          id={id}
          type={field === 'email' ? 'email' : 'text'}
          className={inputClass}
          value={form[field]}
          placeholder={placeholder}
          autoComplete={autoComplete}
          autoCapitalize={field === 'email' ? 'none' : undefined}
          aria-required="true"
          aria-invalid={errors[field] ? true : undefined}
          aria-describedby={describe(id, false, errors[field])}
          onChange={(e) => setForm({ ...form, [field]: e.target.value })}
        />
      </FieldRow>
    );
  };

  return (
    <AuthCard
      ns="teacherAuth"
      prefix="teacher"
      icon={<User aria-hidden="true" />}
      tab={tab}
      onTab={setTab}
      notice={notice}
      footer={
        <>
          {tab === 'register' ? <AuthConsent ns="teacherAuth" /> : null}
          <p data-testid="teacher-account-note">{t('accountNote')}</p>
        </>
      }
    >
      {tab === 'register' ? (
        <AuthPanel prefix="teacher" tab="register" onSubmit={() => void register()}>
          {textField('firstName', 'given-name', t('firstNamePlaceholder'))}
          {textField('lastName', 'family-name')}
          {textField('email', 'email', t('emailPlaceholder'))}
          <FieldRow
            id="teacher-password"
            label={t('password')}
            hint={t('passwordHint')}
            error={err('password')}
          >
            <PasswordInput
              ns="teacherAuth"
              id="teacher-password"
              value={form.password}
              autoComplete="new-password"
              invalid={Boolean(errors.password)}
              describedBy={describe('teacher-password', true, errors.password)}
              onChange={(password) => setForm({ ...form, password })}
            />
          </FieldRow>
          <div className="flex flex-col gap-2">
            <label htmlFor="teacher-school" className="text-sm text-[var(--text-muted)]">
              {t('school')}
            </label>
            <SchoolCombobox
              id="teacher-school"
              ns="teacherAuth"
              value={school}
              onChange={setSchool}
              error={err('school')}
            />
            {errors.school ? (
              <p id="teacher-school-error" className="text-xs text-[var(--danger-text)]">
                {err('school')}
              </p>
            ) : null}
          </div>
          {failed ? (
            <p role="alert" className="text-sm text-[var(--danger-text)]">
              {failed}
            </p>
          ) : null}
          <SubmitButton pending={pending}>{t('submit')}</SubmitButton>
        </AuthPanel>
      ) : (
        <AuthPanel prefix="teacher" tab="login" onSubmit={() => void signIn()}>
          <FieldRow id="teacher-login-email" label={t('loginEmail')} error={errorText(loginErrors.email)}>
            <input
              id="teacher-login-email"
              type="email"
              className={inputClass}
              value={loginForm.email}
              autoComplete="username"
              autoCapitalize="none"
              aria-required="true"
              aria-invalid={loginErrors.email ? true : undefined}
              aria-describedby={describe('teacher-login-email', false, loginErrors.email)}
              onChange={(e) => setLoginForm({ ...loginForm, email: e.target.value })}
            />
          </FieldRow>
          <FieldRow id="teacher-login-password" label={t('password')} error={errorText(loginErrors.password)}>
            <PasswordInput
              ns="teacherAuth"
              id="teacher-login-password"
              value={loginForm.password}
              autoComplete="current-password"
              invalid={Boolean(loginErrors.password)}
              describedBy={describe('teacher-login-password', false, loginErrors.password)}
              onChange={(password) => setLoginForm({ ...loginForm, password })}
            />
          </FieldRow>
          {login.message ? (
            <p role="alert" data-testid="login-error" className="text-sm text-[var(--danger-text)]">
              {login.message}
            </p>
          ) : null}
          {login.wrongRole ? (
            <WrongRoleMessage expected={login.wrongRole} returnTo={returnTo} testId="login-wrong-role" />
          ) : null}
          <SubmitButton pending={login.pending}>{t('loginSubmit')}</SubmitButton>
          <div className="flex flex-col items-center gap-1 text-center">
            <AppLink
              href="/auth/login?forgot=1"
              className="inline-flex min-h-11 items-center text-sm text-[var(--text-muted)] underline hover:text-[var(--text)]"
            >
              {t('forgotLink')}
            </AppLink>
            <p className="text-xs text-[var(--text-muted)]">{t('forgotNote')}</p>
          </div>
        </AuthPanel>
      )}
    </AuthCard>
  );
}
