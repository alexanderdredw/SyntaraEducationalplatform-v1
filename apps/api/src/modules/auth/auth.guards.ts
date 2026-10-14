import {
  type CanActivate,
  type ExecutionContext,
  HttpStatus,
  Injectable,
  SetMetadata,
  applyDecorators,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ApiCookieAuth, ApiForbiddenResponse, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { type Response } from 'express';
import { type UserRole } from '@syntara/shared';
import { ApiException } from '../../common/api-exception';
import { type AuthRequest, CSRF_COOKIE, CSRF_HEADER, SESSION_COOKIE } from './auth.types';
import { SessionService } from './session.service';

const ROLES_KEY = 'auth:roles';
const SKIP_CSRF_KEY = 'auth:skip-csrf';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Доступ только для пользователей с одной из ролей (REQ-GEN-ACL, AG-04). Без ролей — любой вошедший.
 * Нет сессии → 401; нет роли → 403 (BR-ACL-04).
 */
export const Roles = (...roles: UserRole[]) =>
  applyDecorators(
    SetMetadata(ROLES_KEY, roles),
    ApiCookieAuth('sid'),
    ApiUnauthorizedResponse({ description: 'Нет сессии' }),
    ApiForbiddenResponse({ description: 'Нет роли или неверный X-CSRF-Token' }),
  );

/** Вебхуки без cookie-сессии (API-SUP-08) — CSRF не применяется. */
export const SkipCsrf = () => SetMetadata(SKIP_CSRF_KEY, true);

/**
 * Глобальный guard сессии: определяет пользователя по cookie `sid` и для изменяющих запросов
 * с сессией требует X-CSRF-Token, равный cookie `csrf` (API-GEN-02, REQ-NFR-SEC-03).
 * Запросы гостя без cookie сессии не несут чужих полномочий — для них CSRF не нужен.
 */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly sessions: SessionService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const req = context.switchToHttp().getRequest<AuthRequest>();
    const res = context.switchToHttp().getResponse<Response>();
    const cookies = (req.cookies ?? {}) as Record<string, string | undefined>;
    const token = cookies[SESSION_COOKIE];
    if (!token) return true;

    const user = await this.sessions.resolve(token, res, cookies[CSRF_COOKIE]);
    if (!user) {
      this.sessions.clearCookies(res);
      return true;
    }
    req.user = user;

    const skipCsrf = this.reflector.getAllAndOverride<boolean>(SKIP_CSRF_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!SAFE_METHODS.has(req.method) && !skipCsrf) {
      const header = req.headers[CSRF_HEADER];
      if (
        !SessionService.csrfMatches(cookies[CSRF_COOKIE], typeof header === 'string' ? header : undefined)
      ) {
        throw new ApiException(HttpStatus.FORBIDDEN, 'FORBIDDEN', 'CSRF token missing or invalid');
      }
    }
    return true;
  }
}

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<UserRole[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (roles === undefined) return true;
    const user = context.switchToHttp().getRequest<AuthRequest>().user;
    if (!user) throw new ApiException(HttpStatus.UNAUTHORIZED, 'UNAUTHORIZED', 'Authentication required');
    if (roles.length > 0 && !roles.some((r) => user.roles.includes(r))) {
      throw new ApiException(HttpStatus.FORBIDDEN, 'FORBIDDEN', 'Forbidden');
    }
    return true;
  }
}
