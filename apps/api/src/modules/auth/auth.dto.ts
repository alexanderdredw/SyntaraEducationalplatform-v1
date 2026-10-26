import { ApiProperty } from '@nestjs/swagger';
import { MeDto } from '../users/me.dto';

/** API-AUTH-01: тело запроса (схема — LoginDto в packages/shared). */
export class LoginBody {
  @ApiProperty({ maxLength: 254, description: 'Email или логин ученика (PH-44)' }) email: string;
  @ApiProperty({ maxLength: 200 }) password: string;
  @ApiProperty({
    required: false,
    enum: ['student', 'teacher'],
    description:
      'BR-AUTH-01: роль формы входа; нет роли у аккаунта — 403 wrongRoleForLogin + expectedEntry. Без поля — служебный вход',
  })
  role?: 'student' | 'teacher';
}

export class LoginResponse {
  @ApiProperty({ type: MeDto }) user: MeDto;
}

export class RegisterTeacherBody {
  @ApiProperty({ enum: ['teacher'] }) role: 'teacher';
  @ApiProperty({ format: 'email', maxLength: 254 }) email: string;
  @ApiProperty({ maxLength: 40, description: 'Имя (BR-PRF-01)' }) firstName: string;
  @ApiProperty({ maxLength: 40, description: 'Фамилия (BR-PRF-01)' }) lastName: string;
  @ApiProperty({
    maxLength: 100,
    required: false,
    description: 'Прежний формат: имя целиком вместо firstName и lastName',
  })
  displayName?: string;
  @ApiProperty({ minLength: 8, maxLength: 200, description: 'PH-06' }) password: string;
  @ApiProperty({ format: 'uuid', required: false, description: 'Школа из справочника (API-PUB-09)' })
  schoolId?: string;
  @ApiProperty({ maxLength: 200, required: false, description: 'Школа вручную — «не проверена»' })
  schoolName?: string;
}

export class RegisterStudentBody {
  @ApiProperty({ maxLength: 100 }) displayName: string;
  @ApiProperty({ description: 'PH-44: 3–32 символа a-z 0-9 . _ -' }) login: string;
  @ApiProperty({ minLength: 8, maxLength: 200 }) password: string;
  @ApiProperty({ format: 'email', required: false }) email?: string;
  @ApiProperty({ format: 'uuid', required: false, description: 'Школа из справочника (API-PUB-09)' })
  schoolId?: string;
  @ApiProperty({ maxLength: 200, required: false, description: 'Школа вручную — «не проверена»' })
  schoolName?: string;
  @ApiProperty({ required: false, description: 'Код класса (необязательно, BR-CLS-01)' }) code?: string;
}

export class ForgotPasswordBody {
  @ApiProperty({ format: 'email' }) email: string;
}

export class ResetPasswordBody {
  @ApiProperty() token: string;
  @ApiProperty({ minLength: 8, maxLength: 200 }) password: string;
}

export class ChangePasswordBody {
  @ApiProperty({ required: false, maxLength: 200 }) currentPassword?: string;
  @ApiProperty({ minLength: 8, maxLength: 200 }) password: string;
}

export class VerifyEmailBody {
  @ApiProperty() token: string;
}
