import { Controller, Get, Req } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { resolveLocale } from '../../common/locale';
import { Roles } from '../auth/auth.guards';
import { ACTIVE_ROLE_COOKIE, type AuthRequest } from '../auth/auth.types';
import { profileRole } from '../profiles/profile.service';
import { DashboardDto } from './dashboard.dto';
import { DashboardService } from './dashboard.service';

/** «Личный кабинет», вкладка «Обзор» (SPEC 8.7, REQ-PRF-02…04). */
@ApiTags('auth')
@Controller('me')
@Roles('student', 'teacher')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

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
