import createMiddleware from 'next-intl/middleware';
import { NextRequest } from 'next/server';
import { routing } from './i18n/routing';

const handleI18n = createMiddleware(routing);

/**
 * Перенаправление на префикс локали (REQ-GEN-PREF-01): язык берётся из URL, затем из cookie `locale`,
 * иначе — `ru` (по умолчанию в user_preferences, 5.3). Определение по Accept-Language в SPEC не описано,
 * поэтому заголовок не учитывается (AG-01).
 * Проверки доступа по ролям — итерации 4 и 6; данные защищает только API (AG-04).
 */
export default function middleware(request: NextRequest) {
  const headers = new Headers(request.headers);
  headers.delete('accept-language');
  return handleI18n(new NextRequest(request.url, { headers, method: request.method }));
}

export const config = {
  matcher: ['/((?!api|_next|_vercel|.*\\..*).*)'],
};
