import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { ProfilesModule } from '../profiles/profiles.module';
import { FormsController } from './forms.controller';
import { FormsService } from './forms.service';
import { InboundController } from './inbound.controller';
import { InboundService } from './inbound.service';
import { RequestsService } from './requests.service';
import { StaffRequestsController } from './staff-requests.controller';
import { StaffTicketsController } from './staff-tickets.controller';
import { TicketsService } from './tickets.service';

/**
 * Модуль «support» (раздел 2.2 SPEC): публичные формы (API-PUB-04/05), служебные очереди (API-SUP-01..07),
 * входящие письма (API-SUP-08).
 */
@Module({
  imports: [AuditModule, ProfilesModule],
  controllers: [FormsController, StaffTicketsController, StaffRequestsController, InboundController],
  providers: [FormsService, TicketsService, RequestsService, InboundService],
})
export class SupportModule {}
