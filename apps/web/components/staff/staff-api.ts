'use client';

import { useCallback, useState } from 'react';
import { useLocale } from 'next-intl';
import { useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/api/browser';
import type { components } from '@/lib/api/schema';

export type TicketListResponse = components['schemas']['TicketListResponse'];
export type TicketListItem = components['schemas']['TicketListItem'];
export type TicketDetail = components['schemas']['TicketDetail'];
export type RequestListResponse = components['schemas']['RequestListResponse'];
export type RequestListItem = components['schemas']['RequestListItem'];
export type RequestDetail = components['schemas']['RequestDetail'];

export class StaffApiError extends Error {
  constructor(readonly code: string | null) {
    super(code ?? 'network');
  }
}

/** GET для TanStack Query: ошибка — исключение с кодом API-GEN-04. */
export async function staffGet<T>(path: string, locale: string): Promise<T> {
  const result = await apiRequest<T>(path, { locale });
  if (result.kind === 'ok') return result.data;
  throw new StaffApiError(result.kind === 'http' ? result.error.code : null);
}

export function toQuery(params: Record<string, string | undefined | null>): string {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) search.set(k, v);
  const s = search.toString();
  return s ? `?${s}` : '';
}

export type ActionProblem = 'invalidTransition' | 'error' | null;

/**
 * Действие сотрудника (POST): ответ — обновлённая карточка; список очереди перечитывается.
 * 409 INVALID_TRANSITION показывается отдельным текстом (SM-TICKET / SM-REQUEST).
 */
export function useStaffAction<T>(detailKey: readonly unknown[], listKey: readonly unknown[]) {
  const locale = useLocale();
  const queryClient = useQueryClient();
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<ActionProblem>(null);
  const [done, setDone] = useState(false);

  const run = useCallback(
    async (path: string, body: object): Promise<boolean> => {
      setPending(true);
      setProblem(null);
      setDone(false);
      const result = await apiRequest<T>(path, { method: 'POST', body, locale });
      setPending(false);
      if (result.kind === 'ok') {
        queryClient.setQueryData(detailKey, result.data);
        await queryClient.invalidateQueries({ queryKey: listKey });
        setDone(true);
        return true;
      }
      setProblem(
        result.kind === 'http' && result.error?.code === 'INVALID_TRANSITION' ? 'invalidTransition' : 'error',
      );
      return false;
    },
    [detailKey, listKey, locale, queryClient],
  );

  return { run, pending, problem, done };
}
