import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Eyebrow } from '@syntara/ui';
import { AppLink } from '@/components/app-link';
import { LinkButton, Section } from '@/components/public/blocks';

/**
 * /schools (8.1.5): REQ-PUB-SCH-01..03. Цены не показываются (PH-11 pricing.visible = false).
 * Вёрстка — docs/UX_TZ.md UX-09: одна колонка, умеренные заголовки, плотные секции. Тексты — текущие:
 * формулировки референса (пункты ⚠) ждут владельца (needs_confirmation.json, `proposed`).
 */
export default async function SchoolsPage({ params }: { params: Promise<{ locale: string }> }) {
  setRequestLocale((await params).locale);
  const t = await getTranslations('schools');
  const tn = await getTranslations('shell.nav');
  const cards = ['journal', 'diary', 'schedule', 'homework', 'reportCard', 'communication'] as const;

  return (
    <>
      <section data-testid="schools-hero" className="px-4 pt-12 pb-6 md:pt-20 md:pb-8">
        <div className="mx-auto max-w-[760px]">
          <Eyebrow tone="accent">{tn('schools')}</Eyebrow>
          <h1 className="mt-5 text-4xl leading-tight font-bold tracking-tight md:text-[52px]">
            {t('hero.title')}
          </h1>
          <p className="mt-5 max-w-[640px] text-lg text-[var(--text-muted)]">{t('hero.text')}</p>
          <div className="mt-8 flex flex-wrap gap-4">
            <LinkButton href="/schools/request">{t('hero.request')}</LinkButton>
            <LinkButton href="/support?category=school_onboarding" variant="secondary">
              {t('hero.ask')}
            </LinkButton>
          </div>
        </div>
      </section>

      {/* Что получает школа — сетка 2 × 3 без значков (UX-09) */}
      <Section width="schools" titleSize="compact" testId="schools-gets" title={t('gets.title')}>
        <ul className="grid gap-3 sm:grid-cols-2">
          {cards.map((key) => (
            <li
              key={key}
              className="flex flex-col gap-1 rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--surface)] px-5 py-4"
            >
              <h3 className="font-semibold">{t(`gets.${key}`)}</h3>
              <p className="text-sm text-[var(--text-muted)]">{t(`gets.${key}Text`)}</p>
            </li>
          ))}
        </ul>
      </Section>

      {/* Чем отличается — карточка с синей полосой слева, один абзац (UX-09) */}
      <section data-testid="schools-diff" className="px-4 py-6 md:py-8">
        <div className="mx-auto max-w-[760px] rounded-[var(--radius-control)] border border-[var(--border)] border-l-[3px] border-l-[var(--accent)] bg-[var(--surface)] px-6 py-5">
          <h2 className="text-2xl font-bold tracking-tight md:text-[28px]">{t('diff.title')}</h2>
          <p className="mt-3 text-[var(--text-muted)]">
            {(['lessons', 'languages', 'devices'] as const).map((key) => t(`diff.${key}`)).join(' ')}
          </p>
        </div>
      </section>

      {/* Как подключить — нумерованный список; номер в круге декоративный, порядок передаёт <ol> (UX-09) */}
      <Section width="schools" titleSize="compact" testId="schools-connect" title={t('connect.title')}>
        <ol className="flex flex-col gap-4">
          {([1, 2, 3, 4] as const).map((n) => (
            <li key={n} className="flex items-center gap-4">
              <span
                aria-hidden="true"
                className="inline-flex size-10 shrink-0 items-center justify-center rounded-full border border-[var(--border-strong)] font-bold text-[var(--accent-bright)]"
              >
                {n}
              </span>
              <span className="font-semibold">{t(`connect.step${n}`)}</span>
            </li>
          ))}
        </ol>
      </Section>

      {/* Данные детей — утверждения отдельными строками; фраза про Закон РК — первой (UX-09) */}
      <Section width="schools" titleSize="compact" testId="schools-data" title={t('data.title')}>
        <ul className="flex flex-col gap-2 text-[var(--text-muted)]">
          <li>{t('data.text')}</li>
          <li>
            <AppLink href="/privacy" className="text-[var(--accent)] underline">
              {t('data.privacyLink')}
            </AppLink>
          </li>
        </ul>
      </Section>

      {/* Пробный период — отдельная карточка по центру (UX-09) */}
      <section data-testid="schools-trial" className="px-4 pt-6 pb-16 md:pt-8 md:pb-20">
        <div className="mx-auto flex max-w-[760px] flex-col items-center rounded-[24px] border border-[var(--border)] bg-[var(--surface)] px-6 py-10 text-center md:px-12">
          <h2 className="text-2xl font-bold tracking-tight md:text-[28px]">{t('trial.title')}</h2>
          <p className="mt-3 max-w-[560px] text-[var(--text-muted)]">{t('trial.text')}</p>
          <p className="mt-2 text-sm text-[var(--text-muted)]">{t('trial.details')}</p>
          <div className="mt-6">
            <LinkButton href="/schools/request">{t('trial.request')}</LinkButton>
          </div>
        </div>
      </section>
    </>
  );
}
