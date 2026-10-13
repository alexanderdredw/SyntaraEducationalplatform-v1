import createMiddleware from 'next-intl/middleware';
import { NextRequest } from 'next/server';
import { routing } from './i18n/routing';
import { buildCsp } from './lib/csp';

const handleI18n = createMiddleware(routing);

/**
 * Перенаправление на префикс локали (REQ-GEN-PREF-01): язык берётся из URL, затем из cookie `locale`,
 * иначе — `ru` (по умолчанию в user_preferences, 5.3). Определение по Accept-Language не используется
 * (решение владельца). Проверки доступа по ролям — итерации 4 и 6; данные защищает только API (AG-04).
 */
export default function middleware(request: NextRequest) {
  const nonce = btoa(crypto.randomUUID());
  const csp = buildCsp(nonce, process.env.NODE_ENV !== 'production');

  const headers = new Headers(request.headers);
  headers.delete('accept-language');
  headers.set('x-nonce', nonce);
  headers.set('content-security-policy', csp);

  const response = handleI18n(new NextRequest(request.url, { headers, method: request.method }));
  response.headers.set('content-security-policy', csp);
  return response;
}

export const config = {
  matcher: ['/((?!api|_next|_vercel|.*\\..*).*)'],
};
