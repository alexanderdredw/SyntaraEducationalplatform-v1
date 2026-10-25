import { Body, Controller, Get, HttpCode, Param, Post, Query, Req } from '@nestjs/common';
import {
  ApiBody,
  ApiConflictResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import {
  AssignDto,
  SupportCategory,
  TicketListQuery,
  TicketNoteDto,
  TicketReplyDto,
  TicketStatus,
  TicketStatusChangeDto,
} from '@syntara/shared';
import { UuidParamPipe } from '../../common/uuid-param.pipe';
import { type Dto } from '../../common/dto';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { Roles } from '../auth/auth.guards';
import { type AuthRequest } from '../auth/auth.types';
import {
  AssignBody,
  NoteBody,
  ReplyBody,
  TicketDetail,
  TicketListResponse,
  TicketStatusBody,
} from './support.dto';
import { TicketsService } from './tickets.service';

const uuid = new UuidParamPipe();

/** Очередь обращений (6.6): только support_agent (матрица 1.2, BR-ACL-04). */
@ApiTags('staff')
@Controller('staff/tickets')
@Roles('support_agent')
export class StaffTicketsController {
  constructor(private readonly tickets: TicketsService) {}

  /** API-SUP-01 */
  @Get()
  @ApiQuery({ name: 'status', required: false, enum: TicketStatus.options })
  @ApiQuery({ name: 'assigneeId', required: false, description: 'UUID или none' })
  @ApiQuery({ name: 'category', required: false, enum: SupportCategory.options })
  @ApiQuery({ name: 'dueBefore', required: false, description: 'ISO 8601: срок первого ответа не позже' })
  @ApiQuery({ name: 'q', required: false, description: 'Номер обращения или email' })
  @ApiQuery({ name: 'cursor', required: false })
  @ApiQuery({ name: 'limit', required: false, schema: { type: 'integer', minimum: 1, maximum: 100 } })
  @ApiOkResponse({ type: TicketListResponse })
  list(
    @Query(new ZodValidationPipe(TicketListQuery)) query: Dto<typeof TicketListQuery>,
  ): Promise<TicketListResponse> {
    return this.tickets.list(query);
  }

  /** API-SUP-02 */
  @Get(':id')
  @ApiOkResponse({ type: TicketDetail })
  @ApiNotFoundResponse()
  get(@Param('id', uuid) id: string): Promise<TicketDetail> {
    return this.tickets.get(id);
  }

  /** API-SUP-09 (BR-PRF-06): сбросить картинку-аватар пользователя обращения на инициалы. */
  @Post(':id/user-avatar/reset')
  @HttpCode(200)
  @ApiOkResponse({ type: TicketDetail })
  @ApiNotFoundResponse({ description: 'У обращения нет пользователя или у пользователя нет картинки' })
  resetUserAvatar(@Param('id', uuid) id: string, @Req() req: AuthRequest): Promise<TicketDetail> {
    return this.tickets.resetUserAvatar(id, req.user!.id);
  }

  /** API-SUP-03 */
  @Post(':id/assign')
  @HttpCode(200)
  @ApiBody({ type: AssignBody })
  @ApiOkResponse({ type: TicketDetail })
  assign(
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(AssignDto)) dto: Dto<typeof AssignDto>,
    @Req() req: AuthRequest,
  ): Promise<TicketDetail> {
    return this.tickets.assign(id, dto.assigneeId, req.user!.id);
  }

  /** API-SUP-04 */
  @Post(':id/reply')
  @HttpCode(200)
  @ApiBody({ type: ReplyBody })
  @ApiOkResponse({ type: TicketDetail })
  reply(
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(TicketReplyDto)) dto: Dto<typeof TicketReplyDto>,
    @Req() req: AuthRequest,
  ): Promise<TicketDetail> {
    return this.tickets.reply(id, dto.body, dto.templateCode || undefined, req.user!.id);
  }

  /** API-SUP-05 */
  @Post(':id/notes')
  @HttpCode(200)
  @ApiBody({ type: NoteBody })
  @ApiOkResponse({ type: TicketDetail })
  note(
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(TicketNoteDto)) dto: Dto<typeof TicketNoteDto>,
    @Req() req: AuthRequest,
  ): Promise<TicketDetail> {
    return this.tickets.note(id, dto.body, req.user!.id);
  }

  /** API-SUP-06 */
  @Post(':id/status')
  @HttpCode(200)
  @ApiBody({ type: TicketStatusBody })
  @ApiOkResponse({ type: TicketDetail })
  @ApiConflictResponse({ description: 'INVALID_TRANSITION' })
  status(
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(TicketStatusChangeDto)) dto: Dto<typeof TicketStatusChangeDto>,
    @Req() req: AuthRequest,
  ): Promise<TicketDetail> {
    return this.tickets.setStatus(id, dto.to, req.user!.id);
  }
}
