import { describe, expect, it } from 'vitest';
import {
  isAllowedLink,
  parseSse,
  PublicAssistantDto,
  redactPersonalData,
  sanitizeAssistantText,
  serializeSse,
  StreamingSanitizer,
} from './ai';

const ATLAS = ['https://atlas.example.kz/anatomy'];

describe('BR-AI-07 link sanitizer', () => {
  it('BR-AI-07 keeps internal routes of section 4 and atlas URLs', () => {
    for (const href of [
      '/',
      '/subjects',
      '/support',
      '/ru/schools/request',
      '/kk/ai',
      '/learn/topics/abc-1',
      ATLAS[0]!,
    ]) {
      expect(isAllowedLink(href, ATLAS), href).toBe(true);
    }
  });

  it('BR-AI-07 rejects external, protocol-relative, javascript and unknown links', () => {
    for (const href of [
      'https://evil.example',
      '//evil.example',
      'javascript:alert(1)',
      '/admin',
      '/support/../x',
      'mailto:a@b.kz',
    ]) {
      expect(isAllowedLink(href, ATLAS), href).toBe(false);
    }
  });

  it('REQ-NFR-SEC-06 removes HTML and external links, keeps the link text', () => {
    const out = sanitizeAssistantText(
      'Смотри [предметы](/subjects), [сайт](https://evil.example) и https://evil.example/x <script>alert(1)</script>!',
      ATLAS,
    );
    expect(out).toBe('Смотри [предметы](/subjects), сайт и  alert(1)!');
  });

  it('BR-AI-07 streaming: a link split across chunks is sanitized as a whole', () => {
    const s = new StreamingSanitizer(ATLAS);
    const chunks = [
      'Открой [сай',
      'т](https://ev',
      'il.example) и [поддержку](/sup',
      'port). Готово',
      ' https://evil',
      '.example конец',
    ];
    const out = chunks.map((c) => s.push(c)).join('') + s.flush();
    expect(out).toBe('Открой сайт и [поддержку](/support). Готово  конец');
  });
});

describe('BR-AI-02 prompt data', () => {
  it('BR-AI-02 removes emails and phone numbers', () => {
    expect(redactPersonalData('пишите на aigerim.k@mail.kz или +7 (701) 123-45-67, класс 7')).toBe(
      'пишите на [email] или [phone], класс 7',
    );
  });
});

describe('API-PUB-06 SSE and DTO', () => {
  it('API-PUB-06 serializes and parses delta, done and error events', () => {
    const wire =
      serializeSse({ event: 'delta', data: { text: 'При' } }) +
      serializeSse({ event: 'delta', data: { text: 'вет\n!' } }) +
      serializeSse({ event: 'done', data: {} });
    const { events, rest } = parseSse(wire + 'event: delta\ndata: {"te');
    expect(events).toEqual([
      { event: 'delta', data: { text: 'При' } },
      { event: 'delta', data: { text: 'вет\n!' } },
      { event: 'done', data: {} },
    ]);
    expect(rest).toBe('event: delta\ndata: {"te');
  });

  it('API-PUB-06 message ≤ 2000 characters, history ≤ 20 messages', () => {
    expect(PublicAssistantDto.safeParse({ message: 'x'.repeat(2000) }).success).toBe(true);
    expect(PublicAssistantDto.safeParse({ message: 'x'.repeat(2001) }).success).toBe(false);
    expect(PublicAssistantDto.safeParse({ message: '   ' }).success).toBe(false);
    const history = Array.from({ length: 21 }, () => ({ role: 'user', content: 'a' }));
    expect(PublicAssistantDto.safeParse({ message: 'a', history }).success).toBe(false);
  });
});
