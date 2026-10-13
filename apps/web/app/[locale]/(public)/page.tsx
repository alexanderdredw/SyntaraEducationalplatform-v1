import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Card } from '@syntara/ui';

/** Заглушка главной (итерация 1). Публичные страницы раздела 8.1 — итерация 3. */
export default async function HomePlaceholder({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('common');

  return (
    <main id="main" className="mx-auto flex min-h-dvh max-w-[1240px] items-center px-4">
      <Card className="w-full">
        <h1 className="text-3xl font-semibold">{t('appName')}</h1>
        <p className="mt-2 text-[var(--text-muted)]">{t('sectionInDevelopment')}</p>
      </Card>
    </main>
  );
}
