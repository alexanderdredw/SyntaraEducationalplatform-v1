import { storageOrigin } from './lib/csp';

// Наблюдаемость web (REQ-NFR-OBS-01): Sentry на сервере включается только при заданном SENTRY_DSN.
export async function register(): Promise<void> {
  // 7.8: без адреса хранилища CSP не пускает браузер в S3 — загрузка файлов и показ картинок не работают.
  // Сообщаем при старте, а не молча в консоли браузера.
  if (
    !storageOrigin({
      S3_PUBLIC_ENDPOINT: process.env.S3_PUBLIC_ENDPOINT,
      S3_ENDPOINT: process.env.S3_ENDPOINT,
    })
  )
    console.warn(
      '[web] S3_PUBLIC_ENDPOINT / S3_ENDPOINT не заданы: CSP (connect-src, img-src) не разрешит хранилище — загрузка файлов не будет работать',
    );
  if (!process.env.SENTRY_DSN) return;
  const Sentry = await import('@sentry/nextjs');
  Sentry.init({ dsn: process.env.SENTRY_DSN, environment: process.env.NODE_ENV, sendDefaultPii: false });
}

export async function onRequestError(...args: unknown[]): Promise<void> {
  if (!process.env.SENTRY_DSN) return;
  const Sentry = await import('@sentry/nextjs');
  (Sentry.captureRequestError as (...a: unknown[]) => void)(...args);
}
