import type { NextConfig } from 'next';
import createBundleAnalyzer from '@next/bundle-analyzer';
import createNextIntlPlugin from 'next-intl/plugin';
import pkg from './package.json' with { type: 'json' };

const withNextIntl = createNextIntlPlugin('./i18n/request.ts');
// OPT-05 (О4-7): карта бандла — `ANALYZE=1 pnpm --filter @syntara/web build`, отчёты в <distDir>/analyze/.
const withBundleAnalyzer = createBundleAnalyzer({
  enabled: process.env.ANALYZE === '1',
  openAnalyzer: false,
});

const API_INTERNAL_URL = process.env.API_INTERNAL_URL ?? 'http://localhost:3001';

const nextConfig: NextConfig = {
  // Отдельный каталог сборки (например, для e2e при запущенном `pnpm dev`, который пишет в .next).
  distDir: process.env.NEXT_DIST_DIR || '.next',
  poweredByHeader: false,
  reactStrictMode: true,
  // REQ-PUB-SUP-03: версия приложения в techContext обращения.
  env: { NEXT_PUBLIC_APP_VERSION: pkg.version },
  transpilePackages: ['@syntara/ui'],
  // REQ-NFR-PERF-01: импорт только используемых компонентов из «бочковых» модулей.
  experimental: { optimizePackageImports: ['@syntara/ui', 'radix-ui', 'lucide-react'] },
  // REQ-NFR-SEC-01: заголовки безопасности; CSP с nonce выставляет middleware.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
  // В продуктиве /api обслуживает nginx; при локальном запуске web проксирует на api (тот же origin).
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${API_INTERNAL_URL}/api/:path*` }];
  },
};

export default withBundleAnalyzer(withNextIntl(nextConfig));
