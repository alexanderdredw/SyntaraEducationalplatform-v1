import { Body, Controller, Get, HttpCode, Patch, Post, Put, Req } from '@nestjs/common';
import {
  ApiBody,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiPayloadTooLargeResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { AvatarPutDto, AvatarUploadUrlDto, ProfilePatchDto } from '@syntara/shared';
import { type Dto } from '../../common/dto';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { Roles } from '../auth/auth.guards';
import { ACTIVE_ROLE_COOKIE, type AuthRequest } from '../auth/auth.types';
import { UploadUrlResponse } from '../files/files.dto';
import { AvatarPutBody, AvatarUploadUrlBody, ProfileDto, ProfilePatchBody } from './profile.dto';
import { profileRole, ProfileService } from './profile.service';

const roleOf = (req: AuthRequest) =>
  profileRole(req.user!.roles, (req.cookies as Record<string, string> | undefined)?.[ACTIVE_ROLE_COOKIE]);

/** Профиль ученика и учителя (SPEC 8.7, API-ME-06…09). Только свой профиль: id — из сессии (BR-PRF-09). */
@ApiTags('auth')
@Controller('me')
@Roles('student', 'teacher')
export class ProfileController {
  constructor(private readonly profiles: ProfileService) {}

  /** API-ME-06 */
  @Get('profile')
  @ApiOkResponse({ type: ProfileDto })
  get(@Req() req: AuthRequest): Promise<ProfileDto> {
    return this.profiles.get(req.user!, roleOf(req));
  }

  /** API-ME-07 (BR-PRF-01, BR-PRF-04) */
  @Patch('profile')
  @ApiBody({ type: ProfilePatchBody })
  @ApiOkResponse({ type: ProfileDto })
  @ApiTooManyRequestsResponse({
    description: 'Имя меняли 3 раза за 30 дней (fieldErrors.firstName = nameChangeLimit)',
  })
  patch(
    @Body(new ZodValidationPipe(ProfilePatchDto)) dto: Dto<typeof ProfilePatchDto>,
    @Req() req: AuthRequest,
  ): Promise<ProfileDto> {
    return this.profiles.patch(req.user!, roleOf(req), dto);
  }

  /** API-ME-08 (BR-PRF-03): только учитель; затем API-T-17 complete. */
  @Post('avatar/upload-url')
  @HttpCode(201)
  @ApiBody({ type: AvatarUploadUrlBody })
  @ApiCreatedResponse({ type: UploadUrlResponse })
  @ApiForbiddenResponse({ description: 'Ученик не загружает картинку (решение владельца 2026-10-25)' })
  @ApiPayloadTooLargeResponse({ description: 'Больше 2 МБ' })
  @ApiUnprocessableEntityResponse({ description: 'Не JPG/PNG/WEBP' })
  @ApiTooManyRequestsResponse({ description: '5 загрузок за 24 часа' })
  uploadUrl(
    @Body(new ZodValidationPipe(AvatarUploadUrlDto)) dto: Dto<typeof AvatarUploadUrlDto>,
    @Req() req: AuthRequest,
  ): Promise<UploadUrlResponse> {
    return this.profiles.uploadUrl(req.user!, dto);
  }

  /** API-ME-09 (BR-PRF-02/03) */
  @Put('avatar')
  @ApiBody({ type: AvatarPutBody })
  @ApiOkResponse({ type: ProfileDto })
  @ApiForbiddenResponse({ description: 'Своя картинка — только учитель' })
  putAvatar(
    @Body(new ZodValidationPipe(AvatarPutDto)) dto: Dto<typeof AvatarPutDto>,
    @Req() req: AuthRequest,
  ): Promise<ProfileDto> {
    return this.profiles.putAvatar(req.user!, roleOf(req), dto);
  }
}
