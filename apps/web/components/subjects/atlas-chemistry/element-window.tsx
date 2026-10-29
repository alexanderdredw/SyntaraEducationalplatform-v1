'use client';

import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useQueryClient } from '@tanstack/react-query';
import { localDate } from '@syntara/shared';
import { apiRequest } from '@/lib/api/browser';
import { useRouter } from '@/i18n/navigation';
import { AppLink } from '../../app-link';
import {
  type AtlasElement,
  GROUP_COLORS,
  useAtlasLesson,
  useAtlasSubject,
  usePlatformTimeZone,
} from './atlas-data';
import { type AiAsk, AiCard, AiPanel } from './ai-card';
import { DetailWindow } from './detail-window';
import { useExploreQuery } from './explore';
import { useAtlasViewer } from './gate';
import { ElementSection, splitSources } from './lesson-text';
import { atlasHref, elementHref } from './routes';
import { TopicTest } from './topic-test';

/**
 * Окно элемента (REQ-ATL-03): исправленные тексты урока (content/) — вкладками по разделам урока (REQ-SCI-06), картинка
 * атласа, «Пройти тест» (решение 4).
 * Открытие окна учеником — просмотр урока: событие lesson_opened (API-S-17, REQ-ST-LES-04, +5 XP при первом).
 * /explore/:code/test — тест в блоке помощника; задание учителя приходит параметром ?assignment=.
 */
export default function ElementWindow({
  element: e,
  test,
  onClose,
}: {
  element: AtlasElement;
  test: boolean;
  onClose: () => void;
}) {
  const t = useTranslations('atlas');
  const locale = useLocale();
  const subjectId = useAtlasSubject();
  const timeZone = usePlatformTimeZone();
  const viewer = useAtlasViewer();
  const router = useRouter();
  const params = useSearchParams();
  const queryClient = useQueryClient();
  const { query } = useExploreQuery();
  const lesson = useAtlasLesson(e.topicId);
  const assistant = useRef<HTMLDivElement>(null);
  const assignment = params.get('assignment') ?? undefined;
  const groupColor = GROUP_COLORS[e.group] ?? e.color ?? '#888';
  const color = e.color ?? groupColor;
  const { text, links } = splitSources(lesson.data?.sections ?? []);

  // REQ-ST-LES-04: одно событие в день на тему; гостю и учителю событие, XP и прогресс не создаются.
  const opened = useRef(false);
  useEffect(() => {
    if (viewer !== 'student' || opened.current) return;
    opened.current = true;
    void apiRequest('/api/student/events', {
      method: 'POST',
      body: {
        type: 'lesson_opened',
        topicId: e.topicId,
        idempotencyKey: `lesson:${e.topicId}:${localDate(new Date(), timeZone)}`,
      },
      locale,
    }).then(() => {
      void queryClient.invalidateQueries({ queryKey: ['me', 'stats'] });
      void queryClient.invalidateQueries({ queryKey: ['atlas'] });
    });
  }, [viewer, e.topicId, timeZone, locale, queryClient]);

  // Тест открыт по адресу — блок помощника в видимой области окна.
  useEffect(() => {
    if (test) assistant.current?.scrollIntoView({ block: 'start' });
  }, [test]);

  const testHref = `${elementHref(subjectId, e.code, true)}${query({})}`;
  const lessonHref = `${elementHref(subjectId, e.code)}${query({})}`;
  const [tab, setTab] = useState(0);
  // REQ-SCI-09 ред. 2: вопрос из карточки «AI-помощник» — ответ в панели на этой странице (с контекстом вкладки).
  const [ask, setAsk] = useState<{ ask: AiAsk; trigger: HTMLElement | null } | null>(null);

  return (
    <DetailWindow
      testId="atlas-element-window"
      title={e.title}
      subtitle={e.description ?? ''}
      onClose={onClose}
      badge={
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 12,
            background: `${groupColor}12`,
            border: `1px solid ${groupColor}30`,
            borderRadius: 12,
            padding: '8px 16px',
            marginBottom: 12,
          }}
        >
          <div style={{ textAlign: 'center' }}>
            <div
              className="atlas-gtext"
              style={{
                fontSize: '2rem',
                fontWeight: 900,
                color: groupColor,
                lineHeight: 1,
                ['--atlas-gc' as string]: groupColor,
              }}
            >
              {e.symbol}
            </div>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>{e.number}</div>
          </div>
          <div style={{ borderLeft: `1px solid ${groupColor}30`, paddingLeft: 12 }}>
            <div
              className="atlas-gtext"
              style={{
                fontSize: '0.75rem',
                color: groupColor,
                fontWeight: 600,
                ['--atlas-gc' as string]: groupColor,
              }}
            >
              {t(`group.${e.group}`)}
            </div>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginTop: 2 }}>
              {t('detail.atomicNumber')}: {e.number}
            </div>
          </div>
        </div>
      }
      takeTest={
        <AppLink
          href={testHref}
          scroll={false}
          replace
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
            border: `2px solid ${color}20`,
            position: 'relative',
            overflow: 'hidden',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: `radial-gradient(circle at center,${color}05 0%,transparent 70%)`,
            borderRadius: 16,
          }}
        >
          {e.imageUrl ? (
            <img
              src={e.imageUrl}
              alt={e.imageAlt ?? e.title}
              width={1024}
              height={1024}
              decoding="async"
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'contain',
                filter: `drop-shadow(0 0 20px ${color}40)`,
              }}
            />
          ) : null}
        </div>
      }
      // REQ-SCI-06: вкладки — разделы урока («Основные факты» — первая), текст полностью.
      tabs={text.map((s, i) => ({ id: `${i}`, label: s.title, content: <ElementSection body={s.body} /> }))}
      tabsLabel={t('detail.tabs')}
      activeTab={tab}
      onTabChange={setTab}
      // Телефон: разделы урока — аккордеон (уточнение REQ-SCI-06).
      phone="accordion"
      extra={
        <AiCard
          title={t('ai.cardTitleElement', { name: e.title })}
          tone="blue"
          prompts={[t('ai.element.brief'), t('ai.element.detail'), t('ai.element.uses', { name: e.title })]}
          onAsk={(question, trigger) =>
            setAsk({ ask: { question, tab: text[tab]?.title ?? null, nonce: Date.now() }, trigger })
          }
        />
      }
      overlay={
        ask ? (
          <AiPanel
            topicId={e.topicId}
            ask={ask.ask}
            subject={e.title}
            fullHref={`${atlasHref(subjectId, 'syntara')}?element=${e.code}`}
            onClose={() => setAsk(null)}
            returnFocus={ask.trigger}
          />
        ) : null
      }
      resources={links}
      assistant={
        // «Пройти тест» (/explore/:code/test) — тест урока отдельным блоком под окном (кнопка остаётся, REQ-SCI-09.4).
        test ? (
          <div ref={assistant} className="ai-assistant" data-testid="atlas-element-test">
            <div className="ai-content">
              <TopicTest
                topicId={e.topicId}
                quizId={lesson.data?.quizId ?? null}
                assignmentId={assignment}
                // «Открыть урок», «К уроку» и «× Завершить» — это окно без теста.
                place={{
                  lessonHref: lessonHref,
                  backHref: lessonHref,
                  onExit: () => router.replace(lessonHref, { scroll: false }),
                  // REQ-TST-01.3: свечение верного ответа — цветом семейства элемента.
                  accent: groupColor,
                }}
              />
            </div>
          </div>
        ) : null
      }
    />
  );
}
