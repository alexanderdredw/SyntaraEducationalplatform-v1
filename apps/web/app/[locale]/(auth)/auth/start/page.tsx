import { getTranslations, setRequestLocale } from 'next-intl/server';
import { StartChoice } from '@/components/auth/start-choice';

/** /auth/start (REQ-GEN-AUTH-02): выбор роли; `?role=teacher` (кнопка «Я учитель →») сразу открывает регистрацию. */
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
  return (
    <section data-testid="start-page" className="px-4 py-12 md:py-16">
      <div className="mx-auto max-w-[640px]">
        <h1 className="text-3xl font-bold md:text-4xl">{t('title')}</h1>
        <div className="mt-8">
          <StartChoice initialRole={role === 'teacher' || role === 'student' ? role : null} />
        </div>
      </div>
    </section>
  );
}
