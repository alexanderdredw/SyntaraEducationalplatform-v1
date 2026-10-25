import { ApiProperty } from '@nestjs/swagger';
import { AVATAR_COLORS, AVATAR_PRESETS, AvatarKind } from '@syntara/shared';

/** 6.7 AvatarDto: картинка — подписанные ссылки 256 и 64 px только для чистой картинки, иначе инициалы. */
export class AvatarDto {
  @ApiProperty({ enum: AvatarKind.options }) kind: 'initials' | 'preset' | 'photo';
  @ApiProperty({ type: String, enum: AVATAR_PRESETS, nullable: true }) preset:
    (typeof AVATAR_PRESETS)[number] | null;
  @ApiProperty({ enum: AVATAR_COLORS }) color: (typeof AVATAR_COLORS)[number];
  @ApiProperty() initials: string;
  @ApiProperty({ type: String, nullable: true }) photoUrl: string | null;
  @ApiProperty({ type: String, nullable: true }) photoUrlSmall: string | null;
}

export class ProfileAvatarDto extends AvatarDto {
  @ApiProperty({
    type: String,
    enum: ['pending', 'clean', 'rejected'],
    nullable: true,
    description:
      'Статус картинки учителя (BR-PRF-03): pending — показываются инициалы; rejected — «Картинка не прошла проверку»',
  })
  photoStatus: 'pending' | 'clean' | 'rejected' | null;
}

class SchoolRef {
  @ApiProperty() name: string;
}

/** API-ME-06 */
export class ProfileDto {
  @ApiProperty() firstName: string;
  @ApiProperty({ type: String, nullable: true }) lastName: string | null;
  @ApiProperty({ type: String, nullable: true, description: 'Только учитель (BR-PRF-04)' }) position:
    string | null;
  @ApiProperty({ type: String, nullable: true, description: 'Только учитель (BR-PRF-04)' }) about:
    string | null;
  @ApiProperty({ type: ProfileAvatarDto }) avatar: ProfileAvatarDto;
  @ApiProperty({ type: String, nullable: true, description: 'Логин ученика — только просмотр (BR-PRF-05)' })
  login: string | null;
  @ApiProperty({ type: String, nullable: true }) email: string | null;
  @ApiProperty({ type: Boolean, nullable: true }) emailVerified: boolean | null;
  @ApiProperty({ type: SchoolRef, nullable: true }) school: SchoolRef | null;
  @ApiProperty({ enum: ['student', 'teacher'] }) role: 'student' | 'teacher';
  @ApiProperty({ format: 'date-time' }) createdAt: string;
  @ApiProperty({ type: String, nullable: true, format: 'date-time' }) lastLoginAt: string | null;
  @ApiProperty({ description: 'Можно менять имя (PH-46 student_can_change_name)' }) nameEditable: boolean;
  @ApiProperty({ description: 'Осталось изменений имени в окне 30 дней (BR-PRF-01)' })
  nameChangesLeft: number;
  @ApiProperty({ type: String, nullable: true, format: 'date-time' }) nameChangeAvailableAt: string | null;
  @ApiProperty({ description: 'Ученик с логином и email (BR-PRF-07)' }) canRemoveEmail: boolean;
  @ApiProperty({ description: 'Своя картинка — только учитель (BR-PRF-03)' }) canUploadPhoto: boolean;
}

export class ProfilePatchBody {
  @ApiProperty({ required: false, maxLength: 40 }) firstName?: string;
  @ApiProperty({ required: false, maxLength: 40 }) lastName?: string;
  @ApiProperty({ required: false, maxLength: 80 }) position?: string;
  @ApiProperty({ required: false, maxLength: 300 }) about?: string;
}

export class AvatarPutBody {
  @ApiProperty({ enum: AvatarKind.options }) kind: 'initials' | 'preset' | 'photo';
  @ApiProperty({ required: false, enum: AVATAR_PRESETS }) preset?: string;
  @ApiProperty({ required: false, format: 'uuid' }) mediaId?: string;
  @ApiProperty({ required: false, enum: AVATAR_COLORS }) color?: string;
}

export class AvatarUploadUrlBody {
  @ApiProperty() fileName: string;
  @ApiProperty({ enum: ['image/jpeg', 'image/png', 'image/webp'] }) mime: string;
  @ApiProperty({ description: 'Байты, ≤ 2 МБ' }) size: number;
}
