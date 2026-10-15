'use client';

import { useDeferredValue, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { RequestStatus } from '@syntara/shared';
import { Button, cn, Input } from '@syntara/ui';
import { AppLink } from '../app-link';
import { ActionFeedback, DateTime, Details, FilterSelect, Panel, StatusBadge } from './queue-parts';
import { type RequestDetail, type RequestListResponse, staffGet, toQuery, useStaffAction } from './staff-api';

const REQUESTS_KEY = ['staff', 'requests'] as const;

/** Очередь школьных заявок (API-SUP-07, роль onboarding_agent): фильтры, поиск, статусы SM-REQUEST. */
export function RequestsQueue({ meId, timeZone }: { meId: string; timeZone: string }) {
  const t = useTranslations('staff');
  const locale = useLocale();
  const selected = useSearchParams().get('request');
  const [status, setStatus] = useState('');
  const [assignee, setAssignee] = useState('');
  const [search, setSearch] = useState('');
  const q = useDeferredValue(search.trim());

  const params = { status, assigneeId: assignee === 'mine' ? meId : assignee === 'none' ? 'none' : '', q };
  const list = useInfiniteQuery({
    queryKey: [...REQUESTS_KEY, params],
    queryFn: ({ pageParam }) =>
      staffGet<RequestListResponse>(
        `/api/staff/requests${toQuery({ ...params, cursor: pageParam })}`,
        locale,
      ),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  });
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <section aria-labelledby="requests-title" className={cn(selected && 'hidden xl:block')}>
        <h1 id="requests-title" className="text-cabinet-title font-bold">
          {t('requests')}
        </h1>
        <form
          role="search"
          aria-label={t('filters.label')}
          className="mt-4 flex flex-wrap items-end gap-3"
          onSubmit={(e) => e.preventDefault()}
        >
          <div className="flex min-w-56 flex-1 flex-col gap-1">
            <label htmlFor="requests-q" className="text-xs text-[var(--text-muted)]">
              {t('filters.search')}
            </label>
            <Input id="requests-q" type="search" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <FilterSelect
            id="requests-status"
            label={t('filters.status')}
            value={status}
            onChange={setStatus}
            options={[
              { value: '', label: t('filters.all') },
              ...RequestStatus.options.map((s) => ({ value: s, label: t(`requestStatus.${s}`) })),
            ]}
          />
          <FilterSelect
            id="requests-assignee"
            label={t('filters.assignee')}
            value={assignee}
            onChange={setAssignee}
            options={[
              { value: '', label: t('filters.all') },
              { value: 'mine', label: t('filters.mine') },
              { value: 'none', label: t('filters.unassigned') },
            ]}
          />
        </form>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[560px] text-left text-sm" data-testid="requests-table">
            <thead className="text-xs text-[var(--text-muted)]">
              <tr>
                <th scope="col" className="py-2 pr-3 font-medium">
                  {t('columns.number')}
                </th>
                <th scope="col" className="py-2 pr-3 font-medium">
                  {t('columns.school')}
                </th>
                <th scope="col" className="py-2 pr-3 font-medium">
                  {t('columns.status')}
                </th>
                <th scope="col" className="py-2 pr-3 font-medium">
                  {t('columns.assignee')}
                </th>
                <th scope="col" className="py-2 font-medium">
                  {t('columns.created')}
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr
                  key={item.id}
                  data-testid="request-row"
                  aria-current={item.id === selected ? 'true' : undefined}
                  className={cn(
                    'border-t border-[var(--border)]',
                    item.id === selected && 'shadow-[inset_3px_0_0_var(--accent)]',
                  )}
                >
                  <td className="py-2 pr-3">
                    <AppLink
                      href={{ pathname: '/staff/requests', query: { request: item.id } }}
                      className="inline-flex min-h-11 items-center font-semibold text-[var(--accent)] hover:underline"
                    >
                      {item.publicNumber}
                    </AppLink>
                  </td>
                  <td className="py-2 pr-3">
                    <span className="block">{item.schoolName}</span>
                    <span className="block text-xs text-[var(--text-muted)]">
                      {item.contactPerson} · {item.email}
                    </span>
                  </td>
                  <td className="py-2 pr-3">
                    <StatusBadge status={item.status} label={t(`requestStatus.${item.status}`)} />
                  </td>
                  <td className="py-2 pr-3">{item.assignee?.displayName ?? '—'}</td>
                  <td className="py-2 whitespace-nowrap">
                    <DateTime iso={item.createdAt} timeZone={timeZone} />
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

      <section aria-label={t('requests')} className={cn(!selected && 'hidden xl:block')}>
        {selected ? (
          <RequestCard id={selected} meId={meId} timeZone={timeZone} />
        ) : (
          <p className="text-sm text-[var(--text-muted)]">{t('selectHint')}</p>
        )}
      </section>
    </div>
  );
}

function RequestCard({ id, meId, timeZone }: { id: string; meId: string; timeZone: string }) {
  const t = useTranslations('staff');
  const tf = useTranslations('schoolRequest.fields');
  const locale = useLocale();
  const key = ['staff', 'request', id] as const;
  const query = useQuery({
    queryKey: key,
    queryFn: () => staffGet<RequestDetail>(`/api/staff/requests/${id}`, locale),
  });
  const action = useStaffAction<RequestDetail>(key, REQUESTS_KEY);

  if (query.isPending) return <p role="status">{t('loading')}</p>;
  if (query.isError || !query.data) return <p role="alert">{t('actions.error')}</p>;
  const request = query.data;
  const base = `/api/staff/requests/${request.id}`;

  return (
    <article data-testid="request-card" aria-labelledby="request-title" className="flex flex-col gap-4">
      <AppLink
        href="/staff/requests"
        className="inline-flex min-h-11 items-center text-sm text-[var(--accent)] xl:hidden"
      >
        {t('backToList')}
      </AppLink>
      <header className="flex flex-wrap items-center gap-3">
        <h2 id="request-title" className="text-xl font-bold">
          {request.publicNumber} · {request.schoolName}
        </h2>
        <span data-testid="request-status">
          <StatusBadge status={request.status} label={t(`requestStatus.${request.status}`)} />
        </span>
      </header>

      <Panel title={t('actions.label')} testId="request-actions">
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            disabled={action.pending || request.assignee?.id === meId}
            onClick={() => action.run(`${base}/assign`, { assigneeId: meId })}
          >
            {t('actions.assignMe')}
          </Button>
          {request.allowedStatuses.map((to) => (
            <Button
              key={to}
              variant={to === 'rejected' ? 'secondary' : 'primary-blue'}
              disabled={action.pending}
              data-testid={`request-to-${to}`}
              onClick={() => action.run(`${base}/status`, { to })}
            >
              {t(`requestActions.${to}`)}
            </Button>
          ))}
        </div>
        {request.allowedStatuses.length === 0 ? (
          <p className="mt-2 text-xs text-[var(--text-muted)]">{t('actions.noStatusActions')}</p>
        ) : null}
        <div className="mt-2">
          <ActionFeedback problem={action.problem} done={action.done} />
        </div>
      </Panel>

      <Panel title={t('card.original')}>
        <Details
          rows={[
            [tf('schoolName'), request.schoolName],
            [tf('region'), request.region ?? '—'],
            [tf('city'), request.city ?? '—'],
            [tf('contactPerson'), request.contactPerson],
            [tf('phone'), request.phone ?? '—'],
            [tf('email'), request.email],
            [t('columns.created'), <DateTime key="c" iso={request.createdAt} timeZone={timeZone} />],
            [t('columns.assignee'), request.assignee?.displayName ?? t('card.unassigned')],
          ]}
        />
        {request.message ? (
          <>
            <h4 className="mt-4 text-sm text-[var(--text-muted)]">{tf('message')}</h4>
            <p className="mt-1 whitespace-pre-wrap text-sm">{request.message}</p>
          </>
        ) : null}
      </Panel>
    </article>
  );
}
