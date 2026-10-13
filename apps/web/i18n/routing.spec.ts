import { describe, expect, it } from 'vitest';
import { flattenKeys, LOCALES } from '@syntara/shared';
import { MESSAGES } from './messages';
import { routing } from './routing';

describe('web i18n (REQ-GEN-PREF-01)', () => {
  it('REQ-GEN-PREF-01 routes all three locales with a URL prefix and the `locale` cookie', () => {
    expect(routing.locales).toEqual(LOCALES);
    expect(routing.defaultLocale).toBe('ru');
    expect(routing.localePrefix).toBe('always');
    expect(routing.localeCookie).toMatchObject({ name: 'locale' });
  });

  it('REQ-NFR-I18N-01 loads a full message bundle for each locale', () => {
    const ruKeys = flattenKeys(MESSAGES.ru);
    for (const locale of LOCALES) expect(flattenKeys(MESSAGES[locale])).toEqual(ruKeys);
  });
});
