// Наблюдаемость web (REQ-NFR-OBS-01): Sentry на сервере включается только при заданном SENTRY_DSN.
export async function register(): Promise<void> {
  if (!process.env.SENTRY_DSN) return;
  const Sentry = await import('@sentry/nextjs');
  Sentry.init({ dsn: process.env.SENTRY_DSN, environment: process.env.NODE_ENV, sendDefaultPii: false });
}

export async function onRequestError(...args: unknown[]): Promise<void> {
  if (!process.env.SENTRY_DSN) return;
  const Sentry = await import('@sentry/nextjs');
  (Sentry.captureRequestError as (...a: unknown[]) => void)(...args);
}
