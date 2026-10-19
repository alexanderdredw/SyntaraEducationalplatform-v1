'use client';

import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { AI_MAX_MESSAGE_CHARS, AI_QUICK_ACTIONS, type AiQuickAction, parseSse } from '@syntara/shared';
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
import { apiRequest, csrfToken } from '@/lib/api/browser';
import { AssistantText } from '../ai/assistant-text';

type Status = 'streaming' | 'complete' | 'partial' | 'failed';
interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  status: Status;
}
interface History {
  id: string;
  messages: Message[];
}
type Problem = { kind: 'error' } | { kind: 'tooMany'; seconds: number } | null;

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
  const locale = useLocale();
  const lesson = context === 'topic_tutor';

  const conversation = useQuery({
    queryKey: ['student', 'ai', context, topicId ?? null],
    queryFn: async (): Promise<History> => {
      const opened = await apiRequest<{ id: string }>('/api/student/ai/conversations', {
        method: 'POST',
        body: lesson ? { context, topicId } : { context },
        locale,
      });
      if (opened.kind !== 'ok') throw new Error('conversation');
      const history = await apiRequest<History>(`/api/student/ai/conversations/${opened.data.id}`, {
        locale,
      });
      if (history.kind !== 'ok') throw new Error('history');
      return history.data;
    },
    staleTime: Infinity,
  });

  const [messages, storeMessages] = useState<Message[] | null>(null);
  const [input, setInput] = useState('');
  const [problem, setProblem] = useState<Problem>(null);
  const [announce, setAnnounce] = useState('');
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const messagesRef = useRef<Message[]>([]);
  // Обновления потока идут чаще отрисовки — актуальный список держим в ref.
  const setMessages = useCallback((next: Message[]) => {
    messagesRef.current = next;
    storeMessages(next);
  }, []);

  useEffect(() => () => abortRef.current?.abort(), []);

  const update = useCallback(
    (id: string, patch: Partial<Message>) =>
      setMessages(messagesRef.current.map((m) => (m.id === id ? { ...m, ...patch } : m))),
    [setMessages],
  );

  const send = useCallback(
    async (raw: string, quickAction?: AiQuickAction) => {
      const text = raw.trim();
      const id = conversation.data?.id;
      if (!id || !text || busy || text.length > AI_MAX_MESSAGE_CHARS) return;
      const question: Message = { id: crypto.randomUUID(), role: 'user', content: text, status: 'complete' };
      const reply: Message = { id: crypto.randomUUID(), role: 'assistant', content: '', status: 'streaming' };
      // До первого вопроса в ленте — история с сервера (API-S-13).
      const before = messagesRef.current.length ? messagesRef.current : (conversation.data?.messages ?? []);
      setMessages([...before, question, reply]);
      if (!quickAction) setInput('');
      setProblem(null);
      setBusy(true);

      // Запрос не дошёл до сервера (сеть, 429) — вопрос не сохранён: возвращаем его в поле.
      const fail = (p: Exclude<Problem, null>) => {
        setMessages(before);
        if (!quickAction) setInput(text);
        setProblem(p);
      };

      const controller = new AbortController();
      abortRef.current = controller;
      const csrf = csrfToken();
      let content = '';
      try {
        const res = await fetch(`/api/student/ai/conversations/${id}/messages`, {
          method: 'POST',
          credentials: 'same-origin',
          signal: controller.signal,
          headers: {
            'Content-Type': 'application/json',
            'Accept-Language': locale,
            ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
          },
          body: JSON.stringify({ content: text, ...(quickAction ? { quickAction } : {}) }),
        });
        if (res.status === 429) {
          const body = (await res.json().catch(() => ({}))) as { retryAfterSeconds?: number };
          return fail({ kind: 'tooMany', seconds: body.retryAfterSeconds ?? 60 });
        }
        if (!res.ok || !res.body) return fail({ kind: 'error' });

        const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
        let buffer = '';
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          const parsed = parseSse(buffer + value);
          buffer = parsed.rest;
          for (const event of parsed.events) {
            if (event.event === 'delta') {
              content += event.data.text;
              update(reply.id, { content });
            } else if (event.event === 'error') {
              // BR-AI-06: поставщик не подключён или недоступен — PH-19.
              update(reply.id, { content, status: 'failed' });
              setAnnounce(t('unavailable'));
            } else {
              update(reply.id, { content, status: 'complete' });
              setAnnounce(content);
            }
          }
        }
        const last = messagesRef.current.find((m) => m.id === reply.id);
        if (last?.status === 'streaming') update(reply.id, { status: 'complete' });
      } catch {
        // BR-AI-04: «Остановить» — ответ остаётся с пометкой «Ответ прерван» (сервер сохранил его как partial).
        if (controller.signal.aborted) update(reply.id, { content, status: 'partial' });
        else if (content) update(reply.id, { content, status: 'failed' });
        else fail({ kind: 'error' });
      } finally {
        abortRef.current = null;
        setBusy(false);
      }
    },
    [busy, conversation.data, locale, setMessages, t, update],
  );

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send(input);
    }
  };

  const list = messages ?? conversation.data?.messages ?? [];
  const ready = Boolean(conversation.data);
  const renderMessage = (m: Message) => (
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
          <Button variant="secondary" onClick={() => abortRef.current?.abort()} data-testid="tutor-stop">
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
