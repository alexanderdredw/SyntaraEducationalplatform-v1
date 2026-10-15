'use client';

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import ReactMarkdown from 'react-markdown';
import rehypeSanitize from 'rehype-sanitize';
import { AI_MAX_HISTORY, AI_MAX_MESSAGE_CHARS, isAllowedLink, parseSse } from '@syntara/shared';
import { Button, Card, cn, Textarea } from '@syntara/ui';
import { csrfToken } from '@/lib/api/browser';
import { AppLink } from '../app-link';
import { usePreservedState } from '../preferences/preserved-state';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  status: 'streaming' | 'complete' | 'partial';
}

type Problem = { kind: 'error' } | { kind: 'tooMany'; seconds: number } | null;

const COUNTER_FROM = 1800;
const QUICK = ['platform', 'start', 'language', 'registration'] as const;

/**
 * Публичный помощник (REQ-PUB-AI-01..06, API-PUB-06). История — только в памяти вкладки (BR-AI-05),
 * переживает смену языка; ответы — потоком SSE, ссылки и разметка санитизируются (BR-AI-07, REQ-NFR-SEC-06).
 */
export default function PublicChat({ atlasUrls }: { atlasUrls: string[] }) {
  const t = useTranslations('ai');
  const locale = useLocale();
  const [messages, storeMessages] = usePreservedState<Message[]>('ai.public.messages', []);
  const [input, setInput] = usePreservedState('ai.public.input', '');
  const [problem, setProblem] = useState<Problem>(null);
  const [lastQuestion, setLastQuestion] = useState<string | null>(null);
  const [announce, setAnnounce] = useState('');
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const messagesRef = useRef(messages);
  // Обновления потока идут чаще отрисовки — актуальный список держим в ref.
  const setMessages = useCallback(
    (next: Message[]) => {
      messagesRef.current = next;
      storeMessages(next);
    },
    [storeMessages],
  );

  useEffect(() => () => abortRef.current?.abort(), []);

  const update = useCallback(
    (id: string, patch: (m: Message) => Partial<Message>) =>
      setMessages(messagesRef.current.map((m) => (m.id === id ? { ...m, ...patch(m) } : m))),
    [setMessages],
  );

  const send = useCallback(
    async (raw: string) => {
      const text = raw.trim();
      if (!text || busy || text.length > AI_MAX_MESSAGE_CHARS) return;
      const history = messagesRef.current
        .filter((m) => m.status !== 'streaming' && m.content)
        .slice(-AI_MAX_HISTORY)
        .map(({ role, content }) => ({ role, content }));
      const userMsg: Message = { id: crypto.randomUUID(), role: 'user', content: text, status: 'complete' };
      const reply: Message = { id: crypto.randomUUID(), role: 'assistant', content: '', status: 'streaming' };
      const before = messagesRef.current;
      setMessages([...before, userMsg, reply]);
      setInput('');
      setProblem(null);
      setLastQuestion(text);
      setBusy(true);

      const fail = (p: Exclude<Problem, null>) => {
        // REQ-PUB-AI-04: вопрос не теряется — возвращается в поле, «Повторить» отправит его снова.
        setMessages(before);
        setInput(text);
        setProblem(p);
      };

      const controller = new AbortController();
      abortRef.current = controller;
      const csrf = csrfToken();
      try {
        const res = await fetch('/api/public/assistant', {
          method: 'POST',
          credentials: 'same-origin',
          signal: controller.signal,
          headers: {
            'Content-Type': 'application/json',
            'Accept-Language': locale,
            ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
          },
          body: JSON.stringify({ message: text, history }),
        });
        if (res.status === 429) {
          const body = (await res.json().catch(() => ({}))) as { retryAfterSeconds?: number };
          return fail({ kind: 'tooMany', seconds: body.retryAfterSeconds ?? 60 });
        }
        if (!res.ok || !res.body) return fail({ kind: 'error' });

        const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
        let buffer = '';
        let content = '';
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          const parsed = parseSse(buffer + value);
          buffer = parsed.rest;
          for (const event of parsed.events) {
            if (event.event === 'delta') {
              content += event.data.text;
              update(reply.id, () => ({ content }));
            } else if (event.event === 'error') {
              return fail({ kind: 'error' });
            } else {
              update(reply.id, () => ({ content, status: 'complete' }));
              setAnnounce(content);
            }
          }
        }
        update(reply.id, (m) => ({ status: m.status === 'streaming' ? 'complete' : m.status }));
      } catch {
        if (controller.signal.aborted) {
          // REQ-PUB-AI-03: прерванный ответ остаётся с пометкой «Ответ прерван».
          update(reply.id, () => ({ status: 'partial' }));
        } else {
          fail({ kind: 'error' });
        }
      } finally {
        abortRef.current = null;
        setBusy(false);
      }
    },
    [busy, locale, setInput, setMessages, update],
  );

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send(input);
    }
  };

  const clear = () => {
    abortRef.current?.abort();
    setMessages([]);
    setInput('');
    setProblem(null);
    setAnnounce('');
  };

  return (
    <Card data-testid="ai-chat" className="flex flex-col gap-4 p-4 md:p-6">
      <h2 className="sr-only">{t('chat.label')}</h2>
      <ol className="flex flex-col gap-3" data-testid="ai-messages">
        <li
          className="max-w-[90%] rounded-[var(--radius-control)] bg-[var(--field)] px-4 py-3 text-sm"
          data-role="assistant"
        >
          {t('chat.greeting')}
        </li>
        {messages.map((m) => (
          <li
            key={m.id}
            data-testid={m.role === 'user' ? 'ai-user-message' : 'ai-assistant-message'}
            data-status={m.status}
            className={cn(
              'max-w-[90%] rounded-[var(--radius-control)] px-4 py-3 text-sm',
              m.role === 'user' ? 'self-end bg-[var(--accent-strong)] text-white' : 'bg-[var(--field)]',
            )}
          >
            <span className="sr-only">{m.role === 'user' ? t('chat.you') : t('chat.assistant')}: </span>
            {m.role === 'user' ? (
              <p className="whitespace-pre-wrap">{m.content}</p>
            ) : (
              <AssistantText text={m.content} atlasUrls={atlasUrls} />
            )}
            {m.status === 'partial' ? (
              <p className="mt-2 text-xs text-[var(--text-muted)]" data-testid="ai-interrupted">
                {t('chat.interrupted')}
              </p>
            ) : null}
          </li>
        ))}
      </ol>

      <div aria-live="polite" className="sr-only" data-testid="ai-announce">
        {announce}
      </div>

      {busy ? (
        <div className="flex flex-wrap items-center gap-3">
          <p role="status" className="text-sm text-[var(--text-muted)]">
            {t('chat.thinking')}
          </p>
          <Button variant="secondary" onClick={() => abortRef.current?.abort()}>
            {t('chat.stop')}
          </Button>
        </div>
      ) : null}

      {problem ? (
        <div role="alert" data-testid="ai-error" className="flex flex-wrap items-center gap-3 text-sm">
          <span className="text-[var(--danger-text)]">
            {problem.kind === 'tooMany' ? t('chat.tooMany', { seconds: problem.seconds }) : t('chat.error')}
          </span>
          {problem.kind === 'error' && lastQuestion ? (
            <Button variant="secondary" onClick={() => void send(lastQuestion)}>
              {t('chat.retry')}
            </Button>
          ) : null}
        </div>
      ) : null}

      <div role="group" aria-label={t('chat.quickLabel')} className="flex flex-wrap gap-2">
        {QUICK.map((key) => (
          <Button
            key={key}
            variant="secondary"
            disabled={busy}
            onClick={() => void send(t(`quick.${key}.question`))}
          >
            {t(`quick.${key}.question`)}
          </Button>
        ))}
      </div>

      <form
        className="flex flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void send(input);
        }}
      >
        <label htmlFor="ai-input" className="sr-only">
          {t('chat.inputLabel')}
        </label>
        <Textarea
          id="ai-input"
          rows={3}
          value={input}
          maxLength={AI_MAX_MESSAGE_CHARS}
          placeholder={t('chat.placeholder')}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          aria-describedby={input.length > COUNTER_FROM ? 'ai-counter' : undefined}
        />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button variant="text" onClick={clear} disabled={messages.length === 0 && !input}>
            {t('chat.clear')}
          </Button>
          <div className="flex items-center gap-3">
            {input.length > COUNTER_FROM ? (
              <span id="ai-counter" data-testid="ai-counter" className="text-xs text-[var(--text-muted)]">
                {t('chat.counter', { count: input.length, max: AI_MAX_MESSAGE_CHARS })}
              </span>
            ) : null}
            <Button type="submit" disabled={busy || input.trim() === ''}>
              {t('chat.send')}
            </Button>
          </div>
        </div>
      </form>
    </Card>
  );
}

/** Ответ помощника: Markdown без HTML; ссылки — только внутренние маршруты и атласы (BR-AI-07). */
function AssistantText({ text, atlasUrls }: { text: string; atlasUrls: string[] }) {
  return (
    <div className="flex flex-col gap-2 [&_a]:font-semibold [&_a]:text-[var(--accent)] [&_a]:underline">
      <ReactMarkdown
        rehypePlugins={[rehypeSanitize]}
        components={{
          a: ({ href, children }) => {
            if (!href || !isAllowedLink(href, atlasUrls)) return <span>{children}</span>;
            if (href.startsWith('/')) return <AppLink href={href}>{children}</AppLink>;
            return (
              <a href={href} target="_blank" rel="noopener noreferrer">
                {children}
              </a>
            );
          },
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
