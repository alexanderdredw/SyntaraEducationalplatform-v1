'use client';

import { type CSSProperties, forwardRef, useState, type HTMLAttributes, type ReactNode } from 'react';
import { Progress } from 'radix-ui';
import { AVATAR_ART } from './avatar-presets';
import { cn } from './cn';

/**
 * Рамка карточки: обычная; акцентная — полупрозрачная синяя рамка и лёгкий синий фон (U08 «Что делать дальше»,
 * полученный бейдж U10); «выноска» — синяя полоса слева (U08: строка дат, «Начни отсюда»);
 * красная — «Требуют внимания» (T10).
 */
export type CardTone = 'default' | 'accent' | 'callout' | 'danger';
const cardTones: Record<CardTone, string> = {
  default: 'border-[var(--border)]',
  accent:
    'border-[color-mix(in_srgb,var(--accent)_55%,transparent)] bg-[color-mix(in_srgb,var(--accent)_6%,var(--surface))]',
  callout:
    'border-[var(--border)] border-l-[3px] border-l-[var(--accent)] bg-[color-mix(in_srgb,var(--accent)_7%,var(--surface))]',
  danger: 'border-[color-mix(in_srgb,var(--danger)_60%,transparent)]',
};

/** Card (3.2): поверхность `--surface`, радиус `--radius-card`. */
export const Card = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement> & { tone?: CardTone }>(
  function Card({ className, tone = 'default', ...props }, ref) {
    return (
      <div
        ref={ref}
        data-tone={tone === 'default' ? undefined : tone}
        className={cn(
          'rounded-[var(--radius-card)] border p-5 shadow-card',
          tone === 'default' || tone === 'danger' ? 'bg-[var(--surface)]' : null,
          cardTones[tone],
          className,
        )}
        {...props}
      />
    );
  },
);

/** Pill (3.2): капсула-метка, например статус темы. */
export function Pill({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-[var(--radius-pill)] border border-[var(--border-strong)] px-2.5 py-0.5 text-xs',
        className,
      )}
      {...props}
    />
  );
}

export type BadgeTone = 'neutral' | 'accent' | 'success' | 'danger';
const tones: Record<BadgeTone, string> = {
  neutral: 'bg-[var(--field)] text-[var(--text-muted)]',
  accent: 'bg-[var(--accent-strong)] text-white',
  // Белый на --success даёт 3.1:1 — для текста статуса нужен тёмный (REQ-NFR-A11Y-01).
  success: 'bg-[var(--success)] text-[#070707]',
  // Белый на --danger не даёт 4,5:1 — красный текст с красной рамкой (T10 «неактивен»).
  danger: 'border border-[var(--danger)] text-[var(--danger-text)]',
};

/** Badge (3.2): небольшой статусный знак. */
export function Badge({
  tone = 'neutral',
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement> & { tone?: BadgeTone }) {
  return (
    <span
      data-tone={tone}
      className={cn(
        'inline-flex items-center rounded-[var(--radius-item)] px-2 py-0.5 text-xs font-medium',
        tones[tone],
        className,
      )}
      {...props}
    />
  );
}

/** EmptyState (3.2): пустое состояние списка; текст передаётся из i18n. */
export function EmptyState({
  icon,
  title,
  children,
}: {
  icon?: ReactNode;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 py-6 text-center text-[var(--text-muted)]">
      {icon ? <span aria-hidden="true">{icon}</span> : null}
      <p className="text-sm">{title}</p>
      {children}
    </div>
  );
}

/** Skeleton (3.2): плейсхолдер загрузки, скрыт от вспомогательных технологий. */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn('animate-pulse rounded-[var(--radius-item)] bg-[var(--field)]', className)}
    />
  );
}

/** Цвет полосы и значения: акцент, «слабо» (красный) и «освоено» (зелёный) — BR-AN-04, T10. */
export type ProgressTone = 'accent' | 'danger' | 'success';
const barTones: Record<ProgressTone, string> = {
  accent: 'bg-[var(--accent)]',
  danger: 'bg-[var(--danger)]',
  success: 'bg-[var(--success)]',
};
/** Текст значения рядом с полосой — контраст ≥ 4,5:1 (REQ-NFR-A11Y-01). */
export const progressTextTones: Record<ProgressTone, string> = {
  accent: 'text-[var(--accent)]',
  danger: 'text-[var(--danger-text)]',
  success: 'text-[var(--success-text)]',
};

/** ProgressBar (3.2): `value` 0–100; `label` — доступное имя из i18n. */
export function ProgressBar({
  value,
  label,
  className,
  tone = 'accent',
}: {
  value: number;
  label: string;
  className?: string;
  tone?: ProgressTone;
}) {
  const clamped = Math.min(100, Math.max(0, value));
  return (
    <Progress.Root
      value={clamped}
      aria-label={label}
      className={cn(
        'relative h-2 w-full overflow-hidden rounded-[var(--radius-pill)] bg-[var(--field)]',
        className,
      )}
    >
      <Progress.Indicator
        className={cn('h-full transition-[width] duration-200 ease-[var(--ease-standard)]', barTones[tone])}
        style={{ width: `${clamped}%` }}
      />
    </Progress.Root>
  );
}

/**
 * Eyebrow — метка секции с короткой линией слева (UX-03, UX-05, UX-09): капслок, разрядка.
 * `tone`: приглушённая (UX-03) или фирменная (UX-05, UX-09).
 */
export function Eyebrow({
  children,
  tone = 'muted',
  className,
}: {
  children: ReactNode;
  tone?: 'muted' | 'accent';
  className?: string;
}) {
  return (
    <p
      className={cn(
        'flex items-center gap-3 text-xs font-semibold uppercase tracking-[0.2em]',
        tone === 'accent' ? 'text-[var(--accent)]' : 'text-[var(--text-muted)]',
        className,
      )}
    >
      <span aria-hidden="true" className="h-px w-6 shrink-0 bg-current" />
      {children}
    </p>
  );
}

/** IconTile — значок в квадратной плитке с подложкой фирменного цвета (UX-03, UX-05, UX-07, UX-08). */
export function IconTile({ children, size = 'md' }: { children: ReactNode; size?: 'sm' | 'md' }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-flex shrink-0 items-center justify-center border border-[color-mix(in_srgb,var(--accent)_30%,var(--border))] bg-[var(--accent-soft)] text-[var(--accent-bright)]',
        size === 'md' ? 'size-12 rounded-[12px] [&_svg]:size-6' : 'size-9 rounded-[10px] [&_svg]:size-[18px]',
      )}
    >
      {children}
    </span>
  );
}

/** Аватар пользователя в ответах API (6.7 AvatarDto). */
export interface AvatarData {
  kind: 'initials' | 'preset' | 'photo';
  preset: string | null;
  color: string;
  initials: string;
  photoUrl: string | null;
  photoUrlSmall: string | null;
}

/** REQ-PRF-11: размеры аватара. */
export type AvatarSize = 24 | 32 | 40 | 64 | 88 | 96 | 112;

/** Цвета подложки и знака аватара (BR-PRF-02): токены --avatar-* обеих тем. */
export function avatarColorStyle(color: string): CSSProperties {
  const tone = `var(--avatar-${color}, var(--avatar-slate))`;
  const background = `color-mix(in srgb, ${tone} var(--avatar-bg-mix), var(--surface))`;
  return {
    background,
    color: `color-mix(in srgb, ${tone} var(--avatar-ink-mix), var(--avatar-ink-base))`,
    ['--avatar-cut' as string]: background,
  };
}

/** Рисунок аватара набора без подложки — для выбора аватара и самого Avatar. */
export function AvatarArt({ preset, className }: { preset: string; className?: string }) {
  const item = AVATAR_ART[preset];
  if (!item) return null;
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true" focusable="false" className={className}>
      {item.art}
    </svg>
  );
}

/** Цвет подложки аватара набора (у каждого рисунка — свой из 8 токенов). */
export const avatarPresetColor = (preset: string) => AVATAR_ART[preset]?.color ?? 'slate';

/**
 * Avatar (REQ-PRF-11): `avatar` — аватар пользователя (круг): своя картинка, рисунок набора или инициалы на цветной
 * подложке; при ошибке загрузки картинки — инициалы (без значка битой картинки). `alt`/`aria-label` — имя;
 * `decorative` — имя уже написано рядом, аватар скрыт от экранного диктора.
 * Без `avatar` — фото участника команды или инициалы на квадрате (UX-08, страница «О проекте»).
 */
export function Avatar({
  src,
  name,
  initials,
  tone = 'accent',
  avatar,
  size = 64,
  decorative = false,
  className,
}: {
  src?: string | null;
  name: string;
  initials?: string;
  tone?: 'accent' | 'warning' | 'success';
  avatar?: AvatarData | null;
  size?: AvatarSize;
  decorative?: boolean;
  className?: string;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  if (avatar) {
    const label = decorative ? { 'aria-hidden': true as const } : { role: 'img', 'aria-label': name };
    const box = cn(
      'inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full',
      className,
    );
    const dims = { width: size, height: size };
    const photo =
      avatar.kind === 'photo'
        ? size <= 40
          ? (avatar.photoUrlSmall ?? avatar.photoUrl)
          : avatar.photoUrl
        : null;
    if (photo && failed !== photo) {
      return (
        <img
          src={photo}
          alt={decorative ? '' : name}
          width={size}
          height={size}
          loading="lazy"
          decoding="async"
          className={cn(box, 'object-cover')}
          style={dims}
          onError={() => setFailed(photo)}
        />
      );
    }
    if (avatar.kind === 'preset' && avatar.preset && AVATAR_ART[avatar.preset]) {
      return (
        <span
          {...label}
          data-avatar="preset"
          className={box}
          style={{ ...dims, ...avatarColorStyle(avatarPresetColor(avatar.preset)) }}
        >
          <AvatarArt preset={avatar.preset} className="size-[78%]" />
        </span>
      );
    }
    return (
      <span
        {...label}
        data-avatar="initials"
        className={cn(box, 'font-semibold leading-none select-none')}
        style={{ ...dims, fontSize: Math.max(10, Math.round(size * 0.4)), ...avatarColorStyle(avatar.color) }}
      >
        {size <= 24 ? avatar.initials.charAt(0) : avatar.initials}
      </span>
    );
  }

  const box = cn(
    'inline-flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-[14px]',
    className,
  );
  if (src && failed !== src) {
    return <img src={src} alt={name} className={cn(box, 'object-cover')} onError={() => setFailed(src)} />;
  }
  const tones = {
    accent: 'bg-[var(--accent-soft)] text-[var(--accent-bright)]',
    warning: 'bg-[color-mix(in_srgb,var(--warning)_12%,transparent)] text-[var(--warning-text)]',
    success: 'bg-[color-mix(in_srgb,var(--success)_12%,transparent)] text-[var(--success-text)]',
  };
  return (
    <span role="img" aria-label={name} className={cn(box, 'text-lg font-bold', tones[tone])}>
      {initials}
    </span>
  );
}
