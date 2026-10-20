/** Формат ошибки API (API-GEN-04). */
export interface ApiErrorBody {
  code: ApiErrorCode;
  message: string;
  fieldErrors?: Record<string, string>;
  requestId: string;
  /** Только для 429 (API-GEN-06). */
  retryAfterSeconds?: number;
  /** Battle: свежий снимок при 409 staleState (SPEC 6.8). */
  snapshot?: unknown;
}

export const API_ERROR_CODES = [
  'VALIDATION_FAILED',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'IDEMPOTENCY_MISMATCH',
  'INVALID_TRANSITION',
  'PAYLOAD_TOO_LARGE',
  'UNPROCESSABLE',
  'RATE_LIMITED',
  'INTERNAL_ERROR',
  'SERVICE_UNAVAILABLE',
] as const;
export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

/** Код ошибки по умолчанию для HTTP-статуса (API-GEN-04). */
export const DEFAULT_ERROR_CODE_BY_STATUS: Readonly<Record<number, ApiErrorCode>> = {
  400: 'VALIDATION_FAILED',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  413: 'PAYLOAD_TOO_LARGE',
  422: 'UNPROCESSABLE',
  429: 'RATE_LIMITED',
  500: 'INTERNAL_ERROR',
  503: 'SERVICE_UNAVAILABLE',
};
