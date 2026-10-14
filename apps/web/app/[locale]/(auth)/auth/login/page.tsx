import { getTranslations, setRequestLocale } from 'next-intl/server';
import { LoginForm } from '@/components/auth/login-form';

/** /auth/login (REQ-GEN-AUTH-01): минимальный вход для служебных очередей (итерация 4, Q-01). */
export default async function LoginPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ returnTo?: string | string[] }>;
}) {
  setRequestLocale((await params).locale);
  const t = await getTranslations('auth.login');
  const raw = (await searchParams).returnTo;
  return (
    <section data-testid="login-page" className="px-4 py-12 md:py-16">
      <div className="mx-auto max-w-[440px]">
        <h1 className="text-3xl font-bold md:text-4xl">{t('title')}</h1>
        <div className="mt-8">
          <LoginForm returnTo={(Array.isArray(raw) ? raw[0] : raw) ?? null} />
        </div>
      </div>
    </section>
  );
}
