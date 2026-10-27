'use client';

import { type KeyboardEvent, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { AI_MAX_MESSAGE_CHARS, AI_QUICK_ACTIONS } from '@syntara/shared';
import {
  Button,
  ChatAvatar,
  ChatCard,
  ChatLog,
  ChatMessage,
  ChatPanel,
  Pill,
  Skeleton,
  StatusDot,
  Textarea,
} from '@syntara/ui';
import { AssistantText } from '../ai/assistant-text';
import { type TutorMessage, useTutorChat } from './use-tutor-chat';

export interface TutorChatProps {
  /** topic_tutor — вкладка «Syntara AI» урока (U06–U07); general_tutor — /learn/assistant (U02). */
  context: 'topic_tutor' | 'general_tutor';
  topicId?: string;
  topicTitle?: string;
  /** id поля ввода: «Начать обучение с ИИ» ставит в него фокус (REQ-ST-AI-03). */
  inputId: string;
}

/**
 * Учебный ИИ (8.4.5, REQ-ST-AI-01..04): диалог хранится на сервере (API-S-11..13) и виден после перезагрузки;
 * ответ — потоком SSE (API-S-12), «Остановить» прерывает его — ответ сохраняется с пометкой «Ответ прерван»
 * (BR-AI-04). Ответ — Markdown без HTML, ссылки — только внутренние (REQ-NFR-SEC-06). Пока поставщик ИИ
 * не подключён — PH-19 «Учебный ИИ скоро будет доступен» (BR-AI-06).
 * Собран только из компонентов и токенов packages/ui (решение владельца 2026-10-17: дизайн — в итерации 8.5).
 */
export default function TutorChat({ context, topicId, topicTitle, inputId }: TutorChatProps) {
  const t = useTranslations('student.ai');
  const ta = useTranslations('student.assistant');
  const tc = useTranslations('ai.chat');
  const lesson = context === 'topic_tutor';

  const { conversation, list, ready, busy, problem, announce, input, setInput, send, stop } = useTutorChat(
    context,
    topicId,
  );

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send(input);
    }
  };

  const renderMessage = (m: TutorMessage) => (
    <ChatMessage
      key={m.id}
      from={m.role}
      author={m.role === 'user' ? t('you') : t('assistant')}
      data-testid={m.role === 'user' ? 'tutor-user-message' : 'tutor-assistant-message'}
      data-status={m.status}
      note={
        m.status === 'partial' ? <span data-testid="tutor-interrupted">{tc('interrupted')}</span> : undefined
      }
    >
      {m.role === 'user' ? (
        <p className="whitespace-pre-wrap">{m.content}</p>
      ) : m.status === 'failed' && !m.content ? (
        <p data-testid="tutor-unavailable">{t('unavailable')}</p>
      ) : m.status === 'streaming' && !m.content ? (
        <p className="text-[var(--text-muted)]">{tc('thinking')}</p>
      ) : (
        <AssistantText text={m.content} atlasUrls={[]} />
      )}
    </ChatMessage>
  );

  let body: ReactNode;
  if (conversation.isError) {
    body = (
      <div role="alert" className="flex flex-wrap items-center gap-3 text-sm">
        <span className="text-[var(--danger-text)]">{tc('error')}</span>
        <Button variant="secondary" onClick={() => void conversation.refetch()}>
          {tc('retry')}
        </Button>
      </div>
    );
  } else if (!ready) {
    body = <Skeleton className="h-40 w-full" />;
  } else if (lesson) {
    body = (
      <ChatLog data-testid="tutor-messages">
        <ChatMessage from="assistant" author={t('assistant')}>
          <p data-testid="tutor-greeting">{t('greeting', { topic: topicTitle ?? '' })}</p>
        </ChatMessage>
        {list.map(renderMessage)}
      </ChatLog>
    );
  } else if (list.length === 0) {
    body = (
      <div
        className="mx-auto flex flex-col gap-3 text-[15px] text-[var(--text-muted)]"
        data-testid="tutor-help"
      >
        <p className="text-base text-[var(--text)]">{ta('helpTitle')}</p>
        <ul className="flex list-['•_'] flex-col gap-2 pl-3">
          {(['explain', 'connect', 'weak', 'tests', 'summary'] as const).map((key) => (
            <li key={key}>{ta(`help.${key}`)}</li>
          ))}
        </ul>
      </div>
    );
  } else {
    body = <ChatLog data-testid="tutor-messages">{list.map(renderMessage)}</ChatLog>;
  }

  const quick = lesson ? (
    <div className="flex flex-wrap gap-2" data-testid="tutor-quick">
      {AI_QUICK_ACTIONS.map((action) => (
        <Button
          key={action}
          variant="secondary"
          size="sm"
          disabled={busy || !ready}
          onClick={() => void send(t(`quickText.${action}`), action)}
        >
          {t(`quick.${action}`)}
        </Button>
      ))}
    </div>
  ) : null;

  const status = (
    <>
      <div aria-live="polite" className="sr-only" data-testid="tutor-announce">
        {announce}
      </div>
      {busy ? (
        <div className="flex flex-wrap items-center gap-3">
          <p role="status" className="text-sm text-[var(--text-muted)]">
            {tc('thinking')}
          </p>
          <Button variant="secondary" onClick={stop} data-testid="tutor-stop">
            {tc('stop')}
          </Button>
        </div>
      ) : null}
      {problem ? (
        <p role="alert" data-testid="tutor-error" className="text-sm text-[var(--danger-text)]">
          {problem.kind === 'tooMany' ? tc('tooMany', { seconds: problem.seconds }) : tc('error')}
        </p>
      ) : null}
    </>
  );

  const form = (
    <form
      className="flex flex-col gap-3 sm:flex-row sm:items-center"
      onSubmit={(e) => {
        e.preventDefault();
        void send(input);
      }}
    >
      <Textarea
        id={inputId}
        rows={lesson ? 2 : 1}
        value={input}
        maxLength={AI_MAX_MESSAGE_CHARS}
        aria-label={lesson ? t('placeholderTopic') : t('placeholderGeneral')}
        placeholder={lesson ? t('placeholderTopic') : t('placeholderGeneral')}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={onKeyDown}
        compact
        className={lesson ? 'sm:flex-1' : 'min-h-12 resize-none sm:flex-1'}
      />
      <Button
        type="submit"
        shape="rounded"
        className={lesson ? 'sm:min-h-14 sm:px-5' : 'sm:min-h-12 sm:px-6'}
        disabled={busy || !ready || input.trim() === ''}
        data-testid="tutor-ask"
      >
        {t('ask')}
      </Button>
    </form>
  );
  const disclaimer = <p className="text-center text-xs text-[var(--text-muted)]">{t('disclaimer')}</p>;
  const regionProps = {
    role: 'region',
    'aria-label': lesson ? t('assistant') : ta('title'),
    'data-testid': 'tutor-chat',
    'data-context': context,
    'data-ready': ready,
  } as const;

  // Вкладка темы (U06–U07): карточка ≈ 664 px по центру, лента — отдельная панель.
  if (lesson) {
    return (
      <ChatCard className="mx-auto w-full max-w-[664px]" {...regionProps}>
        <p className="-mb-2 text-right text-xs text-[var(--text-muted)]" data-testid="tutor-level">
          {t('level')}
        </p>
        <ChatPanel className="min-h-[296px]">{body}</ChatPanel>
        {status}
        {quick}
        {form}
        {disclaimer}
      </ChatCard>
    );
  }

  // Страница помощника (U02): шапка, лента/«Я помогу вам», поле — отдельными зонами.
  return (
    <ChatCard inset {...regionProps}>
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--chat-panel-border)] px-6 py-4">
        <div className="flex items-center gap-3">
          <ChatAvatar letter={t('assistant').slice(0, 1)} accent size="lg" />
          <span className="font-semibold">{t('assistant')}</span>
          <StatusDot data-testid="tutor-online">{ta('online')}</StatusDot>
        </div>
        <Pill className="text-[var(--text-muted)]">{ta('mode')}</Pill>
      </header>
      <div className="flex min-h-[268px] flex-col justify-center px-6 py-8">{body}</div>
      <div className="flex flex-col gap-3 border-t border-[var(--chat-panel-border)] bg-[var(--chat-panel)]/40 px-6 py-4">
        {status}
        {form}
      </div>
      <div className="border-t border-[var(--chat-panel-border)] px-6 py-3">{disclaimer}</div>
    </ChatCard>
  );
}
