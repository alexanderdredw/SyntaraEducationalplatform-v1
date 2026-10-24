import { z } from 'zod';

/** REQ-NAV-14: разделы, у которых панель ученика показывает точку «новое» (таблица nav_seen). */
export const NAV_SECTIONS = ['class', 'achievements'] as const;
export const NavSection = z.enum(NAV_SECTIONS, 'invalidSection');
export type NavSection = z.infer<typeof NavSection>;

/** API-S-21 */
export const NavSeenDto = z.object({ section: NavSection });
export type NavSeenDto = z.infer<typeof NavSeenDto>;

/** Бейдж счётчика (REQ-NAV-14): 0 — ничего, 1–9 — число, больше — «9+». */
export function badgeCount(n: number): string | null {
  if (n <= 0) return null;
  return n > 9 ? '9+' : String(n);
}
