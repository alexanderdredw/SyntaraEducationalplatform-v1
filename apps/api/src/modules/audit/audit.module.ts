import { Module } from '@nestjs/common';
import { AuditService } from './audit.service';

/** Модуль «audit» (раздел 2.2 SPEC): журнал аудита REQ-NFR-SEC-05. */
@Module({
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
