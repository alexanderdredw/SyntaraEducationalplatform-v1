import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Card, EmptyState } from '@syntara/ui';

/** «Карта освоения» (REQ-TCH-AN-01): заглушка PH-24 `teacher.mastery_map = stub`. */
export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  setRequestLocale((await params).locale);
  const t = await getTranslations('common');
  return (
    <Card data-testid="mastery-stub">
      <EmptyState title={t('sectionInDevelopment')} />
    </Card>
  );
}
