import { cookies } from 'next/headers';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { type UserRole } from '@syntara/shared';
import { LoginForm } from '@/components/auth/login-form';
import {
  ChangePasswordForm,
  ForgotPasswordForm,
  ResetPasswordForm,
  VerifyEmail,
} from '@/components/auth/password-forms';
import { AppLink } from '@/components/app-link';
import { getMe } from '@/lib/api/server';
import { HOME_BY_ROLE } from '@/lib/auth';

type Search = {
  returnTo?: string | string[];
  forgot?: string | string[];
  resetToken?: string | string[];
  verifyToken?: string | string[];
  change?: string | string[];
  reset?: string | string[];
};
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * /auth/login (REQ-GEN-AUTH-01): вход по email или логину. На этом же маршруте (раздел 4 других не задаёт):
 * `?forgot=1` — запрос ссылки, `?resetToken=…` — новый пароль (API-AUTH-04), `?change=1` — смена временного
 * пароля (API-AUTH-05), `?verifyToken=…` — подтверждение email (API-AUTH-06).
 */
export default async function LoginPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Search>;
}) {
  setRequestLocale((await params).locale);
  const t = await getTranslations('auth');
  const q = await searchParams;
  const resetToken = one(q.resetToken);
  const verifyToken = one(q.verifyToken);
  const me = one(q.change) ? await getMe((await cookies()).toString()) : null;
  const mode = verifyToken
    ? 'verify'
    : resetToken
      ? 'reset'
      : me
        ? 'change'
        : one(q.forgot)
          ? 'forgot'
          : 'login';
  const title = {
    verify: t('login.title'),
    reset: t('reset.title'),
    change: t('change.title'),
    forgot: t('forgot.title'),
    login: t('login.title'),
  }[mode];

  return (
    <section data-testid="login-page" className="px-4 py-12 md:py-16">
      <div className="mx-auto max-w-[440px]">
        <h1 className="text-page-title font-bold">{title}</h1>
        <div className="mt-8 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-5 shadow-card sm:p-6">
          {mode === 'verify' ? (
            <div className="flex flex-col gap-6">
              <VerifyEmail token={verifyToken!} />
              <LoginForm returnTo={null} />
            </div>
          ) : null}
          {mode === 'reset' ? <ResetPasswordForm token={resetToken!} /> : null}
          {mode === 'change' && me ? (
            <ChangePasswordForm
              mustChange={me.mustChangePassword}
              home={HOME_BY_ROLE[me.activeRole as UserRole]}
            />
          ) : null}
          {mode === 'forgot' ? <ForgotPasswordForm /> : null}
          {mode === 'login' ? (
            <>
              <LoginForm
                returnTo={one(q.returnTo) ?? null}
                notice={one(q.reset) === 'done' ? t('login.registered') : undefined}
              />
              <p className="mt-6 text-sm text-[var(--text-muted)]">
                {t('login.noAccount')}{' '}
                <AppLink href="/auth/start" className="font-semibold text-[var(--accent)] hover:underline">
                  {t('login.start')}
                </AppLink>
              </p>
            </>
          ) : null}
        </div>
      </div>
    </section>
  );
}
