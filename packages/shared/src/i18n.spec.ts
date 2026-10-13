import { describe, expect, it } from 'vitest';
import ru from '../i18n/ru.json';
import kk from '../i18n/kk.json';
import en from '../i18n/en.json';
import needsReview from '../i18n/needs_review.json';
import needsConfirmation from '../i18n/needs_confirmation.json';
import { flattenKeys, getMessage, LOCALES } from './i18n';

const bundles = { ru, kk, en };

describe('i18n', () => {
  it('REQ-NFR-I18N-01 keys of ru, kk and en are identical', () => {
    const ruKeys = flattenKeys(ru).sort();
    expect(flattenKeys(kk).sort()).toEqual(ruKeys);
    expect(flattenKeys(en).sort()).toEqual(ruKeys);
  });

  it('REQ-NFR-I18N-01 every locale has a non-empty translation for every key', () => {
    for (const locale of LOCALES) {
      for (const key of flattenKeys(bundles[locale])) {
        expect(getMessage(bundles[locale], key), `${locale}:${key}`).toMatch(/\S/);
      }
    }
  });

  it('REQ-GEN-PREF-02 every kk translation is tracked for native-speaker review', () => {
    const tracked = needsReview.keys as Record<string, string>;
    expect(Object.keys(tracked).sort()).toEqual(flattenKeys(kk).sort());
    for (const status of Object.values(tracked)) expect(['needs_review', 'reviewed']).toContain(status);
  });

  it('AG-03 placeholder texts listed in needs_confirmation exist in ru.json', () => {
    for (const key of Object.keys(needsConfirmation.keys)) {
      expect(getMessage(ru, key), key).toBeDefined();
    }
  });

  it('AG-03 SPEC texts are verbatim', () => {
    expect(ru.common.skipToContent).toBe('К содержимому');
    expect(ru.common.sectionInDevelopment).toBe('Раздел в разработке');
    expect(ru.validation.email).toBe('Введите email, например name@example.com');
    expect(ru.locale.soon).toBe('скоро');
  });
});
