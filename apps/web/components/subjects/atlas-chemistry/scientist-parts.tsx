'use client';

import { type CSSProperties, type KeyboardEvent, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { initials, SCIENTISTS_INVITE_FROM } from '@syntara/shared';
import { apiRequest } from '@/lib/api/browser';
import type { components } from '@/lib/api/schema';
import { AppLink } from '../../app-link';
import { useAtlasSubject } from './atlas-data';
import { useAtlasViewer } from './gate';
import { atlasHref, scientistHref } from './routes';

export const GOLD = '#FDE047';

/** Учёный экрана «Учёные»: раздел урока «Учёные-химики» и событие ленты (timeline.yaml). */
export interface Scientist {
  code: string;
  name: string;
  description: string;
  body: string | null;
  portrait: string | null;
  portraitAlt: string | null;
  year: number | null;
  /** Годы жизни (REQ-SCI-01); нет — строка ленты без полосы. */
  lived: { from: number; to: number } | null;
  /** Открытие — название события ленты. */
  discovery: string;
  /** Ключевые факты, элементы, источники и подсказки (scientists.yaml, S1b); нет — блоки не показываются. */
  data: ScientistData | null;
}

export type ScientistData = components['schemas']['ScientistDataDto'];

type Progress = components['schemas']['AtlasScientistsProgressDto'];

/* ---------- «Изучено» (REQ-SCI-04, BR-SCI-01) ---------- */

/** Изученные учёные и лучшие результаты (API-S-31) — только у ученика; отметка — API-S-32. */
export function useScientistsProgress() {
  const subjectId = useAtlasSubject();
  const locale = useLocale();
  const viewer = useAtlasViewer();
  const queryClient = useQueryClient();
  const key = ['atlas', 'scientists-progress', subjectId];
  const query = useQuery({
    queryKey: key,
    enabled: viewer === 'student',
    queryFn: async () => {
      const res = await apiRequest<Progress>(`/api/student/subjects/${subjectId}/atlas/scientists-progress`, {
        locale,
      });
      if (res.kind !== 'ok') throw new Error('progress');
      return res.data;
    },
  });
  const mark = useMutation({
    mutationFn: async ({ code, studied }: { code: string; studied: boolean }) => {
      const res = await apiRequest<Progress>(
        `/api/student/subjects/${subjectId}/atlas/scientists/${code}/studied`,
        { method: 'PUT', body: { studied }, locale },
      );
      if (res.kind !== 'ok') throw new Error('mark');
      return res.data;
    },
    onSuccess: (data) => queryClient.setQueryData(key, data),
  });
  return { progress: query.data ?? null, student: viewer === 'student', mark };
}

/* ---------- Лента «Линии жизни» (REQ-SCI-01, REQ-SCI-02) ---------- */

const FROM = 1740;
const TO = 1980;
const pct = (year: number) => ((year - FROM) / (TO - FROM)) * 100;
const TICKS = [1750, 1800, 1850, 1900, 1950];
const CENTURIES: Array<{ key: 'c18' | 'c19' | 'c20'; from: number; to: number }> = [
  { key: 'c18', from: FROM, to: 1800 },
  { key: 'c19', from: 1800, to: 1900 },
  { key: 'c20', from: 1900, to: TO },
];

/** Стрелки вверх и вниз — фокус по строкам ленты (REQ-SCI-01.6). */
function moveFocus(e: KeyboardEvent<HTMLElement>) {
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
  const list = e.currentTarget.closest('ol');
  const rows = [...(list?.querySelectorAll<HTMLElement>('[data-row]') ?? [])];
  const i = rows.indexOf(document.activeElement as HTMLElement);
  if (i < 0) return;
  e.preventDefault();
  rows[Math.max(0, Math.min(rows.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))]?.focus();
}

function useRowLabel() {
  const t = useTranslations('atlas.sci');
  return (s: Scientist, studied: boolean) =>
    [
      t('row', {
        name: s.name,
        from: s.lived?.from ?? '',
        to: s.lived?.to ?? '',
        year: s.year ?? '',
        discovery: s.discovery,
      }),
      studied ? t('studiedMark') : null,
    ]
      .filter(Boolean)
      .join(', ');
}

/**
 * «Линии жизни» (≥ 768 px): ось лет 1740–1980 с подписями через 50 лет и полосами веков; строка на учёного —
 * портрет и фамилия, полоса жизни, ★ год открытия. Наведение или фокус — мини-карточка; нажатие или Enter — окно
 * учёного. Подсветка синхронна с сеткой (`active`). Полосы прорисовываются слева направо (без анимации в «Экономии
 * трафика» и при reduced motion — правила в atlas.css).
 */
export function Lifelines({
  scientists,
  studied,
  active,
  onActive,
}: {
  scientists: Scientist[];
  studied: string[];
  active: string | null;
  onActive: (code: string | null) => void;
}) {
  const t = useTranslations('atlas.sci');
  const subjectId = useAtlasSubject();
  const label = useRowLabel();
  return (
    <div className="sci-lifelines" data-testid="atlas-lifelines">
      <div className="sci-axis" aria-hidden="true">
        {CENTURIES.map((c) => (
          <span
            key={c.key}
            className="sci-century"
            style={{ left: `${pct(c.from)}%`, width: `${pct(c.to) - pct(c.from)}%` }}
          >
            {t(`century.${c.key}`)}
          </span>
        ))}
        {TICKS.map((y) => (
          <span key={y} className="sci-tick" style={{ left: `${pct(y)}%` }}>
            {y}
          </span>
        ))}
      </div>
      <ol className="sci-rows" aria-label={t('lifelines')}>
        {scientists.map((s, i) => {
          const done = studied.includes(s.code);
          return (
            <li key={s.code} className="sci-row-item">
              <AppLink
                href={scientistHref(subjectId, s.code)}
                scroll={false}
                className="sci-row"
                data-row
                onKeyDown={moveFocus}
                data-active={active === s.code || undefined}
                aria-label={label(s, done)}
                onMouseEnter={() => onActive(s.code)}
                onMouseLeave={() => onActive(null)}
                onFocus={() => onActive(s.code)}
                onBlur={() => onActive(null)}
                data-testid="atlas-lifeline"
                data-code={s.code}
              >
                <span className="sci-row-who" aria-hidden="true">
                  <Portrait scientist={s} size={28} />
                  <span className="sci-row-name">{s.name.split(' ').at(-1)}</span>
                  {done ? <span className="sci-studied-dot">✓</span> : null}
                </span>
                <span className="sci-row-track" aria-hidden="true">
                  {s.lived ? (
                    <span
                      className="sci-life"
                      style={
                        {
                          left: `${pct(s.lived.from)}%`,
                          width: `${pct(s.lived.to) - pct(s.lived.from)}%`,
                          '--delay': `${i * 0.06}s`,
                        } as CSSProperties
                      }
                    />
                  ) : null}
                  {s.year ? (
                    <span className="sci-star" style={{ left: `${pct(s.year)}%` }}>
                      <span className="sci-star-mark">★</span>
                      <span className="sci-star-year">{s.year}</span>
                    </span>
                  ) : null}
                  <span
                    className="sci-card-pop"
                    style={{ left: `${Math.min(70, pct(s.year ?? s.lived?.from ?? FROM))}%` }}
                  >
                    <Portrait scientist={s} size={40} />
                    <span>
                      <b>{s.name}</b>
                      <span className="sci-pop-meta">
                        {s.lived ? t('lived', { from: s.lived.from, to: s.lived.to }) : null}
                      </span>
                      <span className="sci-pop-meta">
                        {s.year} — {s.discovery}
                      </span>
                      <span className="sci-pop-open">{t('open')}</span>
                    </span>
                  </span>
                </span>
              </AppLink>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** Лента на телефоне (< 768 px, REQ-SCI-02): год открытия крупно, линия с точками, портрет, имя, годы, открытие. */
export function VerticalTimeline({ scientists, studied }: { scientists: Scientist[]; studied: string[] }) {
  const t = useTranslations('atlas.sci');
  const subjectId = useAtlasSubject();
  const label = useRowLabel();
  return (
    <ol className="sci-vertical" aria-label={t('lifelines')} data-testid="atlas-timeline-vertical">
      {scientists.map((s) => {
        const done = studied.includes(s.code);
        return (
          <li key={s.code}>
            <AppLink
              href={scientistHref(subjectId, s.code)}
              scroll={false}
              className="sci-v-row"
              data-row
              onKeyDown={moveFocus}
              aria-label={label(s, done)}
              data-testid="atlas-timeline-vertical-row"
            >
              <span className="sci-v-year" aria-hidden="true">
                {s.year}
              </span>
              <span className="sci-v-line" aria-hidden="true" />
              <span className="sci-v-body" aria-hidden="true">
                <Portrait scientist={s} size={40} />
                <span className="sci-v-text">
                  <b>
                    {s.name}
                    {done ? <span className="sci-studied-dot"> ✓</span> : null}
                  </b>
                  <span className="sci-pop-meta">
                    {s.lived ? t('lived', { from: s.lived.from, to: s.lived.to }) : null}
                  </span>
                  <span className="sci-v-discovery">{s.discovery}</span>
                </span>
              </span>
            </AppLink>
          </li>
        );
      })}
    </ol>
  );
}

/** Маленький портрет (лента, мини-карточки, современники): фото или инициалы в золотом круге. */
export function Portrait({ scientist: s, size }: { scientist: Scientist; size: number }) {
  return s.portrait ? (
    <img
      src={s.portrait}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      decoding="async"
      className="sci-mini-portrait"
      style={{ width: size, height: size }}
    />
  ) : (
    <span className="sci-mini-portrait sci-mini-initials" style={{ width: size, height: size }}>
      {initials(s.name)}
    </span>
  );
}

/* ---------- Панель «Проверь себя» (REQ-SCI-03) и приглашение (REQ-SCI-04.3) ---------- */

/**
 * Две карточки сразу под заголовком: игра «Кто этот учёный?» (?game=1) и тест урока (/scientists/test), лучший
 * результат ученика. Гость — кнопки ведут на вход (экран теста показывает приглашение), учитель — предпросмотр.
 */
export function CheckPanel({ progress }: { progress: Progress | null }) {
  const t = useTranslations('atlas.sci.panel');
  const ta = useTranslations('atlas');
  const subjectId = useAtlasSubject();
  const card = (
    id: string,
    title: string,
    text: string,
    best: number | null | undefined,
    href: string,
    action: string,
    note?: string,
  ) => (
    <article className="sci-check-card" data-testid={`atlas-check-${id}`}>
      <h3>{title}</h3>
      <p>{text}</p>
      {note ? <p className="sci-check-note">{note}</p> : null}
      {best !== null && best !== undefined ? (
        <p className="sci-check-best">{t('best', { percent: best })}</p>
      ) : null}
      <AppLink href={href} scroll={false} className="btn btn-primary" data-testid={`atlas-check-${id}-go`}>
        {action}
      </AppLink>
    </article>
  );
  return (
    <section className="sci-check" aria-labelledby="sci-check-title" data-testid="atlas-check-panel">
      <h2 id="sci-check-title" className="sci-check-title">
        {t('title')}
      </h2>
      <div className="sci-check-cards">
        {card(
          'game',
          t('gameTitle'),
          t('gameText'),
          progress?.gameBestPercent,
          `${atlasHref(subjectId, 'scientists')}?game=1`,
          t('play'),
          t('gameXp'),
        )}
        {card(
          'test',
          t('testTitle'),
          t('testText'),
          progress?.testBestPercent,
          atlasHref(subjectId, 'scientists', '/test'),
          ta('detail.takeTest'),
        )}
      </div>
    </section>
  );
}

const DISMISS = 'atlas-sci-invite-dismissed';

/**
 * REQ-SCI-04.3: изучено ≥ 3 и тест урока не пройден на ≥ 80 % — «Вы изучили N из 9 — проверьте себя». Крестик
 * скрывает плашку до следующего изменения N (запоминается в браузере — удобство одного ученика).
 */
export function Invite({ progress }: { progress: Progress | null }) {
  const t = useTranslations('atlas.sci');
  const ta = useTranslations('atlas');
  const subjectId = useAtlasSubject();
  const count = progress?.studied.length ?? 0;
  const [dismissed, setDismissed] = useState<number | null>(() => {
    try {
      const v = window.localStorage.getItem(DISMISS);
      return v === null ? null : Number(v);
    } catch {
      return null;
    }
  });
  if (
    !progress ||
    count < SCIENTISTS_INVITE_FROM ||
    (progress.testBestPercent ?? 0) >= 80 ||
    dismissed === count
  )
    return null;
  return (
    <div className="sci-invite" role="status" data-testid="atlas-sci-invite">
      <span>{t('invite', { count, total: progress.total })}</span>
      <AppLink href={atlasHref(subjectId, 'scientists', '/test')} scroll={false} className="btn btn-primary">
        {ta('detail.takeTest')}
      </AppLink>
      <button
        type="button"
        className="sci-invite-close"
        aria-label={t('inviteClose')}
        onClick={() => {
          setDismissed(count);
          try {
            window.localStorage.setItem(DISMISS, String(count));
          } catch {
            // без хранилища — скрыто до перезагрузки
          }
        }}
        data-testid="atlas-sci-invite-close"
      >
        ×
      </button>
    </div>
  );
}

/* ---------- Окно учёного: современники, навигация, «Спросить Syntara AI» ---------- */

/** REQ-SCI-10: 2–3 учёных раздела с наибольшим пересечением лет жизни (≥ 10 лет). */
export function contemporariesOf(s: Scientist, all: Scientist[]): Scientist[] {
  if (!s.lived) return [];
  const overlap = (o: Scientist) =>
    o.lived ? Math.min(s.lived!.to, o.lived.to) - Math.max(s.lived!.from, o.lived.from) : 0;
  return all
    .filter((o) => o.code !== s.code && overlap(o) >= 10)
    .sort((a, b) => overlap(b) - overlap(a))
    .slice(0, 3);
}

export function Contemporaries({ list }: { list: Scientist[] }) {
  const t = useTranslations('atlas.sci');
  const subjectId = useAtlasSubject();
  if (!list.length) return null;
  return (
    <section className="sci-contemporaries" data-testid="atlas-contemporaries">
      <h4>{t('contemporaries')}</h4>
      <ul>
        {list.map((o) => (
          <li key={o.code}>
            <AppLink href={scientistHref(subjectId, o.code)} scroll={false} className="sci-mini-card">
              <Portrait scientist={o} size={40} />
              <span>
                <b>{o.name}</b>
                <span className="sci-pop-meta">
                  {o.lived ? t('lived', { from: o.lived.from, to: o.lived.to }) : null}
                </span>
                <span className="sci-pop-open">{t('open')}</span>
              </span>
            </AppLink>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** REQ-SCI-11: «← Предыдущий · Следующий →» по году открытия; адрес окна меняется, «назад» работает. */
export function ScientistNav({ prev, next }: { prev: Scientist | null; next: Scientist | null }) {
  const t = useTranslations('atlas.sci');
  const subjectId = useAtlasSubject();
  const link = (s: Scientist | null, dir: 'prev' | 'next') =>
    s ? (
      <AppLink
        href={scientistHref(subjectId, s.code)}
        scroll={false}
        className={`sci-nav-btn ${dir}`}
        aria-label={`${t(dir)}: ${s.name}, ${s.year ?? ''}`}
        data-testid={`atlas-sci-${dir}`}
      >
        {dir === 'prev' ? '← ' : ''}
        {s.name} · {s.year}
        {dir === 'next' ? ' →' : ''}
      </AppLink>
    ) : (
      <span />
    );
  return (
    <nav className="sci-nav" aria-label={`${t('prev')} / ${t('next')}`}>
      {link(prev, 'prev')}
      {link(next, 'next')}
    </nav>
  );
}

/** Цитата (REQ-SCI-12): крупные кавычки, курсив, золотая полоса; подпись «— {имя}» и пометка из урока. */
export function QuoteCard({ quote, name }: { quote: { text: string; note: string | null }; name: string }) {
  const t = useTranslations('atlas.sci');
  return (
    <figure className="sci-quote" aria-label={t('quoteLabel')} data-testid="atlas-sci-quote">
      <blockquote>{quote.text}</blockquote>
      <figcaption>
        {t('quoteBy', { name })}
        {quote.note ? <span className="sci-quote-note"> ({quote.note})</span> : null}
      </figcaption>
    </figure>
  );
}

/** «Отметить как изученное» / «Изучено ✓» и «Изучено N из 9» (REQ-SCI-04.1, 04.2) — только ученик. */
export function StudiedToggle({ code }: { code: string }) {
  const t = useTranslations('atlas.sci');
  const { progress, student, mark } = useScientistsProgress();
  if (!student || !progress) return null;
  const done = progress.studied.includes(code);
  return (
    <div className="sci-studied">
      <button
        type="button"
        className={`btn ${done ? 'btn-secondary' : 'btn-primary'} sci-studied-btn`}
        aria-pressed={done}
        disabled={mark.isPending}
        onClick={() => mark.mutate({ code, studied: !done })}
        data-testid="atlas-sci-studied"
      >
        {done ? t('studiedDone') : t('markStudied')}
      </button>
      <span className="sci-studied-count" data-testid="atlas-sci-studied-count">
        {t('studiedCount', { count: progress.studied.length, total: progress.total })}
      </span>
    </div>
  );
}
