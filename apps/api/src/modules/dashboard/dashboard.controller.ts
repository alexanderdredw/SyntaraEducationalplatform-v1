import { Controller, Get, Query, Req } from '@nestjs/common';
import { ApiOkResponse, ApiQuery, ApiTags } from '@nestjs/swagger';
import { ActivityQuery } from '@syntara/shared';
import { type Dto } from '../../common/dto';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { ActivityService } from './activity.service';
import { resolveLocale } from '../../common/locale';
import { Roles } from '../auth/auth.guards';
import { ACTIVE_ROLE_COOKIE, type AuthRequest } from '../auth/auth.types';
import { profileRole } from '../profiles/profile.service';
import { ActivityDto, DashboardDto } from './dashboard.dto';
import { DashboardService } from './dashboard.service';

/** «Личный кабинет», вкладка «Обзор» (SPEC 8.7, REQ-PRF-02…04). */
@ApiTags('auth')
@Controller('me')
@Roles('student', 'teacher')
export class DashboardController {
  constructor(
    private readonly dashboard: DashboardService,
    private readonly activityService: ActivityService,
  ) {}

  /** API-ME-15 (REQ-PRF-21): календарь активности — только ученик, только свои данные. */
  @Get('activity')
  @Roles('student')
  @ApiQuery({
    name: 'weeks',
    required: false,
    schema: { type: 'integer', minimum: 1, maximum: 26, default: 12 },
  })
  @ApiOkResponse({ type: ActivityDto })
  activity(
    @Query(new ZodValidationPipe(ActivityQuery)) query: Dto<typeof ActivityQuery>,
    @Req() req: AuthRequest,
  ): Promise<ActivityDto> {
    return this.activityService.activity(req.user!.id, query.weeks);
  }

  /** API-ME-12: только чтение; ответ — по активной роли (API-ME-03). */
  @Get('dashboard')
  @ApiOkResponse({ type: DashboardDto })
  get(@Req() req: AuthRequest): Promise<DashboardDto> {
    const role = profileRole(
      req.user!.roles,
      (req.cookies as Record<string, string> | undefined)?.[ACTIVE_ROLE_COOKIE],
    );
    return this.dashboard.dashboard(req.user!.id, role, resolveLocale(req.headers['accept-language']));
  }
}
