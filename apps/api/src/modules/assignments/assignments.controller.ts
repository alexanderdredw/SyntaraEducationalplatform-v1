import { Body, Controller, Get, HttpCode, Param, Post, Req } from '@nestjs/common';
import {
  ApiBody,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { AssignmentCreateDto } from '@syntara/shared';
import { type Dto } from '../../common/dto';
import { resolveLocale } from '../../common/locale';
import { UuidParamPipe } from '../../common/uuid-param.pipe';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { Roles } from '../auth/auth.guards';
import { type AuthRequest } from '../auth/auth.types';
import {
  AssignmentBody,
  AssignmentOptionsDto,
  CreatedDto,
  ReviewItemDto,
  StudentAssignmentDto,
  TeacherAssignmentDto,
} from './assignments.dto';
import { AssignmentsService } from './assignments.service';

const locale = (req: AuthRequest) => resolveLocale(req.headers['accept-language']);

/** Задания учителя (6.4, 8.3.6). Чужой класс или предмет → 404 (BR-ACL-01/02). */
@ApiTags('teacher')
@Controller('teacher')
@Roles('teacher')
export class TeacherAssignmentsController {
  constructor(private readonly assignments: AssignmentsService) {}

  /** API-T-22 */
  @Post('assignments')
  @HttpCode(201)
  @ApiBody({ type: AssignmentBody })
  @ApiCreatedResponse({ type: CreatedDto })
  @ApiNotFoundResponse({ description: 'Класс или предмет не найден' })
  @ApiUnprocessableEntityResponse({
    description: 'subjectNotGranted / topicNotInSubject / topicNotPublished (BR-ASG-01)',
  })
  create(
    @Body(new ZodValidationPipe(AssignmentCreateDto)) dto: Dto<typeof AssignmentCreateDto>,
    @Req() req: AuthRequest,
  ): Promise<CreatedDto> {
    return this.assignments.create(req.user!.id, dto);
  }

  /** API-T-23 */
  @Get('assignments')
  @ApiOkResponse({ type: TeacherAssignmentDto, isArray: true })
  list(@Req() req: AuthRequest): Promise<TeacherAssignmentDto[]> {
    return this.assignments.teacherList(req.user!.id, locale(req));
  }

  /** API-T-24: ручной проверки нет (PH-29) — очередь пуста. */
  @Get('review-queue')
  @ApiOkResponse({ type: ReviewItemDto, isArray: true })
  reviewQueue(): ReviewItemDto[] {
    return [];
  }

  /** API-T-28: предметы и опубликованные темы, которые можно назначить классу (BR-ASG-01/02). */
  @Get('classes/:id/assignment-options')
  @ApiOkResponse({ type: AssignmentOptionsDto })
  @ApiNotFoundResponse()
  options(
    @Param('id', new UuidParamPipe()) id: string,
    @Req() req: AuthRequest,
  ): Promise<AssignmentOptionsDto> {
    return this.assignments.options(req.user!.id, id, locale(req));
  }
}

/** Мои задания ученика (6.5, 8.4.8, PH-33). */
@ApiTags('student')
@Controller('student')
@Roles('student')
export class StudentAssignmentsController {
  constructor(private readonly assignments: AssignmentsService) {}

  /** API-S-10 */
  @Get('assignments')
  @ApiOkResponse({ type: StudentAssignmentDto, isArray: true })
  list(@Req() req: AuthRequest): Promise<StudentAssignmentDto[]> {
    return this.assignments.studentList(req.user!.id, locale(req));
  }
}
