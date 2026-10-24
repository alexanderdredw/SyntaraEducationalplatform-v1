'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { GraduationCap, School } from 'lucide-react';
import { Button, Card, cn, Field, Input } from '@syntara/ui';
import { useRouter } from '@/i18n/navigation';
import { apiRequest } from '@/lib/api/browser';
import { AppLink } from '../app-link';
import { loginEntryFor } from './wrong-role';
import { useErrorText } from '../forms/form-parts';

type Role = 'student' | 'teacher';
type Fields = 'email' | 'displayName' | 'password';

/**
 * /auth/start (REQ-GEN-AUTH-02): выбор «Ученик» или «Учитель» с объяснением.
 * Учитель → регистрация (email, имя, пароль ≥ 8, API-AUTH-03); ученик → «Ученики подключаются через класс
 * ученик → экран «Вход или регистрация» (`?role=student`, BR-CLS-04).
 */
export function StartChoice({
  initialRole,
  returnTo = null,
}: {
  initialRole: 'teacher' | null;
  returnTo?: string | null;
}) {
  const t = useTranslations('auth.start');
  const tf = useTranslations('forms');
  const errorText = useErrorText();
  const locale = useLocale();
  const router = useRouter();
  const [role, setRole] = useState<Role | null>(initialRole);
  const [form, setForm] = useState<Record<Fields, string>>({ email: '', displayName: '', password: '' });
  const [errors, setErrors] = useState<Partial<Record<Fields, string>>>({});
  const [failed, setFailed] = useState(false);
  const [pending, setPending] = useState(false);

  const submit = async () => {
    const local: Partial<Record<Fields, string>> = {};
    if (!form.displayName.trim()) local.displayName = 'required';
    if (!/^\S+@\S+\.\S+$/.test(form.email.trim())) local.email = 'email';
    if (form.password.length < 8) local.password = 'passwordTooShort';
    setErrors(local);
    setFailed(false);
    if (Object.keys(local).length) return;
    setPending(true);
    const res = await apiRequest('/api/auth/register', {
      method: 'POST',
      locale,
      body: { role: 'teacher', ...form, email: form.email.trim() },
    });
    setPending(false);
    if (res.kind === 'ok') {
      router.replace('/teacher/courses');
      router.refresh();
    } else if (res.kind === 'http' && res.error?.fieldErrors) {
      setErrors(res.error.fieldErrors as Partial<Record<Fields, string>>);
    } else setFailed(true);
  };

  const option = (value: Role, Icon: typeof School) => (
    <button
      type="button"
      aria-pressed={role === value}
      data-testid={`start-${value}`}
      onClick={() => (value === 'student' ? router.push('/auth/start?role=student') : setRole(value))}
      className={cn(
        'flex min-h-11 flex-1 flex-col items-start gap-2 rounded-[var(--radius-card)] border p-5 text-left shadow-card',
        role === value
          ? 'border-[var(--accent)] bg-[var(--field)]'
          : 'border-[var(--border)] bg-[var(--surface)] hover:border-[var(--border-strong)]',
      )}
    >
      <Icon aria-hidden="true" className="size-6 text-[var(--accent)]" />
      <span className="text-lg font-semibold">{t(value)}</span>
      <span className="text-sm text-[var(--text-muted)]">
        {value === 'student' ? t('studentText') : t('teacherText')}
      </span>
    </button>
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 sm:flex-row">
        {option('student', GraduationCap)}
        {option('teacher', School)}
      </div>

      {role === 'teacher' ? (
        <Card data-testid="teacher-register">
          <h2 className="text-xl font-semibold">{t('register')}</h2>
          <form
            noValidate
            className="mt-4 flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <Field id="register-email" label={t('email')} required error={errorText(errors.email)}>
              <Input
                type="email"
                autoComplete="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </Field>
            <Field id="register-name" label={t('displayName')} required error={errorText(errors.displayName)}>
              <Input
                autoComplete="name"
                value={form.displayName}
                onChange={(e) => setForm({ ...form, displayName: e.target.value })}
              />
            </Field>
            <Field
              id="register-password"
              label={t('password')}
              hint={t('passwordHint')}
              required
              error={errorText(errors.password)}
            >
              <Input
                type="password"
                autoComplete="new-password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
              />
            </Field>
            <p className="text-xs text-[var(--text-muted)]">{tf('consent')}</p>
            {failed ? (
              <p role="alert" className="text-sm text-[var(--danger-text)]">
                {tf('serverError')}
              </p>
            ) : null}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <AppLink
                // BR-AUTH-01: вход учителя — форма «Я учитель».
                href={loginEntryFor('teacher', returnTo)}
                data-testid="teacher-login-link"
                className="inline-flex min-h-11 items-center text-sm text-[var(--accent)] hover:underline"
              >
                {t('haveAccount')}
              </AppLink>
              <Button type="submit" disabled={pending}>
                {t('submit')}
              </Button>
            </div>
          </form>
        </Card>
      ) : null}
    </div>
  );
}
