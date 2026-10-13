import createClient from 'openapi-fetch';
import type { paths } from './schema';

/**
 * Типизированный клиент API (API-GEN-01): типы генерируются из apps/api/openapi.json командой `pnpm openapi`.
 * В браузере — относительный путь (тот же origin через nginx); на сервере (SSR) — API_INTERNAL_URL.
 */
export function createApiClient(
  baseUrl = typeof window === 'undefined' ? (process.env.API_INTERNAL_URL ?? '') : '',
) {
  return createClient<paths>({ baseUrl, credentials: 'include' });
}
