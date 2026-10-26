import type { components } from '@/lib/api/schema';

export type Analytics = components['schemas']['ClassAnalyticsDto'];

/**
 * «N дней назад» для «Требуют внимания» — при загрузке, а не при отрисовке. Общая для браузера и предзагрузки на
 * сервере (OPT-05, О4-2): в кеше TanStack Query лежат данные одной формы.
 */
export function withAttentionDays(data: Analytics, now = Date.now()) {
  return {
    ...data,
    attention: data.attention.map((a) => ({
      ...a,
      days: a.lastActivityAt
        ? Math.max(0, Math.floor((now - Date.parse(a.lastActivityAt)) / 86_400_000))
        : null,
    })),
  };
}
