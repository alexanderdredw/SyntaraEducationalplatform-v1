import createMiddleware from 'next-intl/middleware';
import { NextRequest, NextResponse } from 'next/server';
import { routing } from './i18n/routing';
import { buildCsp, storageOrigin } from './lib/csp';

const handleI18n = createMiddleware(routing);

/** Маршруты, требующие входа (раздел 4): без cookie сессии — на /auth/login с возвратом. */
const PROTECTED = ['/staff', '/teacher', '/learn', '/account'];

function withoutLocale(pathname: string): { locale: string | null; path: string } {
  const [, first, ...rest] = pathname.split('/');
  if (first && (routing.locales as readonly string[]).includes(first)) {
    return { locale: first, path: `/${rest.join('/')}` };
  }
  return { locale: null, path: pathname };
}

/**
 * Перенаправление на префикс локали (REQ-GEN-PREF-01): язык берётся из URL, затем из cookie `locale`,
 * иначе — `ru` (по умолчанию в user_preferences, 5.3). Определение по Accept-Language не используется
 * (решение владельца). Для закрытых разделов middleware только перенаправляет; права и данные
 * проверяет api (AG-04).
 */
export default function middleware(request: NextRequest) {
  const { locale, path } = withoutLocale(request.nextUrl.pathname);
  if (
    locale &&
    PROTECTED.some((p) => path === p || path.startsWith(`${p}/`)) &&
    !request.cookies.has('sid')
  ) {
    const url = new URL(`/${locale}/auth/login`, request.url);
    url.searchParams.set('returnTo', path + request.nextUrl.search);
    return NextResponse.redirect(url);
  }

  const nonce = btoa(crypto.randomUUID());
  const csp = buildCsp(
    nonce,
    process.env.NODE_ENV !== 'production',
    storageOrigin({
      S3_PUBLIC_ENDPOINT: process.env.S3_PUBLIC_ENDPOINT,
      S3_ENDPOINT: process.env.S3_ENDPOINT,
    }),
  );

  const headers = new Headers(request.headers);
  headers.delete('accept-language');
  headers.set('x-nonce', nonce);
  headers.set('x-pathname', path + request.nextUrl.search);
  headers.set('content-security-policy', csp);

  const response = handleI18n(new NextRequest(request.url, { headers, method: request.method }));
  response.headers.set('content-security-policy', csp);
  return response;
}

export const config = {
  matcher: ['/((?!api|_next|_vercel|.*\\..*).*)'],
};
