/** Cookie предпочтений (REQ-GEN-PREF-01..04, REQ-PUB-LEGAL-02). Сохранение в user_preferences — итерация 6. */
export const COOKIE = {
  locale: 'locale',
  theme: 'theme',
  dataSaver: 'data_saver',
  consent: 'consent',
} as const;

export type Theme = 'light' | 'dark';
export type Consent = 'necessary' | 'all';

const YEAR_SECONDS = 365 * 24 * 60 * 60;

export function writeCookie(name: string, value: string, maxAgeSeconds = YEAR_SECONDS): void {
  const secure = window.location.protocol === 'https:' ? '; secure' : '';
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=${maxAgeSeconds}; samesite=lax${secure}`;
}

export function parseTheme(value: string | undefined): Theme | undefined {
  return value === 'light' || value === 'dark' ? value : undefined;
}

export function parseConsent(value: string | undefined): Consent | undefined {
  return value === 'necessary' || value === 'all' ? value : undefined;
}

/**
 * Скрипт в <head>: ставит data-theme до отрисовки (REQ-GEN-PREF-03, без мигания).
 * При ручном выборе тема уже пришла с сервера из cookie; иначе — prefers-color-scheme.
 */
export const THEME_INIT_SCRIPT = `(function(){try{var d=document.documentElement;if(!d.getAttribute('data-theme')){d.setAttribute('data-theme',window.matchMedia('(prefers-color-scheme: light)').matches?'light':'dark')}}catch(e){}})();`;
