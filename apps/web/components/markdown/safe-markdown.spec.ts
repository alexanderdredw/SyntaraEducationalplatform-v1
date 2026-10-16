import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SafeMarkdown, safeHref } from './safe-markdown';

const render = (md: string) => renderToStaticMarkup(createElement(SafeMarkdown, null, md));

describe('SafeMarkdown', () => {
  it('REQ-TCH-TOP-03 renders headings, lists, bold and italic', () => {
    const html = render('## Камеры сердца\n\n- **предсердия**\n- *желудочки*');
    expect(html).toContain('<h2>Камеры сердца</h2>');
    expect(html).toContain('<li><strong>предсердия</strong></li>');
    expect(html).toContain('<li><em>желудочки</em></li>');
  });

  it.each([
    '<script>alert(1)</script>',
    '<img src=x onerror="alert(1)">',
    '[клик](javascript:alert(1))',
    '<a href="javascript:alert(1)">x</a>',
    '<iframe src="https://evil.example"></iframe>',
    '![x](javascript:alert(1))',
    '[data](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)',
  ])('REQ-NFR-SEC-06 XSS payload is neutralised: %s', (payload) => {
    const html = render(`Текст\n\n${payload}`);
    expect(html).not.toMatch(/<script|onerror|javascript:|<iframe|data:text/i);
  });

  it('REQ-NFR-SEC-06 only http(s) and internal links are kept', () => {
    expect(safeHref('https://example.org')).toBe('https://example.org');
    expect(safeHref('/learn/subjects')).toBe('/learn/subjects');
    expect(safeHref('//evil.example')).toBeNull();
    expect(safeHref('javascript:alert(1)')).toBeNull();
    const html = render('[сайт](https://example.org)');
    expect(html).toContain('rel="noopener noreferrer nofollow"');
  });
});
