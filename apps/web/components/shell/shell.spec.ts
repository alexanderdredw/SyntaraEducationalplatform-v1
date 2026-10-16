import { describe, expect, it } from 'vitest';
import { buildCsp, storageOrigin } from '../../lib/csp';
import { helpKey, isActive, NAV_ITEMS } from './nav-items';

describe('shell helpers', () => {
  it('REQ-GEN-SHELL-01 menu has the 6 sections in order; «Помощь» leads to /support', () => {
    expect(NAV_ITEMS.map((i) => i.key)).toEqual(['home', 'subjects', 'about', 'ai', 'schools', 'help']);
    expect(NAV_ITEMS.find((i) => i.key === 'help')?.href).toBe('/support');
  });

  it('AC-GEN-01 active item: exact match for home, prefix match for sections', () => {
    expect(isActive('/', '/')).toBe(true);
    expect(isActive('/about', '/')).toBe(false);
    expect(isActive('/schools/request', '/schools')).toBe(true);
    expect(isActive('/schoolsx', '/schools')).toBe(false);
  });

  it('REQ-GEN-SHELL-04 help text key per page', () => {
    expect(helpKey('/')).toBe('home');
    expect(helpKey('/schools/request')).toBe('schoolsRequest');
    expect(helpKey('/schools')).toBe('schools');
    expect(helpKey('/privacy')).toBe('legal');
    expect(helpKey('/join')).toBe('stub');
  });

  it('REQ-NFR-SEC-01 CSP: nonce scripts, no framing, no eval in production', () => {
    const prod = buildCsp('abc', false);
    expect(prod).toContain("script-src 'self' 'nonce-abc' 'strict-dynamic'");
    expect(prod).toContain("frame-ancestors 'none'");
    expect(prod).toContain("object-src 'none'");
    expect(prod).not.toContain('unsafe-eval');
    expect(buildCsp('abc', true)).toContain("'unsafe-eval'");
  });

  it('REQ-NFR-SEC-01, BR-FILE-04 CSP allows only the storage origin for uploads and file links', () => {
    const origin = storageOrigin({ S3_ENDPOINT: 'http://localhost:9000/' });
    expect(origin).toBe('http://localhost:9000');
    expect(
      storageOrigin({ S3_PUBLIC_ENDPOINT: 'https://files.example.kz/x', S3_ENDPOINT: 'http://minio:9000' }),
    ).toBe('https://files.example.kz');
    expect(storageOrigin({ S3_ENDPOINT: 'not a url' })).toBeUndefined();
    const csp = buildCsp('abc', false, origin);
    expect(csp).toContain("connect-src 'self' http://localhost:9000");
    // BR-FILE-06: внешних картинок нет — обложка по ссылке скачивается сервером в хранилище.
    expect(csp).toContain("img-src 'self' data: blob: http://localhost:9000;");
    expect(buildCsp('abc', false)).toContain("connect-src 'self';");
  });
});
