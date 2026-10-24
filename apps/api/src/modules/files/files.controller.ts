import { Body, Controller, Delete, Get, HttpCode, Param, Post, Req } from '@nestjs/common';
import {
  ApiBody,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiPayloadTooLargeResponse,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { UploadUrlDto } from '@syntara/shared';
import { type Dto } from '../../common/dto';
import { UuidParamPipe } from '../../common/uuid-param.pipe';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { Roles } from '../auth/auth.guards';
import { type AuthRequest } from '../auth/auth.types';
import { Owns } from '../content/ownership.guard';
import { GalleryItemDto, MediaStatusDto, UploadUrlBody, UploadUrlResponse } from './files.dto';
import { FilesService } from './files.service';

/** Загрузка файлов учителем (API-T-16/17, 7.8). */
@ApiTags('teacher')
@Controller('files')
@Roles('teacher')
export class FilesController {
  constructor(private readonly files: FilesService) {}

  /** API-T-16: лимиты BR-FILE-01/02 — до выдачи ссылки. */
  @Post('upload-url')
  @HttpCode(201)
  @ApiBody({ type: UploadUrlBody })
  @ApiCreatedResponse({ type: UploadUrlResponse })
  @ApiPayloadTooLargeResponse({ description: 'Файл или сумма файлов темы больше лимита' })
  @ApiUnprocessableEntityResponse({ description: 'Недопустимый тип или 20 файлов на тему' })
  uploadUrl(
    @Body(new ZodValidationPipe(UploadUrlDto)) dto: Dto<typeof UploadUrlDto>,
    @Req() req: AuthRequest,
  ): Promise<UploadUrlResponse> {
    return this.files.uploadUrl(req.user!.id, dto);
  }

  /** API-T-17 */
  @Post(':mediaId/complete')
  @Owns('media', 'mediaId')
  @HttpCode(200)
  @ApiOkResponse({ type: MediaStatusDto })
  @ApiPayloadTooLargeResponse()
  @ApiUnprocessableEntityResponse({ description: 'Сигнатура не совпала или объект не загружен' })
  complete(@Param('mediaId', new UuidParamPipe()) mediaId: string): Promise<MediaStatusDto> {
    return this.files.complete(mediaId);
  }
}

/** API-T-18 */
@ApiTags('teacher')
@Controller('teacher/gallery')
@Roles('teacher')
export class GalleryController {
  constructor(private readonly files: FilesService) {}

  @Get()
  @ApiOkResponse({ type: GalleryItemDto, isArray: true })
  gallery(@Req() req: AuthRequest): Promise<GalleryItemDto[]> {
    return this.files.gallery(req.user!.id);
  }

  /** API-T-31 (BR-DEL-04/05): чужая или несуществующая картинка — 404. */
  @Delete(':mediaId')
  @Owns('media', 'mediaId')
  @HttpCode(204)
  @ApiNoContentResponse()
  @ApiNotFoundResponse()
  @ApiConflictResponse({
    description:
      'coverInUse — обложка темы (черновик или опубликованная версия); coverInUseBattle — картинка Battle',
  })
  remove(@Param('mediaId', new UuidParamPipe()) mediaId: string, @Req() req: AuthRequest): Promise<void> {
    return this.files.removeCover(req.user!.id, mediaId);
  }
}
