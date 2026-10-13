import { Controller, Get, Header } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { collectDefaultMetrics, Registry } from 'prom-client';

export const metricsRegistry = new Registry();
collectDefaultMetrics({ register: metricsRegistry });

/**
 * Метрики Prometheus (REQ-NFR-OBS-01). Служебный эндпоинт: снаружи закрывается на nginx.
 * Бизнес-метрики (сохранение обращений, очередь писем, ошибки ИИ) добавляются в итерациях 4–5.
 */
@ApiExcludeController()
@Controller('metrics')
export class MetricsController {
  @Get()
  @Header('Content-Type', metricsRegistry.contentType)
  metrics(): Promise<string> {
    return metricsRegistry.metrics();
  }
}
