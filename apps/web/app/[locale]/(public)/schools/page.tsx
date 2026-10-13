import { getTranslations, setRequestLocale } from 'next-intl/server';
import { BookMarked, CalendarDays, ClipboardList, FileText, MessagesSquare, NotebookPen } from 'lucide-react';
import { AppLink } from '@/components/app-link';
import { CardGrid, InfoCard, LinkButton, Section } from '@/components/public/blocks';

/** /schools (8.1.5): REQ-PUB-SCH-01..03. Цены не показываются (PH-11 pricing.visible = false). */
export default async function SchoolsPage({ params }: { params: Promise<{ locale: string }> }) {
  setRequestLocale((await params).locale);
  const t = await getTranslations('schools');
  const cards = [
    ['journal', BookMarked],
    ['diary', NotebookPen],
    ['schedule', CalendarDays],
    ['homework', ClipboardList],
    ['reportCard', FileText],
    ['communication', MessagesSquare],
  ] as const;

  return (
    <>
      <Section
        width="schools"
        testId="schools-hero"
        headingLevel={1}
        title={t('hero.title')}
        text={t('hero.text')}
      >
        <div className="flex flex-wrap gap-4">
          <LinkButton href="/schools/request">{t('hero.request')}</LinkButton>
          <LinkButton href="/support?category=school_onboarding" variant="secondary">
            {t('hero.ask')}
          </LinkButton>
        </div>
      </Section>

      <Section width="schools" testId="schools-gets" title={t('gets.title')}>
        <CardGrid columns={2}>
          {cards.map(([key, Icon]) => (
            <InfoCard
              key={key}
              icon={<Icon className="size-6" />}
              title={t(`gets.${key}`)}
              text={t(`gets.${key}Text`)}
            />
          ))}
        </CardGrid>
      </Section>

      <Section width="schools" testId="schools-diff" title={t('diff.title')}>
        <ul className="list-disc space-y-2 pl-6 text-[var(--text-muted)]">
          {(['lessons', 'languages', 'devices'] as const).map((key) => (
            <li key={key}>{t(`diff.${key}`)}</li>
          ))}
        </ul>
      </Section>

      <Section width="schools" testId="schools-connect" title={t('connect.title')}>
        <ol className="grid gap-4 md:grid-cols-2">
          {([1, 2, 3, 4] as const).map((n) => (
            <li
              key={n}
              className="flex items-center gap-4 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-5"
            >
              <span aria-hidden="true" className="text-2xl font-bold text-[var(--accent)]">
                {n}
              </span>
              <span className="font-semibold">{t(`connect.step${n}`)}</span>
            </li>
          ))}
        </ol>
      </Section>

      <Section width="schools" testId="schools-data" title={t('data.title')}>
        <p className="text-[var(--text-muted)]">
          {t('data.text')}{' '}
          <AppLink href="/privacy" className="text-[var(--accent)] underline">
            {t('data.privacyLink')}
          </AppLink>
        </p>
      </Section>

      <Section width="schools" testId="schools-trial" title={t('trial.title')} text={t('trial.text')}>
        <p className="text-sm text-[var(--text-muted)]">{t('trial.details')}</p>
        <div className="mt-6">
          <LinkButton href="/schools/request">{t('trial.request')}</LinkButton>
        </div>
      </Section>
    </>
  );
}
