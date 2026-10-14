'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { Lock } from 'lucide-react';
import { Button, cn, Field, Textarea } from '@syntara/ui';
import { AppLink } from '../app-link';
import { ActionFeedback, DateTime, Details, Panel, StatusBadge } from './queue-parts';
import { staffGet, type TicketDetail, useStaffAction } from './staff-api';

const TICKETS_KEY = ['staff', 'tickets'] as const;

/**
 * Карточка обращения (REQ-SUP-02, REQ-SUP-03): исходное обращение, tech_context, переписка,
 * внутренние заметки (визуально отличаются и не уходят клиенту), история статусов; действия —
 * назначить, ответить по шаблону (текст и адрес видны до отправки), сменить статус по SM-TICKET.
 */
export function TicketCard({ id, meId, timeZone }: { id: string; meId: string; timeZone: string }) {
  const t = useTranslations('staff');
  const ts = useTranslations('support.categories');
  const tf = useTranslations('schoolRequest.fields');
  const locale = useLocale();
  const key = ['staff', 'ticket', id] as const;
  const query = useQuery({
    queryKey: key,
    queryFn: () => staffGet<TicketDetail>(`/api/staff/tickets/${id}`, locale),
  });
  const action = useStaffAction<TicketDetail>(key, TICKETS_KEY);
  const [template, setTemplate] = useState('');
  const [reply, setReply] = useState('');
  const [note, setNote] = useState('');

  if (query.isPending) return <p role="status">{t('loading')}</p>;
  if (query.isError || !query.data) return <p role="alert">{t('actions.error')}</p>;
  const ticket = query.data;
  const base = `/api/staff/tickets/${ticket.id}`;
  const canAssignMe = ticket.assignee?.id !== meId || ticket.status === 'new' || ticket.status === 'reopened';
  const tech = ticket.techContext;
  const actor = (ref: { displayName: string } | null, fallback: string) => ref?.displayName ?? fallback;

  return (
    <article data-testid="ticket-card" aria-labelledby="ticket-title" className="flex flex-col gap-4">
      <AppLink
        href="/staff/tickets"
        className="inline-flex min-h-11 items-center text-sm text-[var(--accent)] xl:hidden"
      >
        {t('backToList')}
      </AppLink>
      <header className="flex flex-wrap items-center gap-3">
        <h2 id="ticket-title" className="text-xl font-bold">
          {ticket.publicNumber} · {ticket.subject}
        </h2>
        <span data-testid="ticket-status">
          <StatusBadge status={ticket.status} label={t(`ticketStatus.${ticket.status}`)} />
        </span>
      </header>
      <Details
        rows={[
          [t('columns.category'), ts(ticket.category)],
          [t('columns.created'), <DateTime key="c" iso={ticket.createdAt} timeZone={timeZone} />],
          [t('columns.due'), <DateTime key="d" iso={ticket.dueAt} timeZone={timeZone} />],
          [
            t('columns.assignee'),
            <span key="a" data-testid="ticket-assignee">
              {ticket.assignee?.displayName ?? t('card.unassigned')}
            </span>,
          ],
        ]}
      />

      <Panel title={t('actions.label')} testId="ticket-actions">
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            disabled={action.pending || !canAssignMe}
            onClick={() => action.run(`${base}/assign`, { assigneeId: meId })}
          >
            {t('actions.assignMe')}
          </Button>
          {ticket.allowedStatuses.map((to) => (
            <Button
              key={to}
              variant={to === 'resolved' ? 'primary-blue' : 'secondary'}
              disabled={action.pending}
              data-testid={`ticket-to-${to}`}
              onClick={() => action.run(`${base}/status`, { to })}
            >
              {t(`ticketActions.${to}`)}
            </Button>
          ))}
        </div>
        {ticket.allowedStatuses.length === 0 ? (
          <p className="mt-2 text-xs text-[var(--text-muted)]">{t('actions.noStatusActions')}</p>
        ) : null}
        <div className="mt-2">
          <ActionFeedback problem={action.problem} done={action.done} />
        </div>
      </Panel>

      <Panel title={t('card.original')}>
        <Details
          rows={[
            [t('columns.email'), ticket.email],
            ...(ticket.name ? ([[t('card.user'), ticket.name]] as Array<[string, string]>) : []),
            ...(ticket.phone ? ([[tf('phone'), ticket.phone]] as Array<[string, string]>) : []),
          ]}
        />
        <p className="mt-3 whitespace-pre-wrap text-sm">{ticket.description}</p>
      </Panel>

      {tech ? (
        <Panel title={t('card.techContext')}>
          <Details
            rows={[
              [t('card.tech.route'), tech.route],
              [t('card.tech.appVersion'), tech.appVersion],
              [t('card.tech.locale'), tech.locale.toUpperCase()],
              [t('card.tech.dataSaver'), tech.dataSaver ? t('card.tech.yes') : t('card.tech.no')],
              [t('card.tech.userAgent'), tech.userAgent],
            ]}
          />
        </Panel>
      ) : null}

      <Panel title={t('card.conversation')} testId="ticket-conversation">
        {ticket.messages.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)]">{t('card.noMessages')}</p>
        ) : (
          <ol className="flex flex-col gap-3">
            {ticket.messages.map((m) => (
              <li
                key={m.id}
                data-testid={m.isInternal ? 'ticket-note' : 'ticket-message'}
                data-direction={m.direction}
                className={cn(
                  'rounded-xl border p-3 text-sm',
                  m.isInternal
                    ? 'border-dashed border-[var(--accent-teacher)] bg-[var(--surface-teacher)]'
                    : 'border-[var(--border)]',
                )}
              >
                <p className="flex flex-wrap items-center gap-2 text-xs text-[var(--text-muted)]">
                  {m.isInternal ? <Lock aria-hidden="true" className="size-3.5" /> : null}
                  <span className="font-semibold text-[var(--text)]">{t(`direction.${m.direction}`)}</span>
                  <span>{actor(m.author, m.direction === 'in' ? t('card.user') : t('card.system'))}</span>
                  <DateTime iso={m.createdAt} timeZone={timeZone} />
                  {m.direction === 'out' ? (
                    <span>· {m.sentAt ? t('card.sent') : t('card.queued')}</span>
                  ) : null}
                </p>
                {m.isInternal ? <p className="mt-1 text-xs font-medium">{t('card.internal')}</p> : null}
                <p className="mt-2 whitespace-pre-wrap">{m.body}</p>
              </li>
            ))}
          </ol>
        )}
      </Panel>

      <Panel title={t('actions.reply')} testId="ticket-reply">
        <form
          className="flex flex-col gap-3"
          onSubmit={async (e) => {
            e.preventDefault();
            const ok = await action.run(`${base}/reply`, {
              body: reply,
              ...(template ? { templateCode: template } : {}),
            });
            if (ok) {
              setReply('');
              setTemplate('');
            }
          }}
        >
          <div className="flex flex-col gap-1">
            <label htmlFor="reply-template" className="text-sm">
              {t('actions.template')}
            </label>
            <select
              id="reply-template"
              value={template}
              onChange={(e) => {
                setTemplate(e.target.value);
                const tpl = ticket.templates.find((x) => x.code === e.target.value);
                if (tpl) setReply(tpl.body);
              }}
              className="min-h-11 rounded-xl border border-[var(--border)] bg-[var(--field)] px-3 text-base"
            >
              <option value="">{t('actions.noTemplate')}</option>
              {ticket.templates.map((tpl) => (
                <option key={tpl.code} value={tpl.code}>
                  {t.has(`templates.${tpl.code}`) ? t(`templates.${tpl.code}`) : tpl.code}
                </option>
              ))}
            </select>
          </div>
          <Field id="reply-text" label={t('actions.replyText')} required>
            <Textarea value={reply} onChange={(e) => setReply(e.target.value)} />
          </Field>
          <div
            data-testid="reply-preview"
            aria-live="polite"
            className="rounded-xl border border-[var(--border)] p-3 text-sm"
          >
            <p className="text-xs text-[var(--text-muted)]">{t('actions.preview')}</p>
            <p className="mt-1 font-medium">{t('actions.recipient', { email: ticket.email })}</p>
            <p className="mt-2 whitespace-pre-wrap">{reply}</p>
          </div>
          <div>
            <Button type="submit" disabled={action.pending || reply.trim() === ''}>
              {t('actions.send')}
            </Button>
          </div>
        </form>
      </Panel>

      <Panel title={t('actions.note')} testId="ticket-note-form">
        <form
          className="flex flex-col gap-3"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await action.run(`${base}/notes`, { body: note })) setNote('');
          }}
        >
          <Field id="note-text" label={t('actions.noteText')} hint={t('card.internal')} required>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          <div>
            <Button type="submit" variant="secondary" disabled={action.pending || note.trim() === ''}>
              {t('actions.addNote')}
            </Button>
          </div>
        </form>
      </Panel>

      <Panel title={t('card.history')} testId="ticket-history">
        <ol className="flex flex-col gap-2 text-sm">
          {ticket.history.map((h, i) => (
            <li key={`${h.changedAt}-${i}`} className="flex flex-wrap gap-2">
              <DateTime iso={h.changedAt} timeZone={timeZone} />
              <span>
                {h.fromStatus ? `${t(`ticketStatus.${h.fromStatus}`)} → ` : ''}
                {t(`ticketStatus.${h.toStatus}`)}
              </span>
              <span className="text-[var(--text-muted)]">
                {/* Без автора: закрытие — задача worker, остальное — ответ пользователя на письмо. */}
                {actor(h.changedBy, h.toStatus === 'closed' ? t('card.system') : t('card.user'))}
              </span>
            </li>
          ))}
        </ol>
      </Panel>
    </article>
  );
}
