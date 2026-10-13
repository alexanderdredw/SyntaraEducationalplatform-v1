import { getTranslations } from 'next-intl/server';

export default async function NotFound() {
  const t = await getTranslations('common');
  return (
    <main id="main" className="mx-auto max-w-[1240px] px-4 py-24">
      <h1 className="text-2xl font-semibold">{t('appName')}</h1>
      <p className="mt-2 text-[var(--text-muted)]">{t('sectionInDevelopment')}</p>
    </main>
  );
}
