import { getTranslations, setRequestLocale } from 'next-intl/server';
import { type Locale } from '@syntara/shared';
import { getPublicSubjects } from '@/lib/api/server';
import { Section } from '@/components/public/blocks';
import { SubjectCards } from '@/components/public/subject-cards';

/** /subjects (8.1.2): REQ-PUB-SUBJ-01..03 — без поиска и фильтров. */
export default async function SubjectsPage({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('subjects');
  const subjects = await getPublicSubjects(locale);
  return (
    <Section testId="subjects-page" headingLevel={1} title={t('title')}>
      <SubjectCards subjects={subjects} variant="page" />
    </Section>
  );
}
