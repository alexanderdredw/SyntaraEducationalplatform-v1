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

  it('AG-03 SM-FORM, REQ-PUB-REQ-01..02, REQ-PUB-SUP-01..03 form texts are verbatim from SPEC', () => {
    expect(ru.forms.submitting).toBe('Отправляем...');
    expect(ru.forms.networkError).toBe('Нет соединения. Проверьте интернет и повторите отправку');
    expect(ru.forms.serverError).toBe('Не удалось подтвердить отправку. Повторите попытку');
    expect(ru.schoolRequest.success).toBe('Заявка получена');
    expect(ru.support.success).toBe('Обращение получено');
    expect(ru.schoolRequest.fields).toEqual({
      schoolName: 'Название школы',
      region: 'Регион',
      city: 'Город / село',
      contactPerson: 'Контактное лицо',
      phone: 'Телефон',
      email: 'Email',
      message: 'Сообщение',
    });
    expect(ru.schoolRequest.placeholders.message).toBe('Сколько классов, что важно, когда хотите начать...');
    expect(ru.schoolRequest.submit).toBe('Оставить заявку');
    expect(ru.support.fields).toEqual({
      category: 'Категория',
      subject: 'Тема',
      name: 'Ваше имя (необязательно)',
      email: 'Email для ответа',
      phone: 'Телефон (необязательно)',
      description: 'Опишите проблему',
    });
    expect(Object.values(ru.support.categories)).toEqual([
      'Техническая проблема',
      'Подключение школы',
      'Вопрос по обучению',
      'Аккаунт и доступ',
      'Данные и конфиденциальность',
      'Другое',
    ]);
    expect(ru.support.submit).toBe('Отправить обращение');
    expect(ru.support.techContextNote).toBe(
      'К обращению будут добавлены технические сведения: страница, язык, браузер',
    );
    expect(ru.auth.login.submit).toBe('Войти');
    expect(ru.auth.login.forgot).toBe('Забыли пароль?');
  });
});
