import { apiRequest, csrfToken } from './api/browser';

/**
 * API-ME-02: у вошедшего пользователя (есть cookie `csrf`) выбор языка, темы и экономии трафика
 * сохраняется в user_preferences (REQ-GEN-PREF-01, -03, -04). Гостю — только cookie (итерация 3).
 */
export function syncPreferences(patch: { locale?: string; theme?: string; dataSaver?: boolean }): void {
  if (!csrfToken()) return;
  void apiRequest('/api/me/preferences', { method: 'PATCH', body: patch, timeoutMs: 5000 });
}
