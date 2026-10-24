import { Body, Controller, Get, HttpCode, Post, Req } from '@nestjs/common';
import { ApiBody, ApiNoContentResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { NavSeenDto } from '@syntara/shared';
import { type Dto } from '../../common/dto';
import { resolveLocale } from '../../common/locale';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { Roles } from '../auth/auth.guards';
import { type AuthRequest } from '../auth/auth.types';
import { ClassOverviewDto, NavBadgesDto, NavSeenBody } from './nav.dto';
import { NavService } from './nav.service';

const locale = (req: AuthRequest) => resolveLocale(req.headers['accept-language']);

/** «Мой класс» и счётчики панели ученика (docs/NAV_TZ_2.md, REQ-NAV-11, REQ-NAV-14). */
@ApiTags('student')
@Controller('student')
@Roles('student')
export class StudentNavController {
  constructor(private readonly nav: NavService) {}

  /**
   * API-S-19. Путь `class/overview`: `GET /api/student/class` занят API-S-02, существующие операции не меняются
   * (TODO(OWNER): подтвердить путь).
   */
  @Get('class/overview')
  @ApiOkResponse({ type: ClassOverviewDto })
  classOverview(@Req() req: AuthRequest): Promise<ClassOverviewDto> {
    return this.nav.classOverview(req.user!.id, locale(req));
  }

  /** API-S-20 */
  @Get('nav-badges')
  @ApiOkResponse({ type: NavBadgesDto })
  badges(@Req() req: AuthRequest): Promise<NavBadgesDto> {
    return this.nav.badges(req.user!.id, locale(req));
  }

  /** API-S-21 */
  @Post('nav-seen')
  @HttpCode(204)
  @ApiBody({ type: NavSeenBody })
  @ApiNoContentResponse()
  seen(
    @Body(new ZodValidationPipe(NavSeenDto)) dto: Dto<typeof NavSeenDto>,
    @Req() req: AuthRequest,
  ): Promise<void> {
    return this.nav.markSeen(req.user!.id, dto.section);
  }
}
