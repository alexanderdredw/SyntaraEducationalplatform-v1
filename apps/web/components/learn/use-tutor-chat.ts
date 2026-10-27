'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { AI_MAX_MESSAGE_CHARS, type AiQuickAction, parseSse } from '@syntara/shared';
import { apiRequest, csrfToken } from '@/lib/api/browser';

type Status = 'streaming' | 'complete' | 'partial' | 'failed';
export interface TutorMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  status: Status;
}
interface History {
  id: string;
  messages: TutorMessage[];
}
export type TutorProblem = { kind: 'error' } | { kind: 'tooMany'; seconds: number } | null;

/**
 * Диалог учебного ИИ (8.4.5, REQ-ST-AI-01..04): диалог на сервере (API-S-11..13), ответ — потоком SSE (API-S-12),
 * «Остановить» прерывает поток — ответ сохраняется с пометкой «Ответ прерван» (BR-AI-04); поставщик не подключён —
 * PH-19 (BR-AI-06). Общий для чата урока, страницы помощника и экрана Syntara AI атласа (REQ-ATL-03).
 */
export function useTutorChat(context: 'topic_tutor' | 'general_tutor', topicId?: string) {
  const t = useTranslations('student.ai');
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

  const [messages, storeMessages] = useState<TutorMessage[] | null>(null);
  const [input, setInput] = useState('');
  const [problem, setProblem] = useState<TutorProblem>(null);
  const [announce, setAnnounce] = useState('');
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const messagesRef = useRef<TutorMessage[]>([]);
  // Обновления потока идут чаще отрисовки — актуальный список держим в ref.
  const setMessages = useCallback((next: TutorMessage[]) => {
    messagesRef.current = next;
    storeMessages(next);
  }, []);

  useEffect(() => () => abortRef.current?.abort(), []);

  const update = useCallback(
    (id: string, patch: Partial<TutorMessage>) =>
      setMessages(messagesRef.current.map((m) => (m.id === id ? { ...m, ...patch } : m))),
    [setMessages],
  );

  const send = useCallback(
    async (raw: string, quickAction?: AiQuickAction) => {
      const text = raw.trim();
      const id = conversation.data?.id;
      if (!id || !text || busy || text.length > AI_MAX_MESSAGE_CHARS) return;
      const question: TutorMessage = {
        id: crypto.randomUUID(),
        role: 'user',
        content: text,
        status: 'complete',
      };
      const reply: TutorMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: '',
        status: 'streaming',
      };
      // До первого вопроса в ленте — история с сервера (API-S-13).
      const before = messagesRef.current.length ? messagesRef.current : (conversation.data?.messages ?? []);
      setMessages([...before, question, reply]);
      if (!quickAction) setInput('');
      setProblem(null);
      setBusy(true);

      // Запрос не дошёл до сервера (сеть, 429) — вопрос не сохранён: возвращаем его в поле.
      const fail = (p: Exclude<TutorProblem, null>) => {
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

  const list = messages ?? conversation.data?.messages ?? [];
  const ready = Boolean(conversation.data);
  const stop = useCallback(() => abortRef.current?.abort(), []);
  return { conversation, list, ready, busy, problem, announce, input, setInput, send, stop };
}
