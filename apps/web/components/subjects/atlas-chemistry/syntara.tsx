'use client';

import { type CSSProperties, useEffect, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { type AiQuickAction } from '@syntara/shared';
import { AssistantText } from '../../ai/assistant-text';
import { type TutorMessage, useTutorChat } from '../../learn/use-tutor-chat';
import { useAtlasData, useAtlasLesson } from './atlas-data';
import { GuestInvite, PreviewNote, useAtlasViewer } from './gate';

const MODES: Array<{ icon: string; key: 'Simple' | 'Deep' | 'Test' | 'Challenge'; action: AiQuickAction }> = [
  { icon: '✨', key: 'Simple', action: 'simpler' },
  { icon: '🧬', key: 'Deep', action: 'more_detail' },
  { icon: '📝', key: 'Test', action: 'check_me' },
  { icon: '🔥', key: 'Challenge', action: 'check_me' },
];

/**
 * Syntara AI атласа (REQ-ATL-03, docs/ATLAS_MAP.md, раздел 6): экран оригинала — заголовок, «Начать обучение с ИИ»
 * (прокрутка к чату и фокус), «Как это работает» (к режимам), окно чата, четыре режима, панель показателей.
 * Чат — учебный ИИ платформы на сервере (API-S-11…13; без DeepSeek и ключей в браузере): с элементом из адреса
 * (?element=) или уроком «Учёные-химики» (?scientists=1) — по теме, иначе общий. Режимы — быстрые действия
 * (simpler, more_detail, check_me). Показатели — данные платформы (решение А-15, без «Времени обучения»).
 * Гостю — вход; учителю — пояснение (решение А-9).
 */
export default function AtlasSyntara() {
  const t = useTranslations('atlas.syntara');
  const tp = useTranslations('atlas.preview');
  const viewer = useAtlasViewer();
  const slot = useRef<HTMLDivElement>(null);
  const modes = useRef<HTMLDivElement>(null);

  return (
    <section
      id="view-syntara"
      className="syntara-section"
      style={{ display: 'flex' }}
      data-testid="atlas-syntara"
    >
      <div className="syntara-container fade-in-up">
        <div className="syntara-hero">
          <h1 className="syntara-title">Syntara AI</h1>
          <p className="syntara-subtitle">{t('subtitle')}</p>
          <p className="syntara-description">{t('desc')}</p>
          <div className="syntara-actions">
            <button
              type="button"
              className="btn btn-primary glow-effect"
              onClick={() => {
                slot.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                window.setTimeout(() => {
                  document.getElementById('atlas-ai-input')?.focus();
                  if (slot.current) {
                    slot.current.style.boxShadow = '0 0 30px rgba(0, 122, 255, 0.3)';
                    window.setTimeout(() => slot.current && (slot.current.style.boxShadow = ''), 1000);
                  }
                }, 500);
              }}
            >
              {t('start')}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => modes.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })}
            >
              {t('works')}
            </button>
          </div>
        </div>

        {viewer === 'student' ? (
          <StudentChat slotRef={slot} modesRef={modes} />
        ) : (
          <>
            <div className="ai-slot-container" ref={slot} data-testid="atlas-ai-slot">
              <ChatHeader />
              <div className="ai-body">
                <div
                  className="ai-placeholder-message"
                  style={{ textAlign: 'center', opacity: 0.9, lineHeight: 1.6 }}
                >
                  {viewer === 'guest' ? <GuestInvite ai /> : <PreviewNote>{tp('ai')}</PreviewNote>}
                </div>
              </div>
            </div>
            <Modes modesRef={modes} />
          </>
        )}
      </div>
    </section>
  );
}

function ChatHeader() {
  const t = useTranslations('atlas.syntara');
  return (
    <div className="ai-header">
      <div className="ai-status-group">
        <div className="ai-avatar" aria-hidden="true">
          <div className="neural-node" />
        </div>
        <div className="ai-info">
          <span className="ai-name">Syntara</span>
          <span className="ai-status">
            <span className="status-dot" aria-hidden="true" /> <span>{t('online')}</span>
          </span>
        </div>
      </div>
      <div className="ai-mode-badge">{t('mode')}</div>
      <div className="voice-toggle" />
    </div>
  );
}

function Modes({
  modesRef,
  onMode,
}: {
  modesRef: React.RefObject<HTMLDivElement | null>;
  onMode?: (a: AiQuickAction) => void;
}) {
  const t = useTranslations('atlas.syntara');
  return (
    <div className="modes-grid" ref={modesRef} data-testid="atlas-ai-modes">
      {MODES.map((m) => (
        <button
          key={m.key}
          type="button"
          className="mode-card"
          disabled={!onMode}
          onClick={() => onMode?.(m.action)}
          data-action={m.action}
        >
          <div className="mode-icon" aria-hidden="true">
            {m.icon}
          </div>
          <div className="mode-title">{t(`mode${m.key}`)}</div>
          <div className="mode-desc">{t(`mode${m.key}Desc`)}</div>
        </button>
      ))}
    </div>
  );
}

const userStyle: CSSProperties = {
  background: 'rgba(255, 255, 255, 0.1)',
  padding: '12px 16px',
  borderRadius: '16px 16px 2px 16px',
  marginBottom: 12,
  marginLeft: 'auto',
  maxWidth: '80%',
  width: 'fit-content',
  color: 'var(--text-primary)',
};
const aiStyle = (error: boolean): CSSProperties => ({
  background: error ? 'rgba(255, 59, 48, 0.1)' : 'rgba(0, 122, 255, 0.1)',
  padding: '12px 16px',
  borderRadius: '16px 16px 16px 2px',
  marginBottom: 12,
  marginRight: 'auto',
  maxWidth: '85%',
  color: 'var(--text-primary)',
  border: '1px solid rgba(255, 255, 255, 0.05)',
});

function StudentChat({
  slotRef,
  modesRef,
}: {
  slotRef: React.RefObject<HTMLDivElement | null>;
  modesRef: React.RefObject<HTMLDivElement | null>;
}) {
  const t = useTranslations('atlas.syntara');
  const ts = useTranslations('student.ai');
  const tc = useTranslations('ai.chat');
  const params = useSearchParams();
  const atlas = useAtlasData();
  const element = params.get('element');
  const topicId = element
    ? atlas.data?.elements.find((e) => e.code === element)?.topicId
    : params.get('scientists')
      ? atlas.data?.scientists?.topicId
      : undefined;
  const waiting = Boolean(element || params.get('scientists')) && !atlas.data;
  return waiting ? null : (
    <Chat
      key={topicId ?? 'general'}
      topicId={topicId}
      slotRef={slotRef}
      modesRef={modesRef}
      t={t}
      ts={ts}
      tc={tc}
    />
  );
}

function Chat({
  topicId,
  slotRef,
  modesRef,
  t,
  ts,
  tc,
}: {
  topicId: string | undefined;
  slotRef: React.RefObject<HTMLDivElement | null>;
  modesRef: React.RefObject<HTMLDivElement | null>;
  t: ReturnType<typeof useTranslations>;
  ts: ReturnType<typeof useTranslations>;
  tc: ReturnType<typeof useTranslations>;
}) {
  const params = useSearchParams();
  const { list, ready, busy, problem, announce, input, setInput, send, stop } = useTutorChat(
    topicId ? 'topic_tutor' : 'general_tutor',
    topicId,
  );
  const body = useRef<HTMLDivElement>(null);
  const quick = (action: AiQuickAction) => void send(ts(`quickText.${action}`), action);

  // «Спросить Syntara AI об учёном» (docs/SCIENTISTS_TZ.md, REQ-SCI-09): контекст — урок «Учёные-химики»; выбранный
  // вопрос-чип отправляется один раз с именем учёного, без чипа — имя учёного в поле ввода.
  const tsci = useTranslations('atlas.sci.ai');
  const lesson = useAtlasLesson(params.get('scientist') ? topicId : undefined);
  const scientist = lesson.data?.sections.find((x) => x.code === params.get('scientist'))?.title;
  const asked = useRef(false);
  useEffect(() => {
    const ask = params.get('ask');
    if (!ready || !scientist || asked.current) return;
    asked.current = true;
    const url = new URL(window.location.href);
    url.searchParams.delete('ask');
    window.history.replaceState(null, '', url);
    if (ask === 'explain' || ask === 'table' || ask === 'today')
      void send(tsci('message', { name: scientist, question: tsci(ask) }));
    else setInput(`${scientist}: `);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- один раз, когда диалог и урок загружены
  }, [ready, scientist]);

  // «Кратко» / «Подробно» из окна элемента (решение А-3): быстрое действие отправляется один раз.
  const sent = useRef(false);
  useEffect(() => {
    const action = params.get('action');
    if (!ready || sent.current || (action !== 'simpler' && action !== 'more_detail')) return;
    sent.current = true;
    const url = new URL(window.location.href);
    url.searchParams.delete('action');
    window.history.replaceState(null, '', url);
    quick(action);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- один раз после загрузки диалога
  }, [ready]);

  useEffect(() => {
    if (body.current) body.current.scrollTop = body.current.scrollHeight;
  }, [list]);

  const message = (m: TutorMessage) =>
    m.role === 'user' ? (
      <div key={m.id} className="message user" style={userStyle} data-testid="tutor-user-message">
        {m.content}
      </div>
    ) : m.status === 'streaming' && !m.content ? (
      <div key={m.id} className="message ai loading-pulse" style={aiStyle(false)}>
        {t('thinking')}
      </div>
    ) : (
      <div
        key={m.id}
        className={`message ${m.status === 'failed' ? 'ai-error' : 'ai'}`}
        style={aiStyle(m.status === 'failed')}
        data-testid="tutor-assistant-message"
        data-status={m.status}
      >
        {m.status === 'failed' && !m.content ? (
          <span data-testid="tutor-unavailable">{ts('unavailable')}</span>
        ) : (
          <AssistantText text={m.content} atlasUrls={[]} />
        )}
        {m.status === 'partial' ? <em> — {tc('interrupted')}</em> : null}
      </div>
    );

  return (
    <>
      <div className="ai-slot-container" ref={slotRef} data-testid="atlas-ai-slot">
        <ChatHeader />
        <div
          className="ai-body"
          ref={body}
          style={
            list.length
              ? {
                  display: 'block',
                  overflowY: 'auto',
                  maxHeight: 400,
                  alignItems: 'flex-start',
                  justifyContent: 'flex-start',
                  padding: 20,
                }
              : undefined
          }
          role="log"
          aria-label="Syntara"
          data-testid="tutor-messages"
        >
          {list.length ? (
            list.map(message)
          ) : (
            <div
              className="ai-placeholder-message"
              style={{ textAlign: 'left', opacity: 0.9, lineHeight: 1.6 }}
            >
              <h3 style={{ marginBottom: 15, color: 'var(--text-primary)', fontSize: '1.2rem' }}>
                {t('ask')}
              </h3>
              <p style={{ marginBottom: 8, color: 'var(--text-secondary)' }}>{t('iWill')}</p>
              <ul style={{ listStyle: 'none', paddingLeft: 0, color: 'var(--text-secondary)' }}>
                {(['bullet1', 'bullet2', 'bullet3', 'bullet4', 'bullet5'] as const).map((b) => (
                  <li key={b} style={{ marginBottom: 5 }}>
                    • {t(b)}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
        <p className="atlas-sr-only" aria-live="polite">
          {announce}
        </p>
        {problem ? (
          <p role="alert" style={{ color: 'var(--accent-red)', padding: '0 20px' }} data-testid="tutor-error">
            {problem.kind === 'tooMany' ? tc('tooMany', { seconds: problem.seconds }) : tc('error')}
          </p>
        ) : null}
        <form
          className="ai-input-area"
          onSubmit={(e) => {
            e.preventDefault();
            void send(input);
          }}
        >
          <input
            id="atlas-ai-input"
            type="text"
            className="ai-input-bar"
            placeholder={t('example')}
            aria-label={ts('placeholderGeneral')}
            value={input}
            maxLength={2000}
            onChange={(e) => setInput(e.target.value)}
            disabled={!ready}
            data-testid="tutor-input"
          />
          {busy ? (
            <button
              type="button"
              className="ai-action-btn"
              onClick={stop}
              aria-label={tc('stop')}
              data-testid="tutor-stop"
            >
              ■
            </button>
          ) : (
            <button
              type="submit"
              className="ai-action-btn send-btn"
              style={{ background: 'var(--text-primary)', color: 'var(--bg-primary)' }}
              aria-label={ts('ask')}
              disabled={!ready || !input.trim()}
              data-testid="tutor-ask"
            >
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                aria-hidden="true"
              >
                <line x1="22" y1="2" x2="11" y2="13" />
                <polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
            </button>
          )}
        </form>
      </div>
      <Modes modesRef={modesRef} onMode={!ready || busy ? undefined : quick} />
      <Stats />
    </>
  );
}

/** Панель показателей (решение А-15): слабые места, рекомендуется, точность — по данным платформы. */
function Stats() {
  const t = useTranslations('atlas.syntara');
  const atlas = useAtlasData();
  const stats = atlas.data?.stats;
  return (
    <div className="stats-preview-panel" id="syntara-stats-panel" data-testid="atlas-ai-stats">
      <div className="stat-item">
        <div className="stat-value">{stats?.weak ?? 0}</div>
        <div className="stat-label">{t('statWeak')}</div>
      </div>
      <div className="stat-item">
        <div className="stat-value stat-value-text">{stats?.recommended ?? '-'}</div>
        <div className="stat-label">{t('statRec')}</div>
      </div>
      <div className="stat-item">
        <div className="stat-value">{stats?.accuracy ?? 0}%</div>
        <div className="stat-label">{t('statAcc')}</div>
      </div>
    </div>
  );
}
