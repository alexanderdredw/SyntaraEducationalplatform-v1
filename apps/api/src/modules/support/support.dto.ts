import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { LOCALES, type Locale, RequestStatus, SupportCategory, TicketStatus } from '@syntara/shared';

/** Описание тел запросов для OpenAPI; проверка — схемами Zod из packages/shared (6.7). */

export class SchoolRequestBody {
  @ApiProperty({ maxLength: 200 }) schoolName: string;
  @ApiPropertyOptional({ maxLength: 120 }) region?: string;
  @ApiPropertyOptional({ maxLength: 120 }) city?: string;
  @ApiProperty({ maxLength: 200 }) contactPerson: string;
  @ApiPropertyOptional({ example: '+7 700 000 00 00' }) phone?: string;
  @ApiProperty({ format: 'email', maxLength: 254 }) email: string;
  @ApiPropertyOptional({ maxLength: 5000 }) message?: string;
}

class TechContextBody {
  @ApiProperty() route: string;
  @ApiProperty() appVersion: string;
  @ApiProperty({ enum: LOCALES }) locale: Locale;
  @ApiProperty() dataSaver: boolean;
  @ApiProperty({ maxLength: 300 }) userAgent: string;
}

export class SupportTicketBody {
  @ApiProperty({ enum: SupportCategory.options }) category: SupportCategory;
  @ApiProperty({ maxLength: 200 }) subject: string;
  @ApiPropertyOptional({ maxLength: 200 }) name?: string;
  @ApiProperty({ format: 'email', maxLength: 254 }) email: string;
  @ApiPropertyOptional() phone?: string;
  @ApiProperty({ maxLength: 10000 }) description: string;
  @ApiPropertyOptional({ type: TechContextBody }) techContext?: TechContextBody;
}

/** API-PUB-04/05: 201 { publicNumber, email }. */
export class FormCreatedResponse {
  @ApiProperty({ example: 'SR-261014-0042' }) publicNumber: string;
  @ApiProperty({ format: 'email' }) email: string;
}

export class StaffUserRef {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() displayName: string;
}

export class TicketListItem {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() publicNumber: string;
  @ApiProperty({ enum: SupportCategory.options }) category: SupportCategory;
  @ApiProperty() subject: string;
  @ApiProperty({ format: 'email' }) email: string;
  @ApiProperty({ enum: TicketStatus.options }) status: TicketStatus;
  @ApiProperty({ type: StaffUserRef, nullable: true }) assignee: StaffUserRef | null;
  @ApiProperty({ format: 'date-time' }) createdAt: string;
  @ApiProperty({ format: 'date-time', description: 'Срок первого ответа (PH-22), только для сотрудников' })
  dueAt: string;
}

export class TicketListResponse {
  @ApiProperty({ type: TicketListItem, isArray: true }) items: TicketListItem[];
  @ApiProperty({ type: String, nullable: true }) nextCursor: string | null;
}

export class TicketMessageDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ enum: ['in', 'out', 'note'] }) direction: 'in' | 'out' | 'note';
  @ApiProperty() body: string;
  @ApiProperty() isInternal: boolean;
  @ApiProperty({ type: StaffUserRef, nullable: true }) author: StaffUserRef | null;
  @ApiProperty({ format: 'date-time' }) createdAt: string;
  @ApiProperty({ format: 'date-time', nullable: true, type: String }) sentAt: string | null;
}

export class StatusHistoryDto {
  @ApiProperty({ enum: TicketStatus.options, nullable: true }) fromStatus: TicketStatus | null;
  @ApiProperty({ enum: TicketStatus.options }) toStatus: TicketStatus;
  @ApiProperty({ type: StaffUserRef, nullable: true }) changedBy: StaffUserRef | null;
  @ApiProperty({ format: 'date-time' }) changedAt: string;
}

export class ReplyTemplateDto {
  @ApiProperty() code: string;
  @ApiProperty({ description: 'Текст шаблона с подставленным номером обращения' }) body: string;
}

export class TicketDetail extends TicketListItem {
  @ApiProperty({ type: String, nullable: true }) name: string | null;
  @ApiProperty({ type: String, nullable: true }) phone: string | null;
  @ApiProperty() description: string;
  @ApiProperty({ type: TechContextBody, nullable: true }) techContext: TechContextBody | null;
  @ApiProperty({ enum: LOCALES, description: 'Язык писем клиенту' }) locale: Locale;
  @ApiProperty({ format: 'date-time', nullable: true, type: String }) resolvedAt: string | null;
  @ApiProperty({ format: 'date-time', nullable: true, type: String }) closedAt: string | null;
  @ApiProperty({ type: TicketMessageDto, isArray: true }) messages: TicketMessageDto[];
  @ApiProperty({ type: StatusHistoryDto, isArray: true }) history: StatusHistoryDto[];
  @ApiProperty({ type: ReplyTemplateDto, isArray: true }) templates: ReplyTemplateDto[];
  @ApiProperty({
    enum: TicketStatus.options,
    isArray: true,
    description: 'Допустимые для API-SUP-06 статусы',
  })
  allowedStatuses: TicketStatus[];
}

export class AssignBody {
  @ApiProperty({ format: 'uuid' }) assigneeId: string;
}

export class ReplyBody {
  @ApiProperty({ maxLength: 10000 }) body: string;
  @ApiPropertyOptional({ maxLength: 50 }) templateCode?: string;
}

export class NoteBody {
  @ApiProperty({ maxLength: 10000 }) body: string;
}

export class TicketStatusBody {
  @ApiProperty({ enum: TicketStatus.options }) to: TicketStatus;
}

export class RequestStatusBody {
  @ApiProperty({ enum: RequestStatus.options }) to: RequestStatus;
}

export class RequestListItem {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() publicNumber: string;
  @ApiProperty() schoolName: string;
  @ApiProperty() contactPerson: string;
  @ApiProperty({ format: 'email' }) email: string;
  @ApiProperty({ enum: RequestStatus.options }) status: RequestStatus;
  @ApiProperty({ type: StaffUserRef, nullable: true }) assignee: StaffUserRef | null;
  @ApiProperty({ format: 'date-time' }) createdAt: string;
}

export class RequestListResponse {
  @ApiProperty({ type: RequestListItem, isArray: true }) items: RequestListItem[];
  @ApiProperty({ type: String, nullable: true }) nextCursor: string | null;
}

export class RequestDetail extends RequestListItem {
  @ApiProperty({ type: String, nullable: true }) region: string | null;
  @ApiProperty({ type: String, nullable: true }) city: string | null;
  @ApiProperty({ type: String, nullable: true }) phone: string | null;
  @ApiProperty({ type: String, nullable: true }) message: string | null;
  @ApiProperty({ enum: RequestStatus.options, isArray: true }) allowedStatuses: RequestStatus[];
}

export class InboundEmailBody {
  @ApiProperty({ description: 'Токен из адреса Reply-To' }) token: string;
  @ApiProperty({ format: 'email' }) from: string;
  @ApiProperty({ maxLength: 10000 }) text: string;
}
