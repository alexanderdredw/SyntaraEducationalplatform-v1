'use client';

import { useDeferredValue, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { useInfiniteQuery } from '@tanstack/react-query';
import { SupportCategory, TicketStatus } from '@syntara/shared';
import { Button, cn, Input } from '@syntara/ui';
import { endOfDayIso } from '@/lib/datetime';
import { AppLink } from '../app-link';
import { DateTime, FilterSelect, StatusBadge } from './queue-parts';
import { staffGet, toQuery, type TicketListResponse } from './staff-api';
import { TicketCard } from './ticket-card';

export const TICKETS_KEY = ['staff', 'tickets'] as const;

/**
 * Очередь обращений (REQ-SUP-01): фильтры по типу (категории), статусу, ответственному и сроку,
 * поиск по номеру и email, новые — первыми; курсорная подгрузка (API-GEN-07). Карточка — `?ticket=<id>`.
 */
export function TicketsQueue({ meId, timeZone }: { meId: string; timeZone: string }) {
  const t = useTranslations('staff');
  const ts = useTranslations('support.categories');
  const locale = useLocale();
  const selected = useSearchParams().get('ticket');

  const [status, setStatus] = useState('');
  const [category, setCategory] = useState('');
  const [assignee, setAssignee] = useState('');
  const [due, setDue] = useState('');
  const [search, setSearch] = useState('');
  const q = useDeferredValue(search.trim());

  const params = {
    status,
    category,
    assigneeId: assignee === 'mine' ? meId : assignee === 'none' ? 'none' : '',
    dueBefore: due ? endOfDayIso(due, timeZone) : '',
    q,
  };
  const list = useInfiniteQuery({
    queryKey: [...TICKETS_KEY, params],
    queryFn: ({ pageParam }) =>
      staffGet<TicketListResponse>(`/api/staff/tickets${toQuery({ ...params, cursor: pageParam })}`, locale),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  });
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];

  const reset = () => {
    setStatus('');
    setCategory('');
    setAssignee('');
    setDue('');
    setSearch('');
  };

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <section aria-labelledby="tickets-title" className={cn(selected && 'hidden xl:block')}>
        <h1 id="tickets-title" className="text-cabinet-title font-bold">
          {t('tickets')}
        </h1>
        <form
          role="search"
          aria-label={t('filters.label')}
          className="mt-4 flex flex-wrap items-end gap-3"
          onSubmit={(e) => e.preventDefault()}
        >
          <div className="flex min-w-56 flex-1 flex-col gap-1">
            <label htmlFor="tickets-q" className="text-xs text-[var(--text-muted)]">
              {t('filters.search')}
            </label>
            <Input id="tickets-q" type="search" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <FilterSelect
            id="tickets-status"
            label={t('filters.status')}
            value={status}
            onChange={setStatus}
            options={[
              { value: '', label: t('filters.all') },
              ...TicketStatus.options.map((s) => ({ value: s, label: t(`ticketStatus.${s}`) })),
            ]}
          />
          <FilterSelect
            id="tickets-category"
            label={t('filters.category')}
            value={category}
            onChange={setCategory}
            options={[
              { value: '', label: t('filters.all') },
              ...SupportCategory.options.map((c) => ({ value: c, label: ts(c) })),
            ]}
          />
          <FilterSelect
            id="tickets-assignee"
            label={t('filters.assignee')}
            value={assignee}
            onChange={setAssignee}
            options={[
              { value: '', label: t('filters.all') },
              { value: 'mine', label: t('filters.mine') },
              { value: 'none', label: t('filters.unassigned') },
            ]}
          />
          <div className="flex flex-col gap-1">
            <label htmlFor="tickets-due" className="text-xs text-[var(--text-muted)]">
              {t('filters.dueBefore')}
            </label>
            <Input id="tickets-due" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
          </div>
          <Button variant="text" onClick={reset}>
            {t('filters.reset')}
          </Button>
        </form>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm" data-testid="tickets-table">
            <thead className="text-xs text-[var(--text-muted)]">
              <tr>
                <th scope="col" className="py-2 pr-3 font-medium">
                  {t('columns.number')}
                </th>
                <th scope="col" className="py-2 pr-3 font-medium">
                  {t('columns.subject')}
                </th>
                <th scope="col" className="py-2 pr-3 font-medium">
                  {t('columns.status')}
                </th>
                <th scope="col" className="py-2 pr-3 font-medium">
                  {t('columns.assignee')}
                </th>
                <th scope="col" className="py-2 pr-3 font-medium">
                  {t('columns.created')}
                </th>
                <th scope="col" className="py-2 font-medium">
                  {t('columns.due')}
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr
                  key={item.id}
                  data-testid="ticket-row"
                  aria-current={item.id === selected ? 'true' : undefined}
                  className={cn(
                    'border-t border-[var(--border)]',
                    item.id === selected && 'shadow-[inset_3px_0_0_var(--accent)]',
                  )}
                >
                  <td className="py-2 pr-3">
                    <AppLink
                      href={{ pathname: '/staff/tickets', query: { ticket: item.id } }}
                      className="inline-flex min-h-11 items-center font-semibold text-[var(--accent)] hover:underline"
                    >
                      {item.publicNumber}
                    </AppLink>
                  </td>
                  <td className="py-2 pr-3">
                    <span className="block">{item.subject}</span>
                    <span className="block text-xs text-[var(--text-muted)]">
                      {ts(item.category)} · {item.email}
                    </span>
                  </td>
                  <td className="py-2 pr-3">
                    <StatusBadge status={item.status} label={t(`ticketStatus.${item.status}`)} />
                  </td>
                  <td className="py-2 pr-3">{item.assignee?.displayName ?? '—'}</td>
                  <td className="py-2 pr-3 whitespace-nowrap">
                    <DateTime iso={item.createdAt} timeZone={timeZone} />
                  </td>
                  <td className="py-2 whitespace-nowrap">
                    <DateTime iso={item.dueAt} timeZone={timeZone} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p role="status" className="mt-3 text-sm text-[var(--text-muted)]">
          {list.isPending ? t('loading') : items.length === 0 ? t('empty') : ''}
        </p>
        {list.hasNextPage ? (
          <Button
            variant="secondary"
            className="mt-3"
            disabled={list.isFetchingNextPage}
            onClick={() => list.fetchNextPage()}
          >
            {t('loadMore')}
          </Button>
        ) : null}
      </section>

      <section aria-label={t('card.original')} className={cn(!selected && 'hidden xl:block')}>
        {selected ? (
          <TicketCard id={selected} meId={meId} timeZone={timeZone} />
        ) : (
          <p className="text-sm text-[var(--text-muted)]">{t('selectHint')}</p>
        )}
      </section>
    </div>
  );
}
