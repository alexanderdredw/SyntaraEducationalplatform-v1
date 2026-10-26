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
import { TeacherAuth } from '@/components/auth/teacher-auth';
import { AppLink } from '@/components/app-link';
import { getMe } from '@/lib/api/server';
import { HOME_BY_ROLE, loginEntryHref, ROLE_HOME, safeReturnTo } from '@/lib/auth';
import { redirect } from '@/i18n/navigation';

type Search = {
  role?: string | string[];
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
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('auth');
  const q = await searchParams;
  const resetToken = one(q.resetToken);
  const verifyToken = one(q.verifyToken);
  const signedIn = await getMe((await cookies()).toString());
  // REQ-NAV-04, п. 4: вход и «Забыли пароль?» вошедшему не нужны — на главную его роли. Смена временного
  // пароля, новый пароль по ссылке и подтверждение email остаются доступными.
  if (signedIn && !signedIn.mustChangePassword && !one(q.change) && !resetToken && !verifyToken) {
    redirect({ href: ROLE_HOME[signedIn.activeRole as UserRole], locale });
  }
  const me = one(q.change) ? signedIn : null;
  // BR-AUTH-01: общей формы входа без роли нет. «Я учитель» — `?role=teacher`; служебный вход сотрудников
  // (`?role=staff` или возврат в /staff/…) — прежняя форма без роли; иначе — выбор «Как продолжить?» или форма ученика.
  const returnTo = one(q.returnTo) ?? null;
  const teacherForm = one(q.role) === 'teacher';
  const staffForm = !teacherForm && (one(q.role) === 'staff' || safeReturnTo(returnTo).startsWith('/staff/'));
  if (!verifyToken && !resetToken && !me && !one(q.forgot) && !teacherForm && !staffForm) {
    const entry = one(q.role) === 'student' ? '/auth/start?role=student' : loginEntryHref(returnTo);
    const withStudentBack =
      one(q.role) === 'student' && returnTo
        ? `${entry}&returnTo=${encodeURIComponent(safeReturnTo(returnTo))}`
        : entry;
    const notice = one(q.reset) === 'done' ? `${withStudentBack.includes('?') ? '&' : '?'}reset=done` : '';
    redirect({ href: withStudentBack + notice, locale });
  }
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

  // BR-AUTH-01: вход учителя — вкладка «Вход» экрана учителя (та же карточка, что у ученика).
  if (mode === 'login' && teacherForm) {
    return (
      <section data-testid="login-page" className="px-4 py-8 md:py-12">
        <TeacherAuth
          initialTab="login"
          returnTo={returnTo}
          notice={one(q.reset) === 'done' ? t('login.registered') : undefined}
        />
      </section>
    );
  }

  return (
    <section data-testid="login-page" className="px-4 py-12 md:py-16">
      <div className="mx-auto max-w-[440px]">
        <h1 className="text-page-title font-bold">{title}</h1>
        <div className="mt-8 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-5 shadow-card sm:p-6">
          {mode === 'verify' ? (
            <div className="flex flex-col gap-6">
              <VerifyEmail token={verifyToken!} />
              {/* Подтверждение email — у учителя (API-AUTH-06). */}
              <LoginForm returnTo={null} entry="teacher" />
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
            // Служебный вход сотрудников (без роли).
            <>
              <LoginForm
                returnTo={returnTo}
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
