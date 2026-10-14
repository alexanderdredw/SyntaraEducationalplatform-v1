import { ApiProperty } from '@nestjs/swagger';
import { MeDto } from '../users/me.dto';

/** API-AUTH-01: тело запроса (схема — LoginDto в packages/shared). */
export class LoginBody {
  @ApiProperty({ maxLength: 254, description: 'Email или логин ученика (PH-44)' }) email: string;
  @ApiProperty({ maxLength: 200 }) password: string;
}

export class LoginResponse {
  @ApiProperty({ type: MeDto }) user: MeDto;
}

export class RegisterTeacherBody {
  @ApiProperty({ enum: ['teacher'] }) role: 'teacher';
  @ApiProperty({ format: 'email', maxLength: 254 }) email: string;
  @ApiProperty({ maxLength: 100 }) displayName: string;
  @ApiProperty({ minLength: 8, maxLength: 200, description: 'PH-06' }) password: string;
}

export class RegisterStudentBody {
  @ApiProperty({ description: 'Код класса (BR-CLS-01)' }) code: string;
  @ApiProperty({ maxLength: 100 }) displayName: string;
  @ApiProperty({ description: 'PH-44: 3–32 символа a-z 0-9 . _ -' }) login: string;
  @ApiProperty({ minLength: 8, maxLength: 200 }) password: string;
  @ApiProperty({ format: 'email', required: false }) email?: string;
}

export class ForgotPasswordBody {
  @ApiProperty({ format: 'email' }) email: string;
}

export class ResetPasswordBody {
  @ApiProperty() token: string;
  @ApiProperty({ minLength: 8, maxLength: 200 }) password: string;
}
