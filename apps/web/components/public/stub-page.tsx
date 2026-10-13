import { getTranslations } from 'next-intl/server';
import { LinkButton, Section } from './blocks';

/** Заглушка «Раздел в разработке» (PH-24) для точек входа, страницы которых появятся в следующих итерациях. */
export async function StubPage() {
  const t = await getTranslations('common');
  return (
    <Section testId="stub-page" headingLevel={1} title={t('sectionInDevelopment')}>
      <LinkButton href="/" variant="secondary">
        {t('backHome')}
      </LinkButton>
    </Section>
  );
}
