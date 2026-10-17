import { Controller, Get, Param, Query, Req } from '@nestjs/common';
import {
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiQuery,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { z } from 'zod';
import { PROGRESS_PERIODS, ProgressPeriod } from '@syntara/shared';
import { resolveLocale } from '../../common/locale';
import { UuidParamPipe } from '../../common/uuid-param.pipe';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { Roles } from '../auth/auth.guards';
import { type AuthRequest } from '../auth/auth.types';
import { AchievementsDto, ClassAnalyticsDto, MasteryMapDto, ProgressDto } from './results.dto';
import { ResultsService } from './results.service';

const locale = (req: AuthRequest) => resolveLocale(req.headers['accept-language']);

/** Аналитика класса (6.4, 8.3.7). Чужой класс → 404 (BR-ACL-02). */
@ApiTags('teacher')
@Controller('teacher/classes')
@Roles('teacher')
export class TeacherAnalyticsController {
  constructor(private readonly results: ResultsService) {}

  /** API-T-25 */
  @Get(':id/analytics')
  @ApiOkResponse({ type: ClassAnalyticsDto })
  @ApiNotFoundResponse()
  analytics(
    @Param('id', new UuidParamPipe()) id: string,
    @Req() req: AuthRequest,
  ): Promise<ClassAnalyticsDto> {
    return this.results.classAnalytics(req.user!.id, id, locale(req));
  }

  /** API-T-29: «Карта освоения»; без subjectId — первый доступный предмет. */
  @Get(':id/mastery')
  @ApiQuery({ name: 'subjectId', required: false, type: String })
  @ApiOkResponse({ type: MasteryMapDto })
  @ApiNotFoundResponse({ description: 'Класс не свой или предмет нельзя показать этому классу' })
  mastery(
    @Param('id', new UuidParamPipe()) id: string,
    @Query('subjectId', new ZodValidationPipe(z.uuid().optional())) subjectId: string | undefined,
    @Req() req: AuthRequest,
  ): Promise<MasteryMapDto> {
    return this.results.masteryMap(req.user!.id, id, subjectId, locale(req));
  }
}

/** Показатели и достижения ученика (6.5, 8.4.6–8.4.7) — только свои (BR-ACL-03). */
@ApiTags('student')
@Controller('student')
@Roles('student')
export class StudentResultsController {
  constructor(private readonly results: ResultsService) {}

  /** API-S-14 */
  @Get('progress')
  @ApiQuery({ name: 'period', enum: PROGRESS_PERIODS, required: false })
  @ApiOkResponse({ type: ProgressDto })
  @ApiUnprocessableEntityResponse({ description: 'periodUnavailable — четверти не заданы (Q-23)' })
  progress(
    @Query('period', new ZodValidationPipe(ProgressPeriod.default('30d'))) period: ProgressPeriod,
    @Req() req: AuthRequest,
  ): Promise<ProgressDto> {
    return this.results.progress(req.user!.id, period, locale(req));
  }

  /** API-S-15 */
  @Get('achievements')
  @ApiOkResponse({ type: AchievementsDto })
  achievements(@Req() req: AuthRequest): Promise<AchievementsDto> {
    return this.results.achievements(req.user!.id, locale(req));
  }
}
