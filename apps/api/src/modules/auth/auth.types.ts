import { type Request } from 'express';
import { type UserRole } from '@syntara/shared';

/** Пользователь текущей сессии (API-GEN-02). */
export interface AuthUser {
  id: string;
  displayName: string;
  roles: UserRole[];
  sessionId: string;
}

export type AuthRequest = Request & { user?: AuthUser; id?: string };

export const SESSION_COOKIE = 'sid';
export const CSRF_COOKIE = 'csrf';
export const CSRF_HEADER = 'x-csrf-token';
/** API-ME-03: выбранная роль (проверяется по user_roles при каждом запросе). */
export const ACTIVE_ROLE_COOKIE = 'role';

/** API-GEN-02, REQ-NFR-SEC-03: срок сессии — до 14 дней с продлением. */
export const SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000;
/** Продление не чаще раза в сутки — чтобы не писать в БД на каждый запрос. */
export const SESSION_RENEW_AFTER_MS = 24 * 60 * 60 * 1000;

/** Порядок выбора активной роли до появления API-ME-03 (итерация 6) — порядок перечисления 5.2. */
export const ROLE_ORDER: readonly UserRole[] = ['student', 'teacher', 'support_agent', 'onboarding_agent'];
