'use client';

import { useTranslations } from 'next-intl';
import { badgeCount } from '@syntara/shared';
import { cn } from '@syntara/ui';
import { type NavBadgeKind } from './nav';
import { type NavBadges } from './nav-state';

export interface NavBadgeState {
  /** «9+» и т. п. — только у «Мои задания». */
  count: string | null;
  dot: boolean;
  danger: boolean;
}

/** Что показать у пункта (REQ-NAV-14); null — ничего. */
export function navBadgeState(
  kind: NavBadgeKind | undefined,
  badges: NavBadges | null,
): NavBadgeState | null {
  if (!kind || !badges) return null;
  if (kind === 'assignments') {
    const count = badgeCount(badges.assignmentsOpen);
    return count ? { count, dot: false, danger: badges.assignmentsOverdue > 0 } : null;
  }
  const isNew = kind === 'class' ? badges.classHasNew : badges.achievementsHasNew;
  return isNew ? { count: null, dot: true, danger: false } : null;
}

/** Доступное имя пункта со счётчиком (REQ-NAV-14, п. 5): «Мои задания, 2 невыполненных, есть просроченные». */
export function useNavBadgeLabel() {
  const t = useTranslations('cabinet.navBadges');
  return (label: string, kind: NavBadgeKind | undefined, badges: NavBadges | null) => {
    const state = navBadgeState(kind, badges);
    if (!state) return label;
    if (state.dot) return `${label}, ${t('new')}`;
    const parts = [label, t('open', { count: badges!.assignmentsOpen })];
    if (state.danger) parts.push(t('overdue'));
    return parts.join(', ');
  };
}

const tone = (danger: boolean) =>
  // Белый на --danger не даёт 4,5:1 — тёмный текст (как у Badge success).
  danger ? 'bg-[var(--danger)] text-[#070707]' : 'bg-[var(--accent-strong)] text-white';

/**
 * Число справа от подписи (развёрнутая панель, меню) или точка «новое». В свёрнутой панели число становится
 * точкой на иконке того же цвета (REQ-NAV-14, п. 4) — `placement='icon'`. Всё — aria-hidden: состояние в aria-label.
 */
export function NavBadge({ state, placement }: { state: NavBadgeState; placement: 'row' | 'icon' }) {
  if (placement === 'icon') {
    return (
      <span
        aria-hidden="true"
        data-testid="nav-badge-dot"
        className={cn(
          'pointer-events-none absolute -top-0.5 -right-0.5 size-2.5 rounded-full ring-2 ring-[var(--sidebar)]',
          state.danger ? 'bg-[var(--danger)]' : 'bg-[var(--accent-strong)]',
        )}
      />
    );
  }
  return state.count ? (
    <span
      aria-hidden="true"
      data-testid="nav-badge-count"
      data-tone={state.danger ? 'danger' : 'accent'}
      className={cn(
        'ml-auto inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full px-1.5 text-[11px] leading-none font-bold',
        tone(state.danger),
      )}
    >
      {state.count}
    </span>
  ) : (
    <span
      aria-hidden="true"
      data-testid="nav-badge-new"
      className="ml-auto size-2 shrink-0 rounded-full bg-[var(--accent-bright)]"
    />
  );
}
