import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { type Request, type Response } from 'express';
import { type ApiErrorBody, DEFAULT_ERROR_CODE_BY_STATUS } from '@syntara/shared';
import { ApiException } from './api-exception';
import { REQUEST_ID_HEADER } from './request-id';

/**
 * Единый формат ошибки (API-GEN-04):
 * `{ code, message, fieldErrors?, requestId, retryAfterSeconds? }`.
 * Детали непредвиденных ошибок клиенту не отдаются; в журнал — без тела запроса (REQ-NFR-SEC-07).
 */
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request & { id?: string }>();
    const res = ctx.getResponse<Response>();
    const requestId = String(req.id ?? req.headers[REQUEST_ID_HEADER] ?? '');

    const status =
      exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const body: ApiErrorBody = {
      code: DEFAULT_ERROR_CODE_BY_STATUS[status] ?? (status >= 500 ? 'INTERNAL_ERROR' : 'VALIDATION_FAILED'),
      message: status >= 500 ? 'Internal server error' : this.messageOf(exception),
      requestId,
    };

    if (exception instanceof ApiException) {
      body.code = exception.code;
      if (exception.fieldErrors) body.fieldErrors = exception.fieldErrors;
      if (exception.retryAfterSeconds !== undefined) {
        body.retryAfterSeconds = exception.retryAfterSeconds;
        res.setHeader('Retry-After', String(exception.retryAfterSeconds));
      }
    }

    if (status >= 500) {
      this.logger.error(
        { requestId, err: exception instanceof Error ? exception.message : 'unknown' },
        'Unhandled error',
      );
    }

    res.status(status).json(body);
  }

  private messageOf(exception: unknown): string {
    if (exception instanceof HttpException) {
      const response = exception.getResponse();
      if (typeof response === 'string') return response;
      const message = (response as { message?: unknown }).message;
      if (typeof message === 'string') return message;
      if (Array.isArray(message)) return message.join('; ');
    }
    return 'Error';
  }
}
