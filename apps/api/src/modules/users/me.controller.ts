import { Body, Controller, Get, HttpCode, Patch, Post, Req, Res } from '@nestjs/common';
import { ApiBody, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { type Response } from 'express';
import { ActiveRoleDto, DataRequestDto, PreferencesPatchDto } from '@syntara/shared';
import { ApiException } from '../../common/api-exception';
import { type Dto } from '../../common/dto';
import { resolveLocale } from '../../common/locale';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { Roles } from '../auth/auth.guards';
import { ACTIVE_ROLE_COOKIE, type AuthRequest, SESSION_TTL_MS } from '../auth/auth.types';
import {
  ActiveRoleBody,
  DataRequestBody,
  DataRequestItemDto,
  DataRequestResponse,
  MeDto,
  MeStatsDto,
  NotificationDto,
  PreferencesBody,
} from './me.dto';
import { MeService } from './me.service';

const preferredRole = (req: AuthRequest) =>
  (req.cookies as Record<string, string> | undefined)?.[ACTIVE_ROLE_COOKIE];

@ApiTags('auth')
@Controller('me')
@Roles()
export class MeController {
  constructor(private readonly service: MeService) {}

  /** API-ME-01 */
  @Get()
  @ApiOkResponse({ type: MeDto })
  me(@Req() req: AuthRequest): Promise<MeDto> {
    return this.service.me(req.user!, preferredRole(req));
  }

  /** API-ME-02 */
  @Patch('preferences')
  @ApiBody({ type: PreferencesBody })
  @ApiOkResponse({ type: MeDto })
  preferences(
    @Body(new ZodValidationPipe(PreferencesPatchDto)) dto: Dto<typeof PreferencesPatchDto>,
    @Req() req: AuthRequest,
  ): Promise<MeDto> {
    return this.service.updatePreferences(req.user!, dto, preferredRole(req));
  }

  /** API-ME-03: выбранная роль хранится в cookie и проверяется по ролям пользователя при каждом запросе. */
  @Post('active-role')
  @HttpCode(200)
  @ApiBody({ type: ActiveRoleBody })
  @ApiOkResponse({ type: MeDto })
  async activeRole(
    @Body(new ZodValidationPipe(ActiveRoleDto)) dto: Dto<typeof ActiveRoleDto>,
    @Req() req: AuthRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<MeDto> {
    if (!req.user!.roles.includes(dto.role)) {
      throw new ApiException(403, 'FORBIDDEN', 'Role is not assigned to the user');
    }
    res.cookie(ACTIVE_ROLE_COOKIE, dto.role, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: SESSION_TTL_MS,
    });
    return this.service.me(req.user!, dto.role);
  }

  /** API-ME-04 */
  @Get('notifications')
  @ApiOkResponse({ type: NotificationDto, isArray: true })
  notifications(@Req() req: AuthRequest): Promise<NotificationDto[]> {
    return this.service.notifications(req.user!);
  }

  /** API-ME-05 GET (REQ-PRF-34): свои запросы с датой и статусом. */
  @Get('data-requests')
  @ApiOkResponse({ type: DataRequestItemDto, isArray: true })
  dataRequests(@Req() req: AuthRequest): Promise<DataRequestItemDto[]> {
    return this.service.dataRequests(req.user!);
  }

  /** API-ME-05 */
  @Post('data-requests')
  @HttpCode(201)
  @ApiBody({ type: DataRequestBody })
  @ApiCreatedResponse({ type: DataRequestResponse })
  dataRequest(
    @Body(new ZodValidationPipe(DataRequestDto)) dto: Dto<typeof DataRequestDto>,
    @Req() req: AuthRequest,
  ): Promise<DataRequestResponse> {
    return this.service.dataRequest(req.user!, dto, resolveLocale(req.headers['accept-language']));
  }

  /** API-S-16 */
  @Get('stats')
  @Roles('student')
  @ApiOkResponse({ type: MeStatsDto })
  stats(@Req() req: AuthRequest): Promise<MeStatsDto> {
    return this.service.stats(req.user!);
  }
}
