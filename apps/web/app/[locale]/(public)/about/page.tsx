import { getTranslations, setRequestLocale } from 'next-intl/server';
import { BookOpen, Bot, Building2, GraduationCap, Languages, School, Trophy, User, Wifi } from 'lucide-react';
import { getPublicConfig } from '@/lib/api/server';
import { CardGrid, InfoCard, LinkButton, Section } from '@/components/public/blocks';

/**
 * /about (8.1.3): 11 блоков REQ-PUB-ABOUT-01 по порядку.
 * REQ-PUB-ABOUT-02: утверждения про офлайн, рейтинги и паритет языков — только текст, функции не реализуются.
 */
export default async function AboutPage({ params }: { params: Promise<{ locale: string }> }) {
  setRequestLocale((await params).locale);
  const t = await getTranslations('about');
  const config = await getPublicConfig();
  const atlas = config?.atlasUrls ?? { mendeleev: null, anatomy: null };
  const supportEmail = config?.supportEmail ?? null;

  const initials = (name: string) =>
    name
      .split(' ')
      .map((p) => p[0])
      .join('')
      .slice(0, 2);

  return (
    <>
      {/* (1) О ПРОЕКТЕ */}
      <Section
        testId="about-hero"
        headingLevel={1}
        label={t('hero.label')}
        title={t('hero.title')}
        text={t('hero.text')}
      >
        <div className="flex flex-wrap gap-4">
          <LinkButton href="/subjects">{t('hero.toSubjects')}</LinkButton>
          <LinkButton href="/auth/start" variant="secondary">
            {t('hero.start')}
          </LinkButton>
        </div>
        <dl className="mt-10 grid gap-4 md:grid-cols-3">
          {(['languages', 'access', 'pwa'] as const).map((m) => (
            <div
              key={m}
              className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-6"
            >
              <dt className="text-sm text-[var(--text-muted)]">{t(`metrics.${m}Label`)}</dt>
              <dd className="order-first text-2xl font-bold">{t(`metrics.${m}Value`)}</dd>
            </div>
          ))}
        </dl>
        <div className="mt-10 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-6">
          <h2 className="text-xl font-semibold">{t('card.title')}</h2>
          <ul className="mt-4 grid gap-4 md:grid-cols-3">
            {(
              [
                ['student', User],
                ['teacher', GraduationCap],
                ['school', Building2],
              ] as const
            ).map(([role, Icon]) => (
              <li key={role} id={role === 'school' ? undefined : role} className="flex gap-3">
                <Icon aria-hidden="true" className="size-6 shrink-0 text-[var(--accent)]" />
                <div>
                  <h3 className="font-semibold">{t(`card.${role}`)}</h3>
                  <p className="text-sm text-[var(--text-muted)]">{t(`card.${role}Text`)}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </Section>

      {/* (2) Наша миссия */}
      <Section testId="about-mission" title={t('mission.title')} text={t('mission.text')}>
        <blockquote className="border-l-4 border-[var(--accent)] pl-6 text-2xl font-semibold">
          {t('mission.quote')}
        </blockquote>
      </Section>

      {/* (3) Проблема, которую решаем */}
      <Section testId="about-problem" title={t('problem.title')}>
        <ul className="grid gap-3 md:grid-cols-2">
          {(['inequality', 'pisa', 'urbanRural', 'kazakhContent', 'cost'] as const).map((key) => (
            <li
              key={key}
              className="rounded-[var(--radius-field)] border border-[var(--border)] p-4 text-[var(--text-muted)]"
            >
              {t(`problem.${key}`)}
            </li>
          ))}
        </ul>
      </Section>

      {/* (4) Для кого Syntara */}
      <Section testId="about-audience" title={t('audience.title')}>
        <CardGrid>
          {(
            [
              ['student', '#student'],
              ['teacher', '#teacher'],
              ['school', '/schools'],
            ] as const
          ).map(([key, href]) => (
            <InfoCard key={key} title={t(`audience.${key}`)} text={t(`audience.${key}Text`)}>
              <LinkButton href={href.startsWith('#') ? `/about${href}` : href} variant="text">
                {t('audience.more')}
              </LinkButton>
            </InfoCard>
          ))}
        </CardGrid>
      </Section>

      {/* (5) Почему именно Syntara */}
      <Section testId="about-why" title={t('why.title')}>
        <CardGrid columns={4}>
          {(['access', 'kazakh', 'everywhere', 'ai'] as const).map((key) => (
            <InfoCard key={key} title={t(`why.${key}`)} text={t(`why.${key}Text`)} />
          ))}
        </CardGrid>
      </Section>

      {/* (6) Как это работает */}
      <Section testId="about-how" title={t('how.title')}>
        <ol className="grid gap-4 md:grid-cols-3">
          {(['learn', 'grow', 'teacher'] as const).map((key, i) => (
            <li
              key={key}
              className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-6"
            >
              <span aria-hidden="true" className="text-3xl font-bold text-[var(--accent)]">
                {i + 1}
              </span>
              <h3 className="mt-2 text-lg font-semibold">{t(`how.${key}`)}</h3>
              <p className="text-sm text-[var(--text-muted)]">{t(`how.${key}Text`)}</p>
            </li>
          ))}
        </ol>
      </Section>

      {/* (7) Что внутри */}
      <Section testId="about-inside" title={t('inside.title')}>
        <CardGrid>
          {(
            [
              ['lessons', BookOpen],
              ['tutor', Bot],
              ['motivation', Trophy],
              ['kazakh', Languages],
              ['lowBandwidth', Wifi],
              ['teachers', School],
            ] as const
          ).map(([key, Icon]) => (
            <InfoCard
              key={key}
              icon={<Icon className="size-6" />}
              title={t(`inside.${key}`)}
              text={t(`inside.${key}Text`)}
            />
          ))}
        </CardGrid>
      </Section>

      {/* (8) С этого всё начиналось — ссылки атласов из конфигурации (PH-10) */}
      <Section testId="about-origins" title={t('origins.title')}>
        <CardGrid columns={2}>
          {(['mendeleev', 'anatomy'] as const).map((key) => {
            const url = atlas[key];
            return (
              <InfoCard key={key} title={t(`origins.${key}Name`)} text={t(`origins.${key}Text`)}>
                {url ? (
                  <a
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[var(--accent)] hover:underline"
                  >
                    {t('origins.open')}
                  </a>
                ) : (
                  <p className="text-sm text-[var(--text-muted)]">{t('origins.soon')}</p>
                )}
              </InfoCard>
            );
          })}
        </CardGrid>
      </Section>

      {/* (9) Команда — фото: инициалы (PH-05) */}
      <Section testId="about-team" title={t('team.title')}>
        <ul className="grid gap-4 md:grid-cols-2">
          {(
            [
              ['alexandr', 'zabolotnyyalexandr@gmail.com'],
              ['aigerim', null],
            ] as const
          ).map(([key, email]) => {
            const name = t(`team.${key}Name`);
            return (
              <li
                key={key}
                className="flex items-center gap-4 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-6"
              >
                <span
                  aria-hidden="true"
                  className="inline-flex size-14 shrink-0 items-center justify-center rounded-full bg-[var(--accent-strong)] text-lg font-bold text-white"
                >
                  {initials(name)}
                </span>
                <div className="min-w-0">
                  <h3 className="font-semibold">{name}</h3>
                  <p className="text-sm text-[var(--text-muted)]">{t(`team.${key}Role`)}</p>
                  {email ? (
                    <a
                      href={`mailto:${email}`}
                      className="text-sm break-all text-[var(--accent)] hover:underline"
                    >
                      {email}
                    </a>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      </Section>

      {/* (10) Цели устойчивого развития ООН */}
      <Section testId="about-sdg" title={t('sdg.title')}>
        <ul className="grid gap-4 md:grid-cols-3">
          {([4, 9, 10] as const).map((goal) => (
            <li
              key={goal}
              className="flex items-center gap-4 rounded-[var(--radius-field)] border border-[var(--border)] p-4"
            >
              <span className="text-3xl font-bold text-[var(--accent)]">{goal}</span>
              <span className="font-semibold">{t(`sdg.goal${goal}`)}</span>
            </li>
          ))}
        </ul>
      </Section>

      {/* (11) Присоединяйся */}
      <Section testId="about-join" title={t('join.title')} text={t('join.text')}>
        <div className="flex flex-wrap items-center gap-4">
          <LinkButton href="/schools">{t('join.forSchool')}</LinkButton>
          {supportEmail ? (
            <a href={`mailto:${supportEmail}`} className="text-[var(--accent)] hover:underline">
              {supportEmail}
            </a>
          ) : null}
        </div>
      </Section>
    </>
  );
}
