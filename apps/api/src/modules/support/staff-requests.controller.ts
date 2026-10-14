import { Body, Controller, Get, HttpCode, Param, Post, Query, Req } from '@nestjs/common';
import {
  ApiBody,
  ApiConflictResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { AssignDto, RequestListQuery, RequestStatus, RequestStatusChangeDto } from '@syntara/shared';
import { UuidParamPipe } from '../../common/uuid-param.pipe';
import { type Dto } from '../../common/dto';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { Roles } from '../auth/auth.guards';
import { type AuthRequest } from '../auth/auth.types';
import { RequestsService } from './requests.service';
import { AssignBody, RequestDetail, RequestListResponse, RequestStatusBody } from './support.dto';

const uuid = new UuidParamPipe();

/** Очередь школьных заявок (API-SUP-07): только onboarding_agent (матрица 1.2, BR-ACL-04). */
@ApiTags('staff')
@Controller('staff/requests')
@Roles('onboarding_agent')
export class StaffRequestsController {
  constructor(private readonly requests: RequestsService) {}

  @Get()
  @ApiQuery({ name: 'status', required: false, enum: RequestStatus.options })
  @ApiQuery({ name: 'assigneeId', required: false, description: 'UUID или none' })
  @ApiQuery({ name: 'q', required: false, description: 'Номер заявки или email' })
  @ApiQuery({ name: 'cursor', required: false })
  @ApiQuery({ name: 'limit', required: false, schema: { type: 'integer', minimum: 1, maximum: 100 } })
  @ApiOkResponse({ type: RequestListResponse })
  list(
    @Query(new ZodValidationPipe(RequestListQuery)) query: Dto<typeof RequestListQuery>,
  ): Promise<RequestListResponse> {
    return this.requests.list(query);
  }

  @Get(':id')
  @ApiOkResponse({ type: RequestDetail })
  @ApiNotFoundResponse()
  get(@Param('id', uuid) id: string): Promise<RequestDetail> {
    return this.requests.get(id);
  }

  @Post(':id/assign')
  @HttpCode(200)
  @ApiBody({ type: AssignBody })
  @ApiOkResponse({ type: RequestDetail })
  assign(
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(AssignDto)) dto: Dto<typeof AssignDto>,
    @Req() req: AuthRequest,
  ): Promise<RequestDetail> {
    return this.requests.assign(id, dto.assigneeId, req.user!.id);
  }

  /** Смена статуса по SM-REQUEST; недопустимый переход — 409 INVALID_TRANSITION. */
  @Post(':id/status')
  @HttpCode(200)
  @ApiBody({ type: RequestStatusBody })
  @ApiOkResponse({ type: RequestDetail })
  @ApiConflictResponse({ description: 'INVALID_TRANSITION' })
  status(
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(RequestStatusChangeDto)) dto: Dto<typeof RequestStatusChangeDto>,
    @Req() req: AuthRequest,
  ): Promise<RequestDetail> {
    return this.requests.setStatus(id, dto.to, req.user!.id);
  }
}
