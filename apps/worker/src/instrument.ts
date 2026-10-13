// Наблюдаемость (REQ-NFR-OBS-01): включается только при заданных переменных окружения.
import * as Sentry from '@sentry/node';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV,
    sendDefaultPii: false,
    skipOpenTelemetrySetup: Boolean(process.env.OTEL_EXPORTER_OTLP_ENDPOINT),
  });
}

if (process.env.OTEL_EXPORTER_OTLP_ENDPOINT) {
  const sdk = new NodeSDK({
    serviceName: 'syntara-worker',
    traceExporter: new OTLPTraceExporter({ url: `${process.env.OTEL_EXPORTER_OTLP_ENDPOINT}/v1/traces` }),
    instrumentations: [
      getNodeAutoInstrumentations({ '@opentelemetry/instrumentation-fs': { enabled: false } }),
    ],
  });
  sdk.start();
  process.once('SIGTERM', () => void sdk.shutdown());
}
