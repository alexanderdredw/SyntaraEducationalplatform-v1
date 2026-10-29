'use client';

import { type TouchEvent, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslations } from 'next-intl';
import { AI_MAX_MESSAGE_CHARS } from '@syntara/shared';
import { AssistantText } from '../../ai/assistant-text';
import { AppLink } from '../../app-link';
import { type TutorMessage, useTutorChat } from '../../learn/use-tutor-chat';
import { GuestInvite, PreviewNote, useAtlasViewer } from './gate';

/** Вопрос карточки: текст подсказки или свой и раздел (вкладка), к которому он относится. */
export interface AiAsk {
  question: string;
  tab: string | null;
  /** Новый запрос с тем же текстом — снова отправить. */
  nonce: number;
}

/**
 * Карточка «AI-помощник» (docs/SCIENTISTS_TZ.md, REQ-SCI-09 ред. 2): «✦ Syntara AI · Спросите: {имя}», три подсказки
 * текущей вкладки — список строк во всю ширину со стрелкой, поле «Свой вопрос…» с отправкой. Стиль атласа: у учёного
 * — золотая рамка, у элемента — синяя (`tone`). Ответ — в панели на этой же странице (AiPanel).
 */
export function AiCard({
  name,
  prompts,
  tone,
  onAsk,
}: {
  name: string;
  prompts: string[];
  tone: 'gold' | 'blue';
  onAsk: (question: string, trigger: HTMLElement | null) => void;
}) {
  const t = useTranslations('atlas.ai');
  const [text, setText] = useState('');
  return (
    <section className="ai-card" data-tone={tone} aria-labelledby="ai-card-title" data-testid="atlas-ai-card">
      <h4 className="ai-card-title" id="ai-card-title">
        <span className="ai-icon animated-logo ai-card-logo" aria-hidden="true">
          <span className="neural-node" />
        </span>
        <span>{t('cardTitle', { name })}</span>
      </h4>
      <ul className="ai-card-prompts">
        {prompts.map((p) => (
          <li key={p}>
            <button
              type="button"
              className="ai-card-prompt"
              onClick={(e) => onAsk(p, e.currentTarget)}
              data-testid="atlas-ai-prompt"
            >
              <span>{p}</span>
              <span aria-hidden="true">→</span>
            </button>
          </li>
        ))}
      </ul>
      <form
        className="ai-card-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (!text.trim()) return;
          onAsk(text.trim(), e.currentTarget.querySelector('button'));
          setText('');
        }}
      >
        <label htmlFor="ai-card-input" className="atlas-sr-only">
          {t('custom')}
        </label>
        <input
          id="ai-card-input"
          className="ai-card-input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={t('custom')}
          maxLength={AI_MAX_MESSAGE_CHARS}
          autoComplete="off"
          data-testid="atlas-ai-custom"
        />
        <button type="submit" className="ai-card-send" aria-label={t('send')} disabled={!text.trim()}>
          <svg
            width="18"
            height="18"
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
      </form>
    </section>
  );
}

/** Клавиши панели ответа: Esc — закрыть, Tab — по кругу внутри панели. */
function onKey(e: globalThis.KeyboardEvent, root: HTMLElement, onClose: () => void) {
  if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    onClose();
    return;
  }
  if (e.key !== 'Tab') return;
  e.stopPropagation();
  const list = [...root.querySelectorAll<HTMLElement>(FOCUSABLE)];
  if (!list.length) return;
  const first = list[0]!;
  const last = list.at(-1)!;
  // Фокус вне панели (только что открыта) — в панель.
  if (!root.contains(document.activeElement)) {
    e.preventDefault();
    first.focus();
  } else if (e.shiftKey && (document.activeElement === first || document.activeElement === root)) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Ответ Syntara AI на той же странице (REQ-SCI-09.3): компьютер — панель справа ~420 px, телефон — нижняя шторка
 * ~85 % высоты (закрывается смахиванием вниз, крестиком и Esc). Учебный ИИ платформы по уроку (`topicId`): ответ
 * потоком, следующие вопросы, «Открыть полный чат →»; разговор — в истории Syntara AI. Фокус — в панель, после
 * закрытия — на кнопку, которая её открыла. Гость — вход платформы, учитель — пояснение (как экран Syntara AI).
 */
export function AiPanel({
  topicId,
  ask,
  subject,
  fullHref,
  onClose,
  returnFocus,
}: {
  topicId: string;
  ask: AiAsk;
  subject: string;
  fullHref: string;
  onClose: () => void;
  returnFocus: HTMLElement | null;
}) {
  const t = useTranslations('atlas.ai');
  const tc = useTranslations('common');
  const tp = useTranslations('atlas.preview');
  const viewer = useAtlasViewer();
  const root = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState(0);
  const start = useRef<number | null>(null);

  useEffect(() => {
    root.current?.focus({ preventScroll: true });
    return () => {
      if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
    };
  }, [returnFocus]);

  // Esc закрывает только панель; Tab не уходит за неё (окно элемента или учёного под ней — своё): перехват на window
  // в фазе захвата — раньше обработчика окна на document, даже если фокус ещё не перешёл в панель.
  useEffect(() => {
    const node = root.current;
    if (!node) return;
    const listener = (e: globalThis.KeyboardEvent) => onKey(e, node, onClose);
    window.addEventListener('keydown', listener, true);
    return () => window.removeEventListener('keydown', listener, true);
  }, [onClose]);
  // Смахивание вниз за «ручку» (шторка на телефоне): больше 80 px — закрыть.
  const touch = {
    onTouchStart: (e: TouchEvent) => {
      start.current = e.touches[0]?.clientY ?? null;
    },
    onTouchMove: (e: TouchEvent) => {
      if (start.current !== null) setDrag(Math.max(0, (e.touches[0]?.clientY ?? 0) - start.current));
    },
    onTouchEnd: () => {
      if (drag > 80) onClose();
      start.current = null;
      setDrag(0);
    },
  };

  // Портал в корень атласа: у окна элемента/учёного backdrop-filter, и fixed внутри него считался бы от окна.
  return createPortal(
    <div className="ai-panel-layer">
      <button
        type="button"
        className="ai-panel-backdrop"
        aria-label={tc('close')}
        tabIndex={-1}
        onClick={onClose}
      />
      <div
        ref={root}
        className="ai-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ai-panel-title"
        tabIndex={-1}
        style={drag ? { transform: `translateY(${drag}px)` } : undefined}
        data-testid="atlas-ai-panel"
      >
        <div className="ai-panel-head">
          <button
            type="button"
            className="ai-panel-grab"
            aria-label={tc('close')}
            tabIndex={-1}
            onClick={onClose}
            {...touch}
          />
          <h3 id="ai-panel-title" className="ai-panel-title">
            <span className="ai-icon animated-logo ai-card-logo" aria-hidden="true">
              <span className="neural-node" />
            </span>
            {t('panelTitle', { name: subject })}
          </h3>
          <button
            type="button"
            className="ai-panel-close"
            aria-label={tc('close')}
            onClick={onClose}
            data-testid="atlas-ai-panel-close"
          >
            ×
          </button>
        </div>
        {viewer === 'student' ? (
          <PanelChat topicId={topicId} ask={ask} subject={subject} fullHref={fullHref} />
        ) : (
          <div className="ai-panel-body">
            {viewer === 'guest' ? <GuestInvite ai /> : <PreviewNote>{tp('ai')}</PreviewNote>}
          </div>
        )}
      </div>
    </div>,
    document.querySelector('[data-testid="atlas"]') ?? document.body,
  );
}

/** Диалог в панели: вопрос из карточки отправляется один раз (с именем и разделом), дальше — свои вопросы. */
function PanelChat({
  topicId,
  ask,
  subject,
  fullHref,
}: {
  topicId: string;
  ask: AiAsk;
  subject: string;
  fullHref: string;
}) {
  const t = useTranslations('atlas.ai');
  const ts = useTranslations('student.ai');
  const tc = useTranslations('ai.chat');
  const { list, ready, busy, problem, announce, input, setInput, send, stop } = useTutorChat(
    'topic_tutor',
    topicId,
  );
  const body = useRef<HTMLDivElement>(null);
  const sent = useRef<number | null>(null);
  // Контекст вопроса: имя (если его ещё нет в вопросе) и вкладка.
  const compose = (question: string, tab: string | null) =>
    question.includes(subject)
      ? tab
        ? t('messageTab', { question, tab })
        : question
      : tab
        ? t('message', { question, name: subject, tab })
        : t('messageNoTab', { question, name: subject });

  useEffect(() => {
    if (!ready || busy || sent.current === ask.nonce) return;
    sent.current = ask.nonce;
    void send(compose(ask.question, ask.tab));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- новый вопрос из карточки — новый nonce
  }, [ready, busy, ask.nonce]);

  useEffect(() => {
    if (body.current) body.current.scrollTop = body.current.scrollHeight;
  }, [list]);

  const message = (m: TutorMessage) =>
    m.role === 'user' ? (
      <div key={m.id} className="ai-panel-msg user" data-testid="tutor-user-message">
        {m.content}
      </div>
    ) : m.status === 'streaming' && !m.content ? (
      <div key={m.id} className="ai-panel-msg ai loading-pulse">
        {tc('thinking')}
      </div>
    ) : (
      <div
        key={m.id}
        className="ai-panel-msg ai"
        data-status={m.status}
        data-testid="tutor-assistant-message"
      >
        {m.status === 'failed' && !m.content ? (
          ts('unavailable')
        ) : (
          <AssistantText text={m.content} atlasUrls={[]} />
        )}
        {m.status === 'partial' ? <em> — {tc('interrupted')}</em> : null}
      </div>
    );

  return (
    <>
      <div className="ai-panel-body" ref={body} data-testid="atlas-ai-panel-body">
        {list.map(message)}
        {problem ? (
          <p role="alert" className="ai-panel-problem">
            {problem.kind === 'tooMany' ? tc('tooMany', { seconds: problem.seconds }) : tc('error')}
          </p>
        ) : null}
        <p className="atlas-sr-only" aria-live="polite">
          {announce}
        </p>
      </div>
      <form
        className="ai-card-form ai-panel-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (input.trim()) void send(input);
        }}
      >
        <label htmlFor="ai-panel-input" className="atlas-sr-only">
          {t('custom')}
        </label>
        <input
          id="ai-panel-input"
          className="ai-card-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={t('custom')}
          maxLength={AI_MAX_MESSAGE_CHARS}
          autoComplete="off"
          disabled={!ready}
        />
        {busy ? (
          <button type="button" className="ai-card-send" onClick={stop} aria-label={tc('stop')}>
            ■
          </button>
        ) : (
          <button
            type="submit"
            className="ai-card-send"
            aria-label={t('send')}
            disabled={!ready || !input.trim()}
          >
            →
          </button>
        )}
      </form>
      <AppLink href={fullHref} className="ai-panel-full" data-testid="atlas-ai-full">
        {t('openFull')}
      </AppLink>
    </>
  );
}
