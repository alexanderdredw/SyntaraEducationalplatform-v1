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
  ) {
    super(message, status);
  }
}
