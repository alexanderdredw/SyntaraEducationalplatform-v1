import { describe, expect, it } from 'vitest';
import { QuestionDto, SchoolRequestDto, SupportTicketDto } from './dto';
import ru from '../i18n/ru.json';

const messagesOf = (r: { success: boolean; error?: { issues: { message: string }[] } }) =>
  r.error?.issues.map((i) => i.message) ?? [];

describe('SchoolRequestDto (6.7)', () => {
  const valid = { schoolName: 'A', contactPerson: 'B', email: 'school@example.kz' };

  it('REQ-PUB-REQ-01 accepts required fields only', () => {
    expect(SchoolRequestDto.safeParse(valid).success).toBe(true);
  });

  it('REQ-PUB-REQ-01 rejects empty required fields and bad email', () => {
    const r = SchoolRequestDto.safeParse({ schoolName: '  ', contactPerson: '', email: 'nope' });
    expect(r.success).toBe(false);
    expect(messagesOf(r)).toEqual(expect.arrayContaining(['required', 'email']));
  });

  it('REQ-PUB-REQ-01 enforces max lengths and phone format', () => {
    expect(SchoolRequestDto.safeParse({ ...valid, schoolName: 'x'.repeat(201) }).success).toBe(false);
    expect(SchoolRequestDto.safeParse({ ...valid, phone: '+7 700 000 00 00' }).success).toBe(true);
    expect(SchoolRequestDto.safeParse({ ...valid, phone: '' }).success).toBe(true);
    expect(SchoolRequestDto.safeParse({ ...valid, phone: 'abc' }).success).toBe(false);
  });

  it('trims values', () => {
    const r = SchoolRequestDto.parse({ ...valid, schoolName: '  Школа  ' });
    expect(r.schoolName).toBe('Школа');
  });
});

describe('SupportTicketDto (6.7)', () => {
  const valid = { category: 'technical', subject: 'S', email: 'a@b.kz', description: 'D' };

  it('REQ-PUB-SUP-02 accepts a valid ticket with techContext', () => {
    const techContext = {
      route: '/ru/support',
      appVersion: '0.0.0',
      locale: 'ru',
      dataSaver: false,
      userAgent: 'UA',
    };
    expect(SupportTicketDto.safeParse({ ...valid, techContext }).success).toBe(true);
  });

  it('REQ-PUB-SUP-02 rejects unknown category', () => {
    expect(SupportTicketDto.safeParse({ ...valid, category: 'billing' }).success).toBe(false);
  });

  it('REQ-PUB-SUP-03 limits userAgent length in techContext', () => {
    const techContext = {
      route: '/',
      appVersion: '1',
      locale: 'ru',
      dataSaver: false,
      userAgent: 'x'.repeat(301),
    };
    expect(SupportTicketDto.safeParse({ ...valid, techContext }).success).toBe(false);
  });
});

describe('QuestionDto (6.7, BR-QZ-02)', () => {
  const base = { type: 'single_choice', difficulty: 'easy', translations: { kk: { text: 'Q' } } } as const;
  const opt = (isCorrect: boolean) => ({ translations: { ru: 'A' }, isCorrect });

  it('REQ-TCH-QZ-02 accepts two options with exactly one correct', () => {
    expect(QuestionDto.safeParse({ ...base, options: [opt(true), opt(false)] }).success).toBe(true);
  });

  it('AC-TCH-07 rejects two correct options', () => {
    const r = QuestionDto.safeParse({ ...base, options: [opt(true), opt(true)] });
    expect(messagesOf(r)).toContain('exactlyOneCorrect');
  });

  it('AC-TCH-07 rejects a single option', () => {
    const r = QuestionDto.safeParse({ ...base, options: [opt(true)] });
    expect(messagesOf(r)).toContain('min2');
  });

  it('REQ-TCH-QZ-03 requires at least one language', () => {
    const r = QuestionDto.safeParse({ ...base, translations: {}, options: [opt(true), opt(false)] });
    expect(messagesOf(r)).toContain('atLeastOneLanguage');
  });

  it('REQ-TCH-QZ-02 text_input requires textAnswer', () => {
    const r = QuestionDto.safeParse({ ...base, type: 'text_input' });
    expect(messagesOf(r)).toContain('required');
    expect(QuestionDto.safeParse({ ...base, type: 'text_input', textAnswer: 'аорта' }).success).toBe(true);
  });

  it('REQ-NFR-I18N-01 every validation message is an i18n key', () => {
    const results = [
      QuestionDto.safeParse({ ...base, translations: {}, options: [opt(true), opt(true)] }),
      QuestionDto.safeParse({ ...base, type: 'text_input' }),
      SchoolRequestDto.safeParse({ schoolName: '', contactPerson: '', email: 'x', phone: 'x' }),
    ];
    for (const message of results.flatMap(messagesOf)) {
      expect(Object.keys(ru.validation)).toContain(message);
    }
  });
});
