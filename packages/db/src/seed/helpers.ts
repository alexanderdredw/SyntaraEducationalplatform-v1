import { argon2id, hash } from 'argon2';
import { type Locale } from '@syntara/shared';

export type Tr<T> = Record<Locale, T>;

/** Строки переводов для *_translations из записи { ru, kk, en }. */
export function rows<T extends object, K extends string>(
  key: K,
  id: string,
  tr: Partial<Tr<T>>,
): Array<T & Record<K, string> & { locale: Locale }> {
  return (Object.entries(tr) as Array<[Locale, T]>).map(
    ([locale, value]) => ({ [key]: id, locale, ...value }) as T & Record<K, string> & { locale: Locale },
  );
}

/** Argon2id (REQ-NFR-SEC-02). */
export function hashPassword(password: string): Promise<string> {
  return hash(password, { type: argon2id });
}

export function assertNotProduction(set: string): void {
  if (process.env.NODE_ENV === 'production') {
    throw new Error(`Seed "${set}" is for development and visual tests only and must not run in production`);
  }
}
