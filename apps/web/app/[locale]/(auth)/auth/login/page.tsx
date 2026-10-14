import { getTranslations, setRequestLocale } from 'next-intl/server';
import { LoginForm } from '@/components/auth/login-form';
import { ForgotPasswordForm, ResetPasswordForm } from '@/components/auth/password-forms';
import { AppLink } from '@/components/app-link';

type Search = {
  returnTo?: string | string[];
  forgot?: string | string[];
  resetToken?: string | string[];
  reset?: string | string[];
};
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * /auth/login (REQ-GEN-AUTH-01): вход по email или логину (PH-44). Восстановление пароля (API-AUTH-04) —
 * на этом же маршруте: `?forgot=1` — запрос ссылки, `?resetToken=…` — новый пароль (других маршрутов раздел 4 не задаёт).
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
  const mode = resetToken ? 'reset' : one(q.forgot) ? 'forgot' : 'login';
  const title =
    mode === 'reset' ? t('reset.title') : mode === 'forgot' ? t('forgot.title') : t('login.title');
  return (
    <section data-testid="login-page" className="px-4 py-12 md:py-16">
      <div className="mx-auto max-w-[440px]">
        <h1 className="text-3xl font-bold md:text-4xl">{title}</h1>
        <div className="mt-8">
          {mode === 'reset' ? <ResetPasswordForm token={resetToken!} /> : null}
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
