import {
  Award,
  BookCheck,
  Brain,
  Crown,
  Flame,
  Footprints,
  GraduationCap,
  Mountain,
  RotateCcw,
  Star,
  Trophy,
  Wrench,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { cn } from './cn';
import { avatarColorStyle } from './display';

/**
 * Иконка и цвет бейджа (FIX-05, docs/PROFILE_TZ_2.md; список — BR-BDG-01): у каждого бейджа свои, одинаковые в
 * «Достижениях» и «Обзоре». Цвета — токены --avatar-* (корректно в обеих темах); закрытый бейдж — серый.
 * Картинка бейджа из хранилища (если задана) заменяет значок.
 */
export const BADGE_LOOK: Record<string, { icon: LucideIcon; color: string }> = {
  first_step: { icon: Footprints, color: 'blue' },
  warmup: { icon: Flame, color: 'orange' },
  week_power: { icon: Zap, color: 'amber' },
  marathon: { icon: Mountain, color: 'violet' },
  topic_mastered: { icon: BookCheck, color: 'green' },
  five_topics: { icon: Star, color: 'teal' },
  erudition: { icon: GraduationCap, color: 'violet' },
  subject_conquered: { icon: Trophy, color: 'amber' },
  erudite: { icon: Brain, color: 'pink' },
  legend: { icon: Crown, color: 'amber' },
  comeback: { icon: RotateCcw, color: 'teal' },
  bug_fixing: { icon: Wrench, color: 'slate' },
};

export function BadgeIcon({
  code,
  earned = true,
  imageUrl,
  size = 56,
  className,
}: {
  code: string;
  earned?: boolean;
  imageUrl?: string | null;
  size?: 32 | 40 | 56;
  className?: string;
}) {
  const dims = { width: size, height: size };
  if (imageUrl) {
    return (
      <img src={imageUrl} alt="" aria-hidden="true" style={dims} className={cn('shrink-0', className)} />
    );
  }
  const look = BADGE_LOOK[code] ?? { icon: Award, color: 'blue' };
  const Icon = look.icon;
  return (
    <span
      aria-hidden="true"
      data-badge-icon={code}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full',
        !earned && 'bg-[var(--field)] text-[var(--text-muted)]',
        className,
      )}
      style={{ ...dims, ...(earned ? avatarColorStyle(look.color) : {}) }}
    >
      <Icon style={{ width: size * 0.55, height: size * 0.55 }} strokeWidth={1.75} />
    </span>
  );
}
