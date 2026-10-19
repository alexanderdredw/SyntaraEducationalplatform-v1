import { getTranslations } from 'next-intl/server';
import {
  Atom,
  BookA,
  BookOpen,
  Calculator,
  Dna,
  FlaskConical,
  Globe,
  HeartPulse,
  Landmark,
  Languages,
  Leaf,
  Monitor,
  Shapes,
  Sigma,
  Triangle,
  type LucideIcon,
} from 'lucide-react';
import { IconTile } from '@syntara/ui';
import { type PublicSubject } from '@/lib/api/server';
import { AppLink } from '../app-link';

const ICONS: Record<string, LucideIcon> = { dna: Dna, 'flask-conical': FlaskConical, atom: Atom };

/**
 * Значок карточки на главной — по коду раздела или предмета content/ (UX-03: у каждого свой значок,
 * общая «книга» — только если подходящего нет). Иначе — значок из API-PUB-01.
 */
const ICONS_BY_CODE: Record<string, LucideIcon> = {
  biology: Leaf,
  'general-biology': Leaf,
  'human-anatomy': HeartPulse,
  'natural-sciences': FlaskConical,
  chemistry: FlaskConical,
  physics: Atom,
  geography: Globe,
  'exact-sciences': Sigma,
  mathematics: Calculator,
  algebra: Sigma,
  geometry: Triangle,
  informatics: Monitor,
  humanities: Landmark,
  'history-of-kazakhstan': Landmark,
  languages: Languages,
  'kazakh-language': BookA,
  'russian-language': BookA,
  'english-language': Languages,
};

/** На главной — не больше 6 карточек, открытые первыми (порядок API-PUB-01); остальные — на /subjects. */
export const HOME_SUBJECTS_LIMIT = 6;

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

  // Главная (UX-03): значок в плитке, бейдж «Доступно»/«Скоро» справа сверху, «Открыть →» прижато к низу.
  const homeCard = (s: PublicSubject) => {
    const Icon = ICONS_BY_CODE[s.code] ?? ICONS[s.icon] ?? Shapes;
    const open = s.status === 'open';
    const body = (
      <>
        <span className="flex items-start justify-between gap-3">
          <IconTile>
            <Icon />
          </IconTile>
          <span
            className="rounded-[var(--radius-pill)] border border-[var(--border-strong)] px-2.5 py-0.5 text-xs font-semibold"
            data-testid="subject-status"
          >
            {open ? t('badgeOpen') : t('status.soon')}
          </span>
        </span>
        <h3 className="mt-5 text-xl font-semibold">{s.title}</h3>
        {s.description ? <p className="mt-2 text-sm text-[var(--text-muted)]">{s.description}</p> : null}
        {open ? <span className="mt-auto pt-6 font-semibold">{t('open')}</span> : null}
      </>
    );
    const className =
      'flex h-full flex-col rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-6';
    return (
      <li key={s.id} data-testid="subject-card" data-status={s.status} lang={s.locale}>
        {open && s.href ? (
          <AppLink href={s.href} className={`${className} hover:border-[var(--accent)]`}>
            {body}
          </AppLink>
        ) : (
          <div className={className}>{body}</div>
        )}
      </li>
    );
  };

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
      'flex h-full flex-col rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-6 shadow-card';
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
  if (variant === 'home')
    return (
      <ul className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {subjects.slice(0, HOME_SUBJECTS_LIMIT).map(homeCard)}
      </ul>
    );

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
