import { HttpException } from '@nestjs/common';
import { type ApiErrorCode } from '@syntara/shared';

/** Исключение с кодом ошибки API-GEN-04 и (необязательно) ошибками полей. */
export class ApiException extends HttpException {
  constructor(
    status: number,
    readonly code: ApiErrorCode,
    message: string,
    readonly fieldErrors?: Record<string, string>,
    readonly retryAfterSeconds?: number,
    /** Battle: свежий снимок при 409 staleState (SPEC 6.8). */
    readonly snapshot?: unknown,
    /** BR-AUTH-01: форма входа для аккаунта при 403 wrongRoleForLogin. */
    readonly expectedEntry?: 'student' | 'teacher',
  ) {
    super(message, status);
  }
}
