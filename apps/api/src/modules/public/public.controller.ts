import { Controller, Get, Req } from '@nestjs/common';
import { type Request } from 'express';
import { ApiHeader, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { resolveLocale } from '../../common/locale';
import { PublicConfigDto, PublicSubjectDto } from './public.dto';
import { PublicService } from './public.service';

/** Публичные операции без входа (раздел 6.2). */
@ApiTags('public')
@Controller('public')
export class PublicController {
  constructor(private readonly service: PublicService) {}

  /** API-PUB-01 */
  @Get('subjects')
  @ApiHeader({ name: 'Accept-Language', required: false, description: 'ru, kk или en (API-GEN-03)' })
  @ApiOkResponse({ type: PublicSubjectDto, isArray: true })
  subjects(@Req() req: Request): Promise<PublicSubjectDto[]> {
    return this.service.subjects(resolveLocale(req.headers['accept-language']));
  }

  /** API-PUB-07 */
  @Get('config')
  @ApiOkResponse({ type: PublicConfigDto })
  config(): Promise<PublicConfigDto> {
    return this.service.publicConfig();
  }
}
