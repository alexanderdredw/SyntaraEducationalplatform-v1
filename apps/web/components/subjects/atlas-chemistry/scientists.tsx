'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { initials, scientistDescription } from '@syntara/shared';
import { useRouter } from '@/i18n/navigation';
import { AppLink } from '../../app-link';
import type { Lesson } from '../../lesson/lesson-view';
import { GROUP_COLORS, useAtlasData, useAtlasLesson, useAtlasSubject } from './atlas-data';
import { type AiAsk, AiCard, AiPanel } from './ai-card';
import { DetailWindow } from './detail-window';
import { AtlasQuiz } from './quiz';
import { SCIENTIST_TABS, ScientistBlocks, scientistParts, splitSources } from './lesson-text';
import { atlasHref, scientistHref } from './routes';
import {
  CheckPanel,
  Contemporaries,
  contemporariesOf,
  GOLD,
  Invite,
  Lifelines,
  QuoteCard,
  type Scientist,
  ScientistNav,
  StudiedToggle,
  useScientistsProgress,
  VerticalTimeline,
} from './scientist-parts';
import { TopicTest } from './topic-test';
import { useSearchParams } from 'next/navigation';

/** Учёные урока «Учёные-химики» в порядке ленты (год ключевого открытия), как сортировал атлас. */
function scientistsOf(lesson: Lesson | undefined): Scientist[] {
  if (!lesson) return [];
  const { text } = splitSources(lesson.sections);
  const events = new Map((lesson.timeline ?? []).map((e) => [e.sectionId, e]));
  return text
    .map((s) => {
      const ev = events.get(s.id);
      return {
        code: s.code ?? s.id,
        name: s.title,
        description: scientistDescription(s.body),
        body: s.body,
        portrait: s.illustrationUrl ?? null,
        portraitAlt: s.illustrationAlt ?? null,
        year: ev?.year ?? null,
        lived: ev?.lived ? { from: ev.lived.from, to: ev.lived.to } : null,
        discovery: ev?.title ?? '',
      };
    })
    .sort((a, b) => (a.year ?? 0) - (b.year ?? 0));
}

/**
 * «Учёные» (REQ-ATL-03; docs/SCIENTISTS_TZ.md, S1): заголовок, «Линии жизни» (компьютер — полосы жизни по оси лет,
 * телефон — вертикальная лента) и панель «Проверь себя» с игрой «Кто этот учёный?» (?game=1) и тестом урока
 * (/scientists/test) — сразу под заголовком; приглашение после 3 изученных; карточки с портретами (у Ходжкин —
 * заглушка) и отметкой «Изучено», подсветка синхронна с лентой; окно учёного (/scientists/:code). Тексты —
 * исправленный урок «Учёные-химики» (content/).
 */
export default function AtlasScientists({ code, test }: { code?: string; test?: boolean }) {
  const t = useTranslations('atlas');
  const subjectId = useAtlasSubject();
  const atlas = useAtlasData();
  const router = useRouter();
  const params = useSearchParams();
  const topicId = atlas.data?.scientists?.topicId;
  const lesson = useAtlasLesson(topicId);
  const scientists = useMemo(() => scientistsOf(lesson.data), [lesson.data]);
  const { progress } = useScientistsProgress();
  const studied = progress?.studied ?? [];
  const [active, setActive] = useState<string | null>(null);
  const open = code ? scientists.find((s) => s.code === code) : undefined;
  const game = params.get('game') === '1' || params.has('session');
  const quizBlock = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (test || game) quizBlock.current?.scrollIntoView({ block: 'start' });
  }, [test, game]);

  return (
    <section
      className="scientists-section"
      id="view-scientists"
      style={{ display: 'flex', flexDirection: 'column' }}
      data-testid="atlas-scientists"
    >
      <div className="section-header" style={{ textAlign: 'center', padding: '40px 20px 20px' }}>
        <h1 className="section-title" style={{ fontSize: '2.5rem', marginBottom: 10 }}>
          {t('timeline.title')}
        </h1>
        <p
          className="section-subtitle"
          style={{ color: 'var(--text-secondary)', maxWidth: 600, margin: '0 auto' }}
        >
          {t('timeline.subtitle')}
        </p>
      </div>

      <div className="sci-top">
        <div id="timeline-container" className="timeline-viz sci-timeline">
          <Lifelines scientists={scientists} studied={studied} active={active} onActive={setActive} />
          <VerticalTimeline scientists={scientists} studied={studied} />
        </div>
        <CheckPanel progress={progress} />
      </div>

      {test || game ? (
        <div ref={quizBlock} className="sci-quiz-block">
          {test && topicId ? (
            <div
              className="ai-assistant"
              style={{ width: '100%', maxWidth: 800, textAlign: 'left' }}
              data-testid="atlas-scientists-test"
            >
              <div className="ai-content">
                <TopicTest
                  topicId={topicId}
                  quizId={lesson.data?.quizId ?? null}
                  assignmentId={params.get('assignment') ?? undefined}
                  // «Открыть урок», «К уроку» и «× Завершить» — экран «Учёные» без теста.
                  place={{
                    lessonHref: atlasHref(subjectId, 'scientists'),
                    backHref: atlasHref(subjectId, 'scientists'),
                    onExit: () => router.push(atlasHref(subjectId, 'scientists'), { scroll: false }),
                    accent: GROUP_COLORS.scientist,
                  }}
                />
              </div>
            </div>
          ) : (
            <AtlasQuiz kind="scientists" />
          )}
        </div>
      ) : null}

      <div id="scientists-grid-container" style={{ padding: 20 }}>
        <Invite progress={progress} />
        {progress ? (
          <p className="sci-studied-count sci-studied-total" data-testid="atlas-sci-studied-total">
            {t('sci.studiedCount', { count: progress.studied.length, total: progress.total })}
          </p>
        ) : null}
        <div id="scientists-grid" className="anatomy-grid">
          {scientists.map((s) => (
            <ScientistCard
              key={s.code}
              scientist={s}
              studied={studied.includes(s.code)}
              active={active === s.code}
              onActive={setActive}
            />
          ))}
        </div>
      </div>

      {open && lesson.data ? (
        <ScientistWindow
          scientist={open}
          all={scientists}
          lesson={lesson.data}
          onClose={() => router.push(atlasHref(subjectId, 'scientists'), { scroll: false })}
        />
      ) : null}
    </section>
  );
}

/** Заглушка портрета (ScientistsTimeline.js, createPortraitPlaceholder): инициалы в золотом круге. */
function PortraitPlaceholder({ code, name }: { code: string; name: string }) {
  return (
    <svg
      viewBox="0 0 200 200"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }}
    >
      <defs>
        <radialGradient id={`bg_${code}`} cx="50%" cy="40%" r="60%">
          <stop offset="0%" stopColor="#1a1400" />
          <stop offset="100%" stopColor="#000000" />
        </radialGradient>
        <radialGradient id={`glow_${code}`} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor={GOLD} stopOpacity="0.15" />
          <stop offset="100%" stopColor={GOLD} stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="200" height="200" fill={`url(#bg_${code})`} />
      <ellipse cx="100" cy="100" rx="90" ry="90" fill={`url(#glow_${code})`} />
      <ellipse cx="100" cy="165" rx="55" ry="35" fill={GOLD} fillOpacity="0.08" />
      <path d="M55 200 Q100 150 145 200 Z" fill={GOLD} fillOpacity="0.06" />
      <circle cx="100" cy="78" r="40" fill="#0d0b00" stroke={GOLD} strokeWidth="1.5" strokeOpacity="0.4" />
      <text
        x="100"
        y="87"
        textAnchor="middle"
        dominantBaseline="middle"
        fontFamily="var(--atlas-font-space), var(--atlas-font-inter), sans-serif"
        fontSize="24"
        fontWeight="800"
        fill={GOLD}
        fillOpacity="0.9"
        letterSpacing="-1"
      >
        {initials(name)}
      </text>
      <path d="M 40 140 Q 100 120 160 140" stroke={GOLD} strokeWidth="0.5" fill="none" strokeOpacity="0.3" />
      <circle cx="100" cy="140" r="1.5" fill={GOLD} fillOpacity="0.5" />
      <circle cx="82" cy="143" r="1" fill={GOLD} fillOpacity="0.3" />
      <circle cx="118" cy="143" r="1" fill={GOLD} fillOpacity="0.3" />
    </svg>
  );
}

/** Карточка учёного; подсветка синхронна с лентой (REQ-SCI-01.4), отметка «Изучено» (REQ-SCI-04.2). */
function ScientistCard({
  scientist: s,
  studied,
  active,
  onActive,
}: {
  scientist: Scientist;
  studied: boolean;
  active: boolean;
  onActive: (code: string | null) => void;
}) {
  const t = useTranslations('atlas');
  const subjectId = useAtlasSubject();
  return (
    <AppLink
      href={scientistHref(subjectId, s.code)}
      scroll={false}
      className="anatomy-card scientist-card fade-in-up"
      style={{ borderColor: '#FDE04740' }}
      aria-label={`${s.name}. ${s.description}${studied ? `. ${t('sci.studiedMark')}` : ''}`}
      data-active={active || undefined}
      onMouseEnter={() => onActive(s.code)}
      onMouseLeave={() => onActive(null)}
      onFocus={() => onActive(s.code)}
      onBlur={() => onActive(null)}
      data-testid="atlas-scientist-card"
      data-code={s.code}
    >
      <div
        className="card-visual"
        aria-hidden="true"
        style={{ borderColor: '#FDE04740', overflow: 'hidden', position: 'relative', background: '#060401' }}
      >
        <div
          className="sci-portrait-wrap"
          style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', overflow: 'hidden' }}
        >
          {s.portrait ? (
            <>
              <div
                className="sci-portrait-placeholder"
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  height: '100%',
                  background: '#060401',
                }}
              />
              <img
                className="sci-portrait-blur-bg"
                src={s.portrait}
                alt=""
                loading="lazy"
                decoding="async"
                style={{
                  position: 'absolute',
                  top: '-10%',
                  left: '-10%',
                  width: '120%',
                  height: '120%',
                  objectFit: 'cover',
                  filter: 'blur(20px) brightness(0.4)',
                  opacity: 0.8,
                }}
              />
              <img
                className="sci-portrait-img"
                src={s.portrait}
                alt=""
                loading="lazy"
                decoding="async"
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  height: '100%',
                  objectFit: 'contain',
                  background: 'transparent',
                  opacity: 0.9,
                  transition: 'opacity 0.7s ease',
                }}
              />
            </>
          ) : (
            <div
              className="sci-portrait-placeholder"
              style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }}
            >
              <PortraitPlaceholder code={s.code} name={s.name} />
            </div>
          )}
        </div>
        <div
          className="group-tag"
          style={{
            position: 'absolute',
            top: 10,
            right: 10,
            zIndex: 3,
            background: 'rgba(253,224,71,0.12)',
            border: '1px solid rgba(253,224,71,0.28)',
            color: GOLD,
            fontSize: '0.65rem',
            fontWeight: 700,
            padding: '4px 10px',
            borderRadius: 999,
            whiteSpace: 'nowrap',
            backdropFilter: 'blur(8px)',
          }}
        >
          {t('group.scientist')}
        </div>
        {studied ? (
          <div className="sci-card-studied" data-testid="atlas-sci-card-studied">
            ✓ {t('sci.studiedMark')}
          </div>
        ) : null}
        <div
          className="visual-placeholder"
          style={{
            background: 'radial-gradient(circle at 50% 30%, rgba(253,224,71,0.06) 0%, transparent 70%)',
            opacity: 1,
            pointerEvents: 'none',
            zIndex: 1,
          }}
        />
      </div>
      <div className="card-content" style={{ padding: 20 }}>
        <h3 className="card-title" style={{ fontSize: '1.2rem', marginBottom: 8, color: '#fff' }}>
          {s.name}
        </h3>
        <p
          className="card-desc"
          style={{
            fontSize: '0.85rem',
            color: 'var(--text-secondary)',
            lineHeight: 1.5,
            height: '3.5em',
            overflow: 'hidden',
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
          }}
        >
          {s.description}
        </p>
      </div>
      <div className="card-actions" style={{ padding: '0 20px 20px' }}>
        <span
          className="btn-text"
          style={{
            color: GOLD,
            fontWeight: 600,
            fontSize: '0.85rem',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          {t('detail.explore')}
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <line x1="5" y1="12" x2="19" y2="12" />
            <polyline points="12 5 19 12 12 19" />
          </svg>
        </span>
      </div>
    </AppLink>
  );
}

/**
 * Окно учёного — то же окно, что у элемента (openAnatomyDetail): бейдж с инициалами, портрет и цитата, вкладки по
 * подразделам статьи (REQ-SCI-05: после нормализации content/ — «Биография · Открытие · Наследие · Факты», до неё —
 * подразделы урока как есть, текст полностью), «Спросить Syntara AI» (REQ-SCI-09), «Современники» (REQ-SCI-10),
 * «Отметить как изученное» (REQ-SCI-04) и «← Предыдущий · Следующий →» (REQ-SCI-11).
 */
function ScientistWindow({
  scientist: s,
  all,
  lesson,
  onClose,
}: {
  scientist: Scientist;
  all: Scientist[];
  lesson: Lesson;
  onClose: () => void;
}) {
  const t = useTranslations('atlas');
  const subjectId = useAtlasSubject();
  const topicId = useAtlasData().data?.scientists?.topicId;
  const { links } = splitSources(lesson.sections);
  // «Внешние ресурсы» учёного — его ссылки из раздела «Источники» урока.
  const resources = links.filter((l) => l.text.includes(s.name.split(' ').at(-1) ?? s.name));
  const parts = scientistParts(s.body);
  const index = all.findIndex((o) => o.code === s.code);
  const label = (code: string | null, title: string) =>
    code && (SCIENTIST_TABS as readonly string[]).includes(code) ? t(`sci.tabs.${code}`) : title;
  const normalized =
    parts.sections.length === 4 &&
    parts.sections.every((p) => p.code && SCIENTIST_TABS.includes(p.code as never));
  const [tab, setTab] = useState(0);
  const [ask, setAsk] = useState<{ ask: AiAsk; trigger: HTMLElement | null } | null>(null);
  const current = parts.sections[tab];
  // REQ-SCI-09.2: подсказки вкладки — общие формулировки с именем, пока нет утверждённых по учёному (S1b).
  const kind = tabKind(current, tab);
  const prompts = (['p1', 'p2', 'p3'] as const).map((p) => t(`ai.sci.${kind}.${p}`, { name: s.name }));
  return (
    <DetailWindow
      testId="atlas-scientist-window"
      title={s.name}
      subtitle={s.description}
      onClose={onClose}
      badge={
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 12,
            background: `${GOLD}12`,
            border: `1px solid ${GOLD}30`,
            borderRadius: 12,
            padding: '8px 16px',
            marginBottom: 12,
          }}
        >
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '2rem', fontWeight: 900, color: GOLD, lineHeight: 1 }}>
              {initials(s.name)}
            </div>
          </div>
          <div style={{ borderLeft: `1px solid ${GOLD}30`, paddingLeft: 12 }}>
            <div style={{ fontSize: '0.75rem', color: GOLD, fontWeight: 600 }}>{t('group.scientist')}</div>
            {s.lived ? (
              <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginTop: 2 }}>
                {t('sci.lived', { from: s.lived.from, to: s.lived.to })}
              </div>
            ) : null}
          </div>
        </div>
      }
      takeTest={
        <AppLink
          href={atlasHref(subjectId, 'scientists', '/test')}
          scroll={false}
          className="btn btn-primary atlas-take-test"
          data-testid="atlas-take-test"
        >
          {t('detail.takeTest')}
        </AppLink>
      }
      visual={
        <div
          className="large-visual"
          style={{
            border: `2px solid ${GOLD}20`,
            position: 'relative',
            overflow: 'hidden',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: `radial-gradient(circle at center,${GOLD}05 0%,transparent 70%)`,
            borderRadius: 16,
          }}
        >
          {s.portrait ? (
            <div
              style={{
                width: '100%',
                height: '100%',
                position: 'relative',
                overflow: 'hidden',
                borderRadius: 14,
              }}
            >
              <img
                src={s.portrait}
                alt={s.portraitAlt ?? s.name}
                decoding="async"
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                  objectPosition: 'center top',
                  filter: 'brightness(0.85) contrast(1.05)',
                  display: 'block',
                }}
              />
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  background: 'linear-gradient(to bottom, transparent 50%, rgba(5,5,5,0.85) 100%)',
                  pointerEvents: 'none',
                }}
              />
            </div>
          ) : (
            <PortraitPlaceholder code={`w_${s.code}`} name={s.name} />
          )}
        </div>
      }
      aside={
        <>
          {parts.tagline ? <div className="scientist-tagline">{parts.tagline}</div> : null}
          {parts.quote ? (
            <div className="atlas-desktop-only">
              <QuoteCard quote={parts.quote} name={s.name} />
            </div>
          ) : null}
        </>
      }
      tabs={parts.sections.map((p, i) => ({
        id: p.code ?? `${i}`,
        label: label(p.code, p.title),
        content: <ScientistBlocks blocks={p.blocks} />,
      }))}
      tabsLabel={t('sci.tabs.label')}
      activeTab={tab}
      onTabChange={setTab}
      tabsEqual={normalized}
      // Телефон: разделы статьёй с закреплённым оглавлением, цитата — после них (уточнение REQ-SCI-05).
      phone="article"
      shortLabels={parts.sections.map((p, i) => t(`sci.tabs.${tabKind(p, i)}`))}
      afterSections={parts.quote ? <QuoteCard quote={parts.quote} name={s.name} /> : null}
      extra={
        <>
          <AiCard
            name={s.name}
            tone="gold"
            prompts={prompts}
            onAsk={(question, trigger) =>
              setAsk({
                ask: {
                  question,
                  tab: current ? label(current.code, current.title) : null,
                  nonce: Date.now(),
                },
                trigger,
              })
            }
          />
          <Contemporaries list={contemporariesOf(s, all)} />
        </>
      }
      overlay={
        ask && topicId ? (
          <AiPanel
            topicId={topicId}
            ask={ask.ask}
            subject={s.name}
            fullHref={`${atlasHref(subjectId, 'syntara')}?scientists=1`}
            onClose={() => setAsk(null)}
            returnFocus={ask.trigger}
          />
        ) : null
      }
      footer={
        <div className="sci-window-footer">
          <StudiedToggle code={s.code} />
          <ScientistNav prev={all[index - 1] ?? null} next={all[index + 1] ?? null} />
        </div>
      }
      resources={resources}
    />
  );
}

/**
 * Вид вкладки для подсказок (REQ-SCI-09.2): после нормализации — код подраздела; до неё — по заголовку («факт»,
 * «наследие») или по месту (первая — биография, иначе — открытие).
 */
function tabKind(
  section: { code: string | null; title: string } | undefined,
  index: number,
): (typeof SCIENTIST_TABS)[number] {
  if (section?.code && (SCIENTIST_TABS as readonly string[]).includes(section.code))
    return section.code as (typeof SCIENTIST_TABS)[number];
  const title = section?.title.toLocaleLowerCase() ?? '';
  if (/факт|дерек|fact/.test(title)) return 'facts';
  if (/наслед|мұра|legacy/.test(title)) return 'legacy';
  return index === 0 ? 'biography' : 'discovery';
}
