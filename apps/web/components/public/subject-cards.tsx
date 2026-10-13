import { getTranslations } from 'next-intl/server';
import { Atom, BookOpen, Dna, FlaskConical, type LucideIcon } from 'lucide-react';
import { type PublicSubject } from '@/lib/api/server';
import { AppLink } from '../app-link';

const ICONS: Record<string, LucideIcon> = { dna: Dna, 'flask-conical': FlaskConical, atom: Atom };

/**
 * Карточки предметов из API-PUB-01.
 * На главной (REQ-PUB-HOME-06) статус и «Открыть →» — только при status = 'open';
 * на /subjects (REQ-PUB-SUBJ-02) — все статусы, «Скоро» отдельной группой после доступных.
 */
export async function SubjectCards({
  subjects,
  variant,
}: {
  subjects: PublicSubject[];
  variant: 'home' | 'page';
}) {
  const t = await getTranslations('subjects');
  if (subjects.length === 0) return <p className="text-[var(--text-muted)]">{t('empty')}</p>;

  const card = (s: PublicSubject) => {
    const Icon = ICONS[s.icon] ?? BookOpen;
    const showStatus = variant === 'page' || s.status === 'open';
    const body = (
      <>
        <Icon aria-hidden="true" className="size-8 text-[var(--accent)]" />
        <h3 className="mt-4 text-xl font-semibold">{s.title}</h3>
        {s.description ? <p className="mt-2 text-sm text-[var(--text-muted)]">{s.description}</p> : null}
        {showStatus ? (
          <p
            className="mt-4 text-xs font-semibold uppercase tracking-wider text-[var(--accent)]"
            data-testid="subject-status"
          >
            {t(`status.${s.status}`)}
          </p>
        ) : null}
        {s.status === 'open' ? <span className="mt-4 inline-flex font-semibold">{t('open')}</span> : null}
      </>
    );
    const className =
      'flex h-full flex-col rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-6';
    // На главной ссылкой является только открытый предмет; на /subjects ещё и «Нужен вход» → вход с returnTo.
    const linked = s.href && (s.status === 'open' || (variant === 'page' && s.status === 'login_required'));
    return (
      <li key={s.id} data-testid="subject-card" data-status={s.status} lang={s.locale}>
        {linked ? (
          <AppLink href={s.href!} className={`${className} hover:border-[var(--accent)]`}>
            {body}
          </AppLink>
        ) : (
          <div className={className}>{body}</div>
        )}
      </li>
    );
  };

  const grid = (items: PublicSubject[]) => <ul className="grid gap-4 md:grid-cols-3">{items.map(card)}</ul>;
  if (variant === 'home') return grid(subjects);

  const available = subjects.filter((s) => s.status !== 'soon');
  const soon = subjects.filter((s) => s.status === 'soon');
  return (
    <div className="flex flex-col gap-10">
      {available.length > 0 ? grid(available) : null}
      {soon.length > 0 ? (
        <section aria-labelledby="subjects-soon" data-testid="subjects-soon">
          <h2 id="subjects-soon" className="mb-4 text-xl font-semibold">
            {t('soonGroup')}
          </h2>
          {grid(soon)}
        </section>
      ) : null}
    </div>
  );
}
