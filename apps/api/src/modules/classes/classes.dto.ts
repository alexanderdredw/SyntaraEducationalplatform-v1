import { ApiProperty } from '@nestjs/swagger';
import { AvatarDto } from '../profiles/profile.dto';

/** API-T-04 */
export class TeacherClassDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() name: string;
  @ApiProperty() studentsCount: number;
}

export class CreateClassBody {
  @ApiProperty({ maxLength: 50 }) name: string;
}

/** API-T-06: код показывается один раз. */
export class IssuedCodeDto {
  @ApiProperty({ example: 'K7M2QX' }) code: string;
  @ApiProperty({ format: 'date-time' }) expiresAt: string;
}

export class ClassCodeBody {
  @ApiProperty({ description: 'Код класса; нормализуется (BR-CLS-01)' }) code: string;
}

/** API-PUB-08: без данных класса. */
export class CodeCheckDto {
  @ApiProperty() valid: boolean;
}

/** API-S-02 */
export class StudentClassDto {
  @ApiProperty({ format: 'uuid' }) classId: string;
  @ApiProperty() className: string;
  @ApiProperty() teacherName: string;
  @ApiProperty({ type: String, nullable: true }) schoolName: string | null;
  /** REQ-PRF-11, BR-PRF-04: аватар, «Должность» и «О себе» учителя — только ученикам его класса. */
  @ApiProperty({ type: AvatarDto }) teacherAvatar: AvatarDto;
  @ApiProperty({ type: String, nullable: true }) teacherPosition: string | null;
  @ApiProperty({ type: String, nullable: true }) teacherAbout: string | null;
}

/** API-T-26 (минимальная версия) */
export class RosterStudentDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() displayName: string;
  @ApiProperty({ type: String, nullable: true }) login: string | null;
  @ApiProperty() hasEmail: boolean;
  /** REQ-PRF-11: аватар ученика в «Ростере». */
  @ApiProperty({ type: AvatarDto }) avatar: AvatarDto;
}

/** API-T-27: показывается один раз. */
export class TemporaryPasswordDto {
  @ApiProperty() temporaryPassword: string;
}
