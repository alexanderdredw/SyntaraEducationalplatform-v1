import { getTranslations, setRequestLocale } from 'next-intl/server';
import {
  ArrowUpRight,
  Atom,
  BookOpen,
  Bot,
  Gift,
  Globe,
  GraduationCap,
  Languages,
  MessageCircle,
  School,
  Trophy,
  Wifi,
} from 'lucide-react';
import { Avatar, cn, Eyebrow, IconTile } from '@syntara/ui';
import { getPublicConfig } from '@/lib/api/server';
import { LinkButton, Section } from '@/components/public/blocks';

/**
 * /about (8.1.3): 11 блоков REQ-PUB-ABOUT-01 по порядку; вёрстка — docs/UX_TZ.md UX-05…UX-08.
 * REQ-PUB-ABOUT-02: утверждения про офлайн, рейтинги и паритет языков — только текст, функции не реализуются.
 * Тексты — текущие: формулировки референсов (пункты ⚠) ждут владельца (needs_confirmation.json, `proposed`).
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

  const card =
    'flex flex-col gap-2 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-7';
  const bigTitle = 'text-4xl font-bold leading-tight tracking-tight md:text-5xl';

  return (
    <>
      {/* (1) О ПРОЕКТЕ — две колонки: текст и карточка ролей (UX-05) */}
      <section data-testid="about-hero" className="relative overflow-hidden px-4 py-12 md:py-20">
        <div className="mx-auto grid max-w-[1240px] items-center gap-12 lg:grid-cols-[1.15fr_1fr]">
          <div className="min-w-0">
            <Eyebrow tone="accent">{t('hero.label')}</Eyebrow>
            <h1 className="mt-6 max-w-[8ch] text-[clamp(3rem,1.5rem+6vw,7.5rem)] leading-[0.95] font-bold tracking-tight [overflow-wrap:normal] [hyphens:manual]">
              {t('hero.title')}
            </h1>
            <p className="mt-6 max-w-[620px] text-lg leading-relaxed text-[var(--text-muted)] md:text-xl">
              {t('hero.text')}
            </p>
            <div className="mt-8 flex flex-wrap gap-4">
              <LinkButton href="/subjects">{t('hero.toSubjects')}</LinkButton>
              <LinkButton href="/auth/start" variant="secondary">
                {t('hero.start')}
              </LinkButton>
            </div>
            {/* Строка показателей. TODO(OWNER): четвёртый показатель и формулировки «бесплатно» / «офлайн»
                не утверждены (UX-05 ⚠) — выводятся три текущих. */}
            <dl className="mt-12 grid grid-cols-1 border-y border-[var(--border)] sm:grid-cols-3">
              {(['languages', 'access', 'pwa'] as const).map((m, i) => (
                <div
                  key={m}
                  className={cn(
                    'flex flex-col gap-1 py-5 sm:px-5',
                    i === 0 ? 'sm:pl-0' : 'border-t border-[var(--border)] sm:border-t-0 sm:border-l',
                  )}
                >
                  <dt className="text-sm text-[var(--text-muted)]">{t(`metrics.${m}Label`)}</dt>
                  <dd className="order-first text-2xl font-bold md:text-3xl">{t(`metrics.${m}Value`)}</dd>
                </div>
              ))}
            </dl>
          </div>

          <div className="relative overflow-hidden rounded-[28px] border border-[var(--border)] bg-[linear-gradient(160deg,color-mix(in_srgb,var(--accent)_7%,var(--surface)),var(--surface))] p-7 md:p-10">
            <div className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-3 text-sm text-[var(--text-muted)]">
                <IconTile size="sm">
                  <BookOpen />
                </IconTile>
                {t('card.brand')}
              </span>
              <span className="text-xs font-bold text-[var(--accent-bright)]">{t('card.badge')}</span>
            </div>
            <h2 className="mt-10 text-3xl leading-tight font-bold tracking-tight md:text-[44px]">
              {t('card.title')}
            </h2>
            <p className="mt-3 text-[var(--text-muted)]">{t('card.subtitle')}</p>
            <hr className="my-8 border-[var(--border)]" />
            <ul className="relative flex flex-col gap-6">
              {(
                [
                  ['student', BookOpen],
                  ['teacher', GraduationCap],
                  ['school', Globe],
                ] as const
              ).map(([role, Icon], i) => (
                <li key={role} id={role === 'school' ? undefined : role} className="relative flex gap-4">
                  {/* Соединительная линия к следующему значку (декоративная). */}
                  {i < 2 ? (
                    <span
                      aria-hidden="true"
                      className="absolute top-10 -bottom-6 left-[18px] w-px bg-[var(--border-strong)]"
                    />
                  ) : null}
                  <IconTile size="sm">
                    <Icon />
                  </IconTile>
                  <div>
                    <h3 className="font-semibold">{t(`card.${role}`)}</h3>
                    <p className="text-[var(--text-muted)]">{t(`card.${role}Text`)}</p>
                  </div>
                </li>
              ))}
            </ul>
            {/* Декоративная дуга в правом нижнем углу (UX-05). */}
            <svg
              aria-hidden="true"
              data-decorative
              className="pointer-events-none absolute -right-24 -bottom-24 size-72 text-[var(--border-strong)]"
              viewBox="0 0 200 200"
              fill="none"
            >
              <circle cx="200" cy="200" r="150" stroke="currentColor" strokeWidth="1" />
            </svg>
          </div>
        </div>
      </section>

      {/* (2) Наша миссия — две колонки и цитата-карточка (UX-06) */}
      <section data-testid="about-mission" className="px-4 py-12 md:py-16">
        <div className="mx-auto max-w-[1240px] border-t border-[var(--border)] pt-12 md:pt-16">
          <div className="grid gap-6 md:grid-cols-[1fr_1.6fr]">
            <h2 className={cn(bigTitle, 'max-w-[8ch]')}>{t('mission.title')}</h2>
            <p className="text-lg leading-relaxed text-[var(--text-muted)]">{t('mission.text')}</p>
          </div>
          <figure className="mt-12 rounded-[24px] border border-[var(--border)] bg-[var(--surface)] px-6 py-12 text-center md:px-16 md:py-16">
            <span
              aria-hidden="true"
              className="block text-5xl leading-none font-bold text-[var(--accent-bright)]"
            >
              &ldquo;
            </span>
            <blockquote className="mx-auto mt-4 max-w-[900px] text-2xl leading-snug font-semibold md:text-[44px]">
              {t('mission.quote')}
            </blockquote>
          </figure>
        </div>
      </section>

      {/* (3) Проблема, которую решаем — одна карточка, факты одним абзацем (UX-06; тексты текущие) */}
      <section data-testid="about-problem" className="px-4 py-12 md:py-16">
        <div className="mx-auto grid max-w-[1240px] gap-8 rounded-[24px] border border-[color-mix(in_srgb,var(--accent)_30%,var(--border))] bg-[linear-gradient(120deg,color-mix(in_srgb,var(--accent)_12%,var(--surface)),var(--surface)_55%)] px-6 py-10 md:grid-cols-[1fr_1.6fr] md:px-14 md:py-14">
          <h2 className={cn(bigTitle, 'max-w-[10ch]')}>{t('problem.title')}</h2>
          <p className="leading-relaxed text-[var(--text-muted)]">
            {(['inequality', 'pisa', 'urbanRural', 'kazakhContent', 'cost'] as const)
              .map((key) => t(`problem.${key}`))
              .join(' ')}
          </p>
        </div>
      </section>

      {/* (4) Для кого Syntara — значки, «Подробнее ↗» внизу слева (UX-07) */}
      <Section testId="about-audience" title={t('audience.title')}>
        <ul className="grid gap-4 md:grid-cols-3">
          {(
            [
              ['student', '#student', BookOpen],
              ['teacher', '#teacher', GraduationCap],
              ['school', '/schools', Globe],
            ] as const
          ).map(([key, href, Icon]) => (
            <li key={key} className={card}>
              <Icon aria-hidden="true" className="size-6 text-[var(--accent-bright)]" />
              <h3 className="mt-8 text-lg font-semibold">{t(`audience.${key}`)}</h3>
              <p className="text-[var(--text-muted)]">{t(`audience.${key}Text`)}</p>
              <span className="mt-auto pt-6">
                <LinkButton href={href.startsWith('#') ? `/about${href}` : href} variant="text">
                  {t('audience.more')}
                </LinkButton>
              </span>
            </li>
          ))}
        </ul>
      </Section>

      {/* (5) Почему именно Syntara — сетка 2 × 2, синяя кромка сверху (UX-07; тексты текущие) */}
      <section data-testid="about-why" className="px-4 py-12 md:py-16">
        <div className="mx-auto max-w-[1240px] border-t border-[var(--border)] pt-12 md:pt-16">
          <h2 className="text-3xl font-bold tracking-tight md:text-5xl">{t('why.title')}</h2>
          <ul className="mt-8 grid gap-4 md:grid-cols-2">
            {(
              [
                ['access', Gift],
                ['kazakh', Globe],
                ['everywhere', Wifi],
                ['ai', MessageCircle],
              ] as const
            ).map(([key, Icon]) => (
              <li key={key} className={cn(card, 'border-t-2 border-t-[var(--accent)]')}>
                <Icon aria-hidden="true" className="size-6 text-[var(--accent-bright)]" />
                <h3 className="mt-4 text-lg font-semibold">{t(`why.${key}`)}</h3>
                <p className="text-[var(--text-muted)]">{t(`why.${key}Text`)}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* (6) Как это работает — оставлен и оформлен в общем стиле (UX-07, вариант «в») */}
      <Section testId="about-how" title={t('how.title')}>
        <ol className="grid gap-4 md:grid-cols-3">
          {(['learn', 'grow', 'teacher'] as const).map((key, i) => (
            <li key={key} className={card}>
              <span
                aria-hidden="true"
                className="inline-flex size-10 items-center justify-center rounded-full border border-[var(--border-strong)] font-bold text-[var(--accent-bright)]"
              >
                {i + 1}
              </span>
              <h3 className="mt-4 text-lg font-semibold">{t(`how.${key}`)}</h3>
              <p className="text-[var(--text-muted)]">{t(`how.${key}Text`)}</p>
            </li>
          ))}
        </ol>
      </Section>

      {/* (7) Что внутри — значки в плитках (UX-07, вариант «в») */}
      <Section testId="about-inside" title={t('inside.title')}>
        <ul className="grid gap-4 md:grid-cols-3">
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
            <li key={key} className={card}>
              <IconTile>
                <Icon />
              </IconTile>
              <h3 className="mt-4 text-lg font-semibold">{t(`inside.${key}`)}</h3>
              <p className="text-[var(--text-muted)]">{t(`inside.${key}Text`)}</p>
            </li>
          ))}
        </ul>
      </Section>

      {/* (8) С этого всё начиналось — две колонки, список атласов (UX-08); ссылки из конфигурации (PH-10) */}
      <section data-testid="about-origins" className="px-4 py-12 md:py-16">
        <div className="mx-auto grid max-w-[1240px] gap-10 md:grid-cols-[1fr_1.4fr]">
          {/* Абзац-история референса не утверждён (UX-08 ⚠) — только заголовок. */}
          <h2 className={cn(bigTitle, 'max-w-[10ch]')}>{t('origins.title')}</h2>
          <ul className="flex flex-col">
            {(
              [
                ['mendeleev', Atom],
                ['anatomy', BookOpen],
              ] as const
            ).map(([key, Icon]) => {
              const url = atlas[key];
              return (
                <li
                  key={key}
                  className="relative flex gap-5 border-b border-[var(--border)] py-6 first:border-t"
                >
                  <IconTile>
                    <Icon />
                  </IconTile>
                  <div className="min-w-0 flex-1 border-l-2 border-[var(--accent)] pl-5">
                    <p className="text-xs font-bold tracking-[0.08em] text-[var(--accent-bright)]">
                      {t(`origins.${key}Name`)}
                    </p>
                    <h3 className="mt-2 text-lg font-semibold">{t(`origins.${key}Text`)}</h3>
                    {url ? (
                      <a
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-3 inline-flex min-h-11 items-center font-semibold text-[var(--accent-bright)] hover:underline"
                      >
                        {t('origins.open')}
                        <span className="sr-only"> ({t('origins.newTab')})</span>
                      </a>
                    ) : (
                      <p className="mt-3 text-sm text-[var(--text-muted)]">{t('origins.soon')}</p>
                    )}
                  </div>
                  {/* Стрелка ↗ — только при наличии адреса сайта (UX-08). */}
                  {url ? (
                    <ArrowUpRight
                      aria-hidden="true"
                      className="absolute top-6 right-0 size-5 text-[var(--text-muted)]"
                    />
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      </section>

      {/* (9) Команда — вертикальные карточки, фото или инициалы (UX-08; состав и тексты текущие, PH-05) */}
      <section data-testid="about-team" className="px-4 py-12 md:py-16">
        <div className="mx-auto max-w-[1240px] border-t border-[var(--border)] pt-12 md:pt-16">
          <h2 className="text-3xl font-bold tracking-tight md:text-5xl">{t('team.title')}</h2>
          <ul className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {(
              [
                ['alexandr', 'zabolotnyyalexandr@gmail.com', 'warning'],
                ['aigerim', null, 'success'],
              ] as const
            ).map(([key, email, tone]) => {
              const name = t(`team.${key}Name`);
              return (
                <li key={key} className={cn(card, 'items-center text-center')}>
                  {/* TODO(OWNER): фото участников не предоставлены (UX-08 ⚠) — инициалы. */}
                  <Avatar name={name} initials={initials(name)} tone={tone} />
                  <h3 className="mt-2 text-lg font-semibold">{name}</h3>
                  <p
                    className={cn(
                      'text-sm font-medium',
                      tone === 'warning' ? 'text-[var(--warning-text)]' : 'text-[var(--success-text)]',
                    )}
                  >
                    {t(`team.${key}Role`)}
                  </p>
                  {email ? (
                    <a
                      href={`mailto:${email}`}
                      className="mt-auto inline-flex min-h-11 items-center text-sm break-all text-[var(--accent-bright)] hover:underline"
                    >
                      {email}
                    </a>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      </section>

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
