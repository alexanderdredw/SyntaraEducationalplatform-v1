import { Controller, Get, Req } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Roles } from '../auth/auth.guards';
import { type AuthRequest } from '../auth/auth.types';
import { MeDto } from './me.dto';
import { MeService } from './me.service';

@ApiTags('auth')
@Controller('me')
export class MeController {
  constructor(private readonly service: MeService) {}

  /** API-ME-01 */
  @Get()
  @Roles()
  @ApiOkResponse({ type: MeDto })
  me(@Req() req: AuthRequest): Promise<MeDto> {
    return this.service.me(req.user!);
  }
}
