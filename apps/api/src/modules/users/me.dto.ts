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
}
