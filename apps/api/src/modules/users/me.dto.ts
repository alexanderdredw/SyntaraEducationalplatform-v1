import { ApiProperty } from '@nestjs/swagger';
import { LOCALES, type Locale, UserRole } from '@syntara/shared';

class PreferencesDto {
  @ApiProperty({ enum: LOCALES }) locale: Locale;
  @ApiProperty({ enum: ['system', 'light', 'dark'] }) theme: string;
  @ApiProperty() dataSaver: boolean;
}

/** API-ME-01: MeDto { id, displayName, initials, roles[], activeRole, preferences }. */
export class MeDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() displayName: string;
  @ApiProperty() initials: string;
  @ApiProperty({ enum: UserRole.options, isArray: true }) roles: UserRole[];
  @ApiProperty({ enum: UserRole.options }) activeRole: UserRole;
  @ApiProperty({ type: PreferencesDto }) preferences: PreferencesDto;
  @ApiProperty({
    type: Boolean,
    nullable: true,
    description: 'Email подтверждён; null — email нет (API-AUTH-06)',
  })
  emailVerified: boolean | null;
  @ApiProperty({ description: 'Временный пароль от учителя — нужно сменить (API-AUTH-05)' })
  mustChangePassword: boolean;
}

export class PreferencesBody {
  @ApiProperty({ enum: LOCALES, required: false }) locale?: Locale;
  @ApiProperty({ enum: ['light', 'dark', 'system'], required: false }) theme?: string;
  @ApiProperty({ required: false }) dataSaver?: boolean;
}

export class ActiveRoleBody {
  @ApiProperty({ enum: UserRole.options }) role: UserRole;
}

export class NotificationDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() type: string;
  @ApiProperty({ type: Object }) payload: Record<string, unknown>;
  @ApiProperty({ type: String, nullable: true, format: 'date-time' }) readAt: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt: string;
}

export class DataRequestBody {
  @ApiProperty({ enum: ['export', 'delete'] }) type: 'export' | 'delete';
}

/** API-ME-05: номер обращения data_privacy (PH-08), если оно создано. */
export class DataRequestResponse {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ enum: ['export', 'delete'] }) type: 'export' | 'delete';
  @ApiProperty({ type: String, nullable: true }) publicNumber: string | null;
}

/** API-S-16 */
export class MeStatsDto {
  @ApiProperty() streakDays: number;
  @ApiProperty() xpTotal: number;
}
