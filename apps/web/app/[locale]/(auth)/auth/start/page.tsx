import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ContinueChoice } from '@/components/auth/continue-choice';
import { StartChoice } from '@/components/auth/start-choice';
import { StudentAuthFromJoin } from '@/components/auth/student-auth-entry';
import { cookies } from 'next/headers';
import { type UserRole } from '@syntara/shared';
import { redirect } from '@/i18n/navigation';
import { getMe, getPublicConfig } from '@/lib/api/server';
import { ROLE_HOME } from '@/lib/auth';

/**
 * /auth/start (REQ-GEN-AUTH-02): без роли — выбор «Как продолжить?» (UX-04; на него ведёт «Войти» в шапке);
 * `?role=teacher` — регистрация учителя, `?role=student` — экран ученика «Вход или регистрация»
 * (эталон student-auth.png).
 */
export default async function StartPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{
    role?: string | string[];
    returnTo?: string | string[];
    reset?: string | string[];
  }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  // REQ-NAV-04, п. 4: «Как продолжить?» и регистрация вошедшему не нужны — на главную его роли.
  const me = await getMe((await cookies()).toString());
  if (me && !me.mustChangePassword) redirect({ href: ROLE_HOME[me.activeRole as UserRole], locale });
  const t = await getTranslations('auth.start');
  const tl = await getTranslations('auth.login');
  const q = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const role = one(q.role);
  // BR-AUTH-01: возврат после входа — в форму выбранной роли.
  const returnTo = one(q.returnTo) ?? null;
  if (role === 'student') {
    return (
      <section data-testid="start-page" className="px-4 py-8 md:py-12">
        <StudentAuthFromJoin returnTo={returnTo} />
      </section>
    );
  }
  if (role !== 'teacher') {
    const config = await getPublicConfig();
    return (
      <section data-testid="start-page" className="px-4 py-10 md:py-14">
        <ContinueChoice
          enabledLocales={config?.features.enabledLocales ?? ['ru', 'kk', 'en']}
          returnTo={returnTo}
          notice={one(q.reset) === 'done' ? tl('registered') : undefined}
        />
      </section>
    );
  }
  return (
    <section data-testid="start-page" className="px-4 py-12 md:py-16">
      <div className="mx-auto max-w-[640px]">
        <h1 className="text-page-title font-bold">{t('title')}</h1>
        <div className="mt-8">
          <StartChoice initialRole="teacher" returnTo={returnTo} />
        </div>
      </div>
    </section>
  );
}
