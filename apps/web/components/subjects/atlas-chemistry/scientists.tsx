'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { initials, scientistDescription } from '@syntara/shared';
import { useRouter } from '@/i18n/navigation';
import { AppLink } from '../../app-link';
import type { Lesson } from '../../lesson/lesson-view';
import { GROUP_COLORS, SCIENTIST_LAYERS, useAtlasData, useAtlasLesson, useAtlasSubject } from './atlas-data';
import { AssistantBlock, type AssistantMode, DetailWindow } from './detail-window';
import { AtlasQuiz } from './quiz';
import { ScientistArticle, splitSources } from './lesson-text';
import { atlasHref, scientistHref } from './routes';
import { TopicTest } from './topic-test';
import { useSearchParams } from 'next/navigation';

const GOLD = '#FDE047';

interface Scientist {
  code: string;
  name: string;
  description: string;
  body: string | null;
  portrait: string | null;
  portraitAlt: string | null;
  year: number | null;
}

/** Учёные урока «Учёные-химики» в порядке ленты (год ключевого открытия), как сортировал атлас. */
function scientistsOf(lesson: Lesson | undefined): Scientist[] {
  if (!lesson) return [];
  const { text } = splitSources(lesson.sections);
  const years = new Map((lesson.timeline ?? []).map((e) => [e.sectionId, e.year]));
  return text
    .map((s) => ({
      code: s.code ?? s.id,
      name: s.title,
      description: scientistDescription(s.body),
      body: s.body,
      portrait: s.illustrationUrl ?? null,
      portraitAlt: s.illustrationAlt ?? null,
      year: years.get(s.id) ?? null,
    }))
    .sort((a, b) => (a.year ?? 0) - (b.year ?? 0));
}

/**
 * «Учёные» (REQ-ATL-03; ScientistsTimeline.js, ScientistsQuiz.js атласа): «Хронология научных открытий», лента по
 * годам, карточки с портретами (решение 8; у Ходжкин — заглушка с инициалами из оригинала), окно учёного
 * (/scientists/:code). Внизу — игра «Кто этот учёный?» и «Пройти тест» урока «Учёные-химики» (решение А-5,
 * /scientists/test). Тексты — исправленный урок «Учёные-химики» (content/).
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
  const open = code ? scientists.find((s) => s.code === code) : undefined;
  const quizBlock = useRef<HTMLDivElement>(null);
  const testHref = atlasHref(subjectId, 'scientists', '/test');

  useEffect(() => {
    if (test) quizBlock.current?.scrollIntoView({ block: 'start' });
  }, [test]);

  return (
    <section
      className="scientists-section"
      id="view-scientists"
      style={{ display: 'flex', flexDirection: 'column' }}
      data-testid="atlas-scientists"
    >
      <div className="section-header" style={{ textAlign: 'center', padding: '40px 20px' }}>
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

      <div id="timeline-container" className="timeline-viz" style={{ padding: 20, minHeight: 200 }}>
        <Timeline scientists={scientists} />
      </div>

      <div id="scientists-grid-container" style={{ padding: 20 }}>
        <div id="scientists-grid" className="anatomy-grid">
          {scientists.map((s) => (
            <ScientistCard key={s.code} scientist={s} />
          ))}
        </div>
      </div>

      <div
        id="scientists-quiz-container"
        ref={quizBlock}
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          textAlign: 'center',
          alignSelf: 'center',
          padding: '40px 20px',
          width: '100%',
          maxWidth: 1200,
          margin: '40px auto 0',
          borderTop: '1px solid rgba(255,255,255,0.05)',
        }}
      >
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
          <AtlasQuiz
            kind="scientists"
            extra={
              <AppLink
                href={testHref}
                scroll={false}
                className="btn btn-secondary"
                data-testid="atlas-scientists-take-test"
              >
                {t('detail.takeTest')}
              </AppLink>
            }
          />
        )}
      </div>

      {open && lesson.data ? (
        <ScientistWindow
          scientist={open}
          lesson={lesson.data}
          onClose={() => router.push(atlasHref(subjectId, 'scientists'), { scroll: false })}
          onMode={(mode: AssistantMode) => {
            if (mode === 'quiz') router.push(testHref, { scroll: false });
            else
              router.push(
                `${atlasHref(subjectId, 'syntara')}?scientists=1&action=${mode === 'simple' ? 'simpler' : 'more_detail'}`,
              );
          }}
        />
      ) : null}
    </section>
  );
}

/** Лента (ScientistsTimeline.js): золотая линия, точки через одну смещены вниз, фамилия под точкой. */
function Timeline({ scientists }: { scientists: Scientist[] }) {
  const subjectId = useAtlasSubject();
  return (
    <div
      className="timeline-wrapper"
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'flex-start',
        position: 'relative',
        padding: '60px 40px',
        margin: '20px 0',
        overflowX: 'auto',
        scrollbarWidth: 'none',
        msOverflowStyle: 'none',
        scrollBehavior: 'smooth',
      }}
      data-testid="atlas-timeline"
    >
      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          top: 85,
          left: 0,
          width: '100%',
          height: 2,
          background:
            'linear-gradient(90deg, rgba(253, 224, 71, 0), rgba(253, 224, 71, 0.5) 20%, rgba(253, 224, 71, 0.5) 80%, rgba(253, 224, 71, 0))',
          zIndex: 1,
        }}
      />
      {scientists.map((s, index) => (
        <AppLink
          key={s.code}
          href={scientistHref(subjectId, s.code)}
          scroll={false}
          className="atlas-timeline-point"
          aria-label={`${s.year ?? ''} — ${s.name}`}
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            zIndex: 2,
            cursor: 'pointer',
            transition: 'all 0.4s cubic-bezier(0.4, 0, 0.2, 1)',
            minWidth: 160,
            position: 'relative',
            paddingTop: index % 2 === 0 ? 0 : 45,
          }}
        >
          <span
            aria-hidden="true"
            style={{
              fontSize: '0.75rem',
              fontWeight: 800,
              color: GOLD,
              marginBottom: 10,
              fontFamily: 'var(--atlas-font-space), sans-serif',
              letterSpacing: '0.05em',
              opacity: 0.8,
            }}
          >
            {s.year}
          </span>
          <span
            aria-hidden="true"
            className="atlas-timeline-dot"
            style={{
              width: 14,
              height: 14,
              borderRadius: '50%',
              background: GOLD,
              border: '3px solid var(--bg-primary)',
              transition: 'all 0.3s ease',
              marginBottom: 12,
            }}
          />
          <span
            aria-hidden="true"
            className="atlas-timeline-name"
            style={{
              fontSize: '0.85rem',
              fontWeight: 600,
              textAlign: 'center',
              whiteSpace: 'nowrap',
              transition: 'all 0.3s ease',
            }}
          >
            {s.name.split(' ').at(-1)}
          </span>
        </AppLink>
      ))}
    </div>
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

function ScientistCard({ scientist: s }: { scientist: Scientist }) {
  const t = useTranslations('atlas');
  const subjectId = useAtlasSubject();
  return (
    <AppLink
      href={scientistHref(subjectId, s.code)}
      scroll={false}
      className="anatomy-card scientist-card fade-in-up"
      style={{ borderColor: '#FDE04740' }}
      aria-label={`${s.name}. ${s.description}`}
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

/** Окно учёного — то же окно, что у элемента (openAnatomyDetail): бейдж с инициалами, портрет, статья. */
function ScientistWindow({
  scientist: s,
  lesson,
  onClose,
  onMode,
}: {
  scientist: Scientist;
  lesson: Lesson;
  onClose: () => void;
  onMode: (mode: AssistantMode) => void;
}) {
  const t = useTranslations('atlas');
  const subjectId = useAtlasSubject();
  const { links } = splitSources(lesson.sections);
  // «Внешние ресурсы» учёного — его ссылки из раздела «Источники» урока.
  const resources = links.filter((l) => l.text.includes(s.name.split(' ').at(-1) ?? s.name));
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
      overview={<ScientistArticle body={s.body} />}
      layers={SCIENTIST_LAYERS.map((l) => t(`layer.${l}`))}
      resources={resources}
      assistant={
        <AssistantBlock mode={null} onMode={onMode}>
          {null}
        </AssistantBlock>
      }
    />
  );
}
