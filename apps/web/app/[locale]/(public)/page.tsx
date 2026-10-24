import { BrandMark } from '@syntara/ui';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { BookOpen, LineChart, School } from 'lucide-react';
import { type Locale } from '@syntara/shared';
import { getPublicSubjects } from '@/lib/api/server';
import { CardGrid, InfoCard, LinkButton, Section } from '@/components/public/blocks';
import { DemoQuestionBlock } from '@/components/public/demo-question';
import { getSignedInCta } from '@/components/public/signed-in-cta';
import { SubjectCards } from '@/components/public/subject-cards';
import { WhySyntara } from '@/components/public/why-syntara';
import { BattleHomeCard } from '@/components/battle/student-join';

/**
 * Главная (8.1.1): секции строго в порядке REQ-PUB-HOME-01 —
 * Hero → Коротко → Пробный вопрос → Как это работает → Предметы → Почему Syntara → Школам → Сохраняй прогресс → Футер.
 */
export default async function HomePage({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('home');
  const subjects = await getPublicSubjects(locale);
  // REQ-ST-HOME-01, REQ-NAV-05: у вошедшего кнопки «обложки» заменяются — ученику «Продолжить учёбу →»
  // (последняя открытая тема, иначе каталог, PH-34), учителю «Перейти в кабинет →».
  const cta = await getSignedInCta();
  const student = cta?.role === 'student';
  const signedInCta = cta ? (
    <LinkButton href={cta.href} testId="signed-in-cta" variant="blue">
      {cta.label}
    </LinkButton>
  ) : null;

  return (
    <>
      {/* REQ-PUB-HOME-02 */}
      <section data-testid="home-hero" className="relative overflow-hidden px-4 py-12 md:pb-20 md:pt-14">
        {/* Декоративная сеть тонких линий (эталон U01), только SVG; скрыта в «Экономии трафика». */}
        <svg
          aria-hidden="true"
          data-decorative
          className="pointer-events-none absolute inset-0 h-full w-full text-[var(--text)] opacity-[0.28]"
          viewBox="0 0 1300 820"
          preserveAspectRatio="xMidYMid slice"
          fill="none"
          stroke="currentColor"
          strokeWidth="1"
        >
          <path d="M270 70 L370 40 L450 105 L380 260 L265 195 Z M370 40 L380 260 M265 195 L450 105" />
          <path d="M450 105 L530 75 L560 210 L470 330 L380 260 M560 210 L640 300 L700 520 L560 470 L470 330" />
          <path d="M640 300 L760 380 L830 560 L700 520 M760 380 L900 330 L940 470 L830 560" />
          <path d="M690 85 L760 60 L900 0 L960 140 L1020 190 L1020 260 L960 140 M690 85 L760 105 L900 0" />
          <path d="M1220 30 L1170 60 M1060 560 L1150 500 L1200 610 M1150 500 L1080 690" />
          <path d="M80 650 L130 690 M420 790 L490 700 L550 760 M490 700 L610 770 L650 820" />
        </svg>
        <div className="relative mx-auto max-w-[1240px]">
          {/* Знак и слово Syntara над меткой (эталон U01); декоративные — заголовок страницы ниже. */}
          <p aria-hidden="true" className="mb-6 flex items-center gap-3 text-[26px] font-bold">
            <BrandMark />
            Syntara
          </p>
          <p className="text-[15px] font-bold tracking-[0.2em] text-[var(--text-muted)]">{t('hero.label')}</p>
          <h1 className="mt-6 text-5xl font-bold leading-[1.08] tracking-tight sm:text-7xl lg:text-[104px]">
            <span className="block">{t('hero.line1')}</span>
            <span className="block">{t('hero.line2')}</span>
            <span className="block text-[var(--accent-bright)]" data-testid="hero-accent-line">
              {t('hero.line3')}
            </span>
          </h1>
          <p className="mt-12 max-w-[470px] text-lg leading-relaxed text-[var(--text-muted)]">
            {t('hero.text')}
          </p>
          <div className="mt-10 flex flex-wrap items-center gap-4">
            {cta?.role === 'student' ? (
              <LinkButton href={cta.href} testId="hero-continue" size="lg" variant="white">
                {t('hero.continue')}
              </LinkButton>
            ) : (
              <>
                <LinkButton href="/subjects">{t('hero.cta')}</LinkButton>
                {cta ? (
                  <LinkButton href={cta.href} variant="text" testId="hero-to-cabinet">
                    {cta.label}
                  </LinkButton>
                ) : (
                  <LinkButton href="/auth/start?role=teacher" variant="text">
                    {t('hero.teacher')}
                  </LinkButton>
                )}
              </>
            )}
          </div>
          {/* 8.6.2: на главной ученика — «Есть код Battle? Введи его». */}
          {student ? <BattleHomeCard /> : null}
        </div>
      </section>

      {/* REQ-PUB-HOME-03 */}
      <Section testId="home-short" label={t('short.label')} title={t('short.title')} text={t('short.text')} />

      {/* REQ-PUB-HOME-04 — логика пробного вопроса (SM-DEMO) — итерация 5 */}
      <Section testId="home-demo" label={t('demo.label')} title={t('demo.title')} text={t('demo.text')}>
        <DemoQuestionBlock student={student} />
      </Section>

      {/* REQ-PUB-HOME-05 */}
      <Section testId="home-how" label={t('how.label')} title={t('how.title')} text={t('how.text')}>
        <CardGrid>
          {(
            [
              ['learn', <BookOpen key="i" className="size-8" />],
              ['grow', <LineChart key="i" className="size-8" />],
              ['teach', <School key="i" className="size-8" />],
            ] as const
          ).map(([step, icon]) => (
            <InfoCard
              key={step}
              icon={icon}
              title={`${t(`how.${step}.number`)} ${t(`how.${step}.title`)}`}
              text={t(`how.${step}.text`)}
            />
          ))}
        </CardGrid>
      </Section>

      {/* REQ-PUB-HOME-06 */}
      <Section
        testId="home-subjects"
        eyebrow="muted"
        titleSize="display"
        label={t('subjects.label')}
        title={t('subjects.title')}
        text={t('subjects.subtitle')}
      >
        <SubjectCards subjects={subjects} variant="home" />
        <div className="mt-6">
          <LinkButton href="/subjects" variant="text" testId="subjects-all">
            {t('subjects.all')}
          </LinkButton>
        </div>
      </Section>

      {/* REQ-PUB-HOME-07 */}
      <section
        data-testid="home-why"
        className="bg-[linear-gradient(160deg,#1765e8,#0b3a91)] px-4 py-16 text-white"
      >
        <div className="mx-auto max-w-[1240px]">
          <p className="text-xs font-semibold tracking-[0.2em] text-white/80">{t('why.label')}</p>
          <h2 className="mt-2 text-3xl font-bold md:text-5xl">{t('why.title')}</h2>
          <p className="mt-4 text-xs font-semibold tracking-[0.2em] text-white/80">{t('why.tag')}</p>
          <p className="mt-2 max-w-2xl text-lg text-white/90">{t('why.text')}</p>
          <div className="mt-8">
            <WhySyntara />
          </div>
        </div>
      </section>

      {/* REQ-PUB-HOME-08 */}
      <Section testId="home-schools" label={t('schools.label')} title={t('schools.title')}>
        <CardGrid>
          {(['journal', 'diary', 'homework'] as const).map((card) => (
            <InfoCard key={card} title={t(`schools.${card}.title`)} text={t(`schools.${card}.text`)} />
          ))}
        </CardGrid>
        <div className="mt-8 flex flex-wrap gap-4">
          <LinkButton href="/schools" variant="secondary">
            {t('schools.see')}
          </LinkButton>
          <LinkButton href="/schools/request">{t('schools.request')}</LinkButton>
        </div>
      </Section>

      {/* REQ-PUB-HOME-09 */}
      <Section testId="home-progress" title={t('progress.title')} text={t('progress.text')}>
        <div className="flex flex-wrap gap-4">
          {signedInCta ?? (
            <LinkButton href="/auth/login" variant="blue">
              {t('progress.login')}
            </LinkButton>
          )}
          <LinkButton href="/join" variant="secondary">
            {t('progress.join')}
          </LinkButton>
        </div>
      </Section>
    </>
  );
}
