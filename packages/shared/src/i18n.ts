import { type Locale } from './enums';

/** Языки интерфейса (REQ-GEN-PREF-01). Включённые языки — PH-04 `i18n.enabled_locales`. */
export const LOCALES = ['ru', 'kk', 'en'] as const satisfies readonly Locale[];
export const DEFAULT_LOCALE: Locale = 'ru';

export type Messages = { [key: string]: string | Messages };

/** Плоский список ключей вида `a.b.c` (REQ-NFR-I18N-01: ключи ru/kk/en совпадают). */
export function flattenKeys(messages: Messages, prefix = ''): string[] {
  return Object.entries(messages).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return typeof value === 'string' ? [path] : flattenKeys(value, path);
  });
}

export function getMessage(messages: Messages, path: string): string | undefined {
  let node: string | Messages | undefined = messages;
  for (const part of path.split('.')) {
    if (node === undefined || typeof node === 'string') return undefined;
    node = node[part];
  }
  return typeof node === 'string' ? node : undefined;
}
