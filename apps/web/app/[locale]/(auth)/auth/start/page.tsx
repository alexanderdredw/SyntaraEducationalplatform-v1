import { getTranslations, setRequestLocale } from 'next-intl/server';
import { StartChoice } from '@/components/auth/start-choice';
import { StudentAuthFromJoin } from '@/components/auth/student-auth-entry';

/**
 * /auth/start (REQ-GEN-AUTH-02): выбор роли; `?role=teacher` — регистрация учителя,
 * `?role=student` — экран ученика «Вход или регистрация» (эталон student-auth.png).
 */
export default async function StartPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ role?: string | string[] }>;
}) {
  setRequestLocale((await params).locale);
  const t = await getTranslations('auth.start');
  const raw = (await searchParams).role;
  const role = Array.isArray(raw) ? raw[0] : raw;
  if (role === 'student') {
    return (
      <section data-testid="start-page" className="px-4 py-8 md:py-12">
        <StudentAuthFromJoin />
      </section>
    );
  }
  return (
    <section data-testid="start-page" className="px-4 py-12 md:py-16">
      <div className="mx-auto max-w-[640px]">
        <h1 className="text-3xl font-bold md:text-4xl">{t('title')}</h1>
        <div className="mt-8">
          <StartChoice initialRole={role === 'teacher' ? 'teacher' : null} />
        </div>
      </div>
    </section>
  );
}
