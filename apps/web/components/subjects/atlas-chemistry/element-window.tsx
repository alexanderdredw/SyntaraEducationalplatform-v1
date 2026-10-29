'use client';

import { type CSSProperties, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useQueryClient } from '@tanstack/react-query';
import {
  ELEMENT_TAB_GROUPS,
  type ElementTabGroup,
  electronConfig,
  localDate,
  periodicElement,
  sectionGroup,
} from '@syntara/shared';
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
import { BohrModel } from './bohr-model';
import { DetailWindow } from './detail-window';
import { useExploreQuery } from './explore-query';
import { useAtlasViewer } from './gate';
import { ElementSection, splitSources } from './lesson-text';
import { MiniTable } from './mini-table';
import { atlasHref, elementHref } from './routes';
import { TopicTest } from './topic-test';

/** Атомная масса по языку интерфейса: 6,94 / 6.94 (REQ-EXP-03.1). */
export const formatMass = (mass: number, locale: string) =>
  new Intl.NumberFormat(locale, { maximumFractionDigits: 4 }).format(mass);

/** Стрелки не перехватываются в полях ввода, во вкладках и в панели ответа (REQ-EXP-04.4). */
function ownsArrows(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(
    target.closest(
      'input, textarea, select, [contenteditable="true"], [role="tab"], [role="tablist"], .ai-panel',
    ),
  );
}

/**
 * Окно элемента (REQ-ATL-03; docs/EXPLORE_TZ.md, И1): компактная шапка; слева — закреплённая колонка
 * «Иллюстрация ⇄ Модель Бора» (REQ-EXP-05), «Ключевые данные», мини-таблица (REQ-EXP-06) и «← предыдущий ·
 * следующий →» по номеру; справа — 5 групп вкладок (REQ-EXP-07, на телефоне — аккордеон групп), AI-помощник с
 * контекстом группы и «Внешние ресурсы». Открытие учеником — просмотр урока: lesson_opened (API-S-17, REQ-ST-LES-04).
 * /explore/:code/test — тест в блоке помощника; задание учителя приходит параметром ?assignment=.
 */
export default function ElementWindow({
  element: e,
  all,
  test,
  onClose,
}: {
  element: AtlasElement;
  /** Все элементы с уроками — соседи мини-таблицы и навигация по номеру. */
  all: AtlasElement[];
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
  const p = periodicElement(e.number);
  const lessons = useMemo(() => new Map(all.map((x) => [x.number, x])), [all]);
  const sorted = useMemo(() => [...all].sort((a, b) => a.number - b.number), [all]);
  const index = sorted.findIndex((x) => x.number === e.number);
  const prev = sorted[index - 1] ?? null;
  const next = sorted[index + 1] ?? null;
  const q = query({});
  const href = (x: AtlasElement) => `${elementHref(subjectId, x.code)}${q}`;

  // REQ-ST-LES-04: одно событие в день на тему; гостю и учителю событие, XP и прогресс не создаются.
  const opened = useRef<string | null>(null);
  useEffect(() => {
    if (viewer !== 'student' || opened.current === e.topicId) return;
    opened.current = e.topicId;
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

  const testHref = `${elementHref(subjectId, e.code, true)}${q}`;
  const lessonHref = `${elementHref(subjectId, e.code)}${q}`;
  const [tab, setTab] = useState(0);
  // REQ-EXP-05.3: для иллюстраций с ошибкой по умолчанию — модель Бора.
  const [model, setModel] = useState<'image' | 'bohr'>(e.bohrDefault || !e.imageUrl ? 'bohr' : 'image');
  // REQ-SCI-09 ред. 2: вопрос из карточки «AI-помощник» — ответ в панели на этой странице (с контекстом группы).
  const [ask, setAsk] = useState<{ ask: AiAsk; trigger: HTMLElement | null } | null>(null);
  // Новый элемент (← →, соседи) — окно монтируется заново (key в explore.tsx): первая вкладка и вид по умолчанию.

  // REQ-EXP-04.4: ← → переключают элемент, если фокус не в поле ввода и не во вкладках.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || ask) return;
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      if (ownsArrows(event.target)) return;
      const target = event.key === 'ArrowLeft' ? prev : next;
      if (!target) return;
      event.preventDefault();
      router.replace(href(target), { scroll: false });
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  // REQ-EXP-07: разделы урока — в 5 группах, полностью, подзаголовками h3, в исходном порядке; незнакомое — «Обзор».
  const groups = useMemo(() => {
    const by = new Map<ElementTabGroup, typeof text>(ELEMENT_TAB_GROUPS.map((g) => [g, []]));
    for (const s of text) by.get(sectionGroup(s.code, s.title) ?? 'overview')!.push(s);
    return ELEMENT_TAB_GROUPS.filter((g) => by.get(g)!.length).map((g) => ({ g, sections: by.get(g)! }));
  }, [text]);
  const active = groups[Math.min(tab, groups.length - 1)]?.g ?? 'overview';

  const facts: Array<[string, string]> = [
    [t('data.number'), String(e.number)],
    [t('data.symbol'), e.symbol],
    ...(e.mass !== null ? [[t('data.mass'), formatMass(e.mass, locale)] as [string, string]] : []),
    [t('data.config'), electronConfig(e.number)],
    ...(p ? [[t('data.period'), String(p.period)] as [string, string]] : []),
    ...(p?.group ? [[t('data.group'), String(p.group)] as [string, string]] : []),
    [t('data.family'), t(`group.${e.group}`)],
  ];

  return (
    <DetailWindow
      testId="atlas-element-window"
      compact
      title={e.title}
      subtitle={e.description ?? ''}
      onClose={onClose}
      badge={
        <div className="el-badge" style={{ '--atlas-gc': groupColor } as CSSProperties}>
          <span className="el-badge-number">{e.number}</span>
          <span className="el-badge-symbol atlas-gtext">{e.symbol}</span>
          <span className="el-badge-family atlas-gtext">{t(`group.${e.group}`)}</span>
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
        <>
          <div className="el-model-switch" role="group" aria-label={t('model.label')}>
            {(['image', 'bohr'] as const).map((m) => (
              <button
                key={m}
                type="button"
                aria-pressed={model === m}
                className={model === m ? 'active' : undefined}
                onClick={() => setModel(m)}
                disabled={m === 'image' && !e.imageUrl}
                data-testid={`atlas-model-${m}`}
              >
                {t(`model.${m}`)}
              </button>
            ))}
          </div>
          <div
            className="large-visual el-visual"
            style={{
              border: `2px solid ${color}20`,
              background: `radial-gradient(circle at center,${color}12 0%,transparent 70%)`,
            }}
          >
            {model === 'bohr' || !e.imageUrl ? (
              <BohrModel number={e.number} symbol={e.symbol} name={e.title} color={groupColor} />
            ) : (
              <img
                src={e.imageUrl}
                alt={e.imageAlt ?? e.title}
                width={1024}
                height={1024}
                decoding="async"
                style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                data-testid="atlas-element-image"
              />
            )}
          </div>
        </>
      }
      aside={
        <>
          <section className="el-data" aria-labelledby="el-data-title" data-testid="atlas-el-data">
            <h4 id="el-data-title">{t('data.title')}</h4>
            <dl>
              {facts.map(([k, v]) => (
                <div key={k} className="el-data-row">
                  <dt>{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
          </section>
          <MiniTable element={e} lessons={lessons} query={q} />
          <nav className="el-nav" aria-label={t('elNav.label')} data-testid="atlas-el-nav">
            {prev ? (
              <AppLink
                href={href(prev)}
                scroll={false}
                replace
                className="el-nav-btn prev"
                data-testid="atlas-el-prev"
              >
                {t('elNav.prev', { name: prev.title })}
              </AppLink>
            ) : (
              <span />
            )}
            {next ? (
              <AppLink
                href={href(next)}
                scroll={false}
                replace
                className="el-nav-btn next"
                data-testid="atlas-el-next"
              >
                {t('elNav.next', { name: next.title })}
              </AppLink>
            ) : null}
          </nav>
        </>
      }
      // REQ-EXP-07: 5 групп — вкладки в одну строку; разделы урока внутри — полностью, подзаголовками h3.
      tabs={groups.map(({ g, sections }) => ({
        id: g,
        label: t(`tabGroup.${g}`),
        content: (
          <div className="el-group" data-group={g}>
            {sections.map((s) => (
              <section
                key={s.id}
                className="el-group-section"
                data-testid="atlas-el-section"
                data-code={s.code}
              >
                <h3>{s.title}</h3>
                <ElementSection body={s.body} />
              </section>
            ))}
          </div>
        ),
      }))}
      tabsLabel={t('detail.tabs')}
      activeTab={tab}
      onTabChange={setTab}
      tabsEqual
      // Телефон: аккордеон из 5 групп, первая открыта, «Следующий: {группа} →».
      phone="accordion"
      extra={
        <AiCard
          title={t('ai.cardTitleElement', { name: e.title })}
          tone="blue"
          prompts={(['p1', 'p2', 'p3'] as const).map((k) => t(`ai.group.${active}.${k}`, { name: e.title }))}
          onAsk={(question, trigger) =>
            setAsk({ ask: { question, tab: t(`tabGroup.${active}`), nonce: Date.now() }, trigger })
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
