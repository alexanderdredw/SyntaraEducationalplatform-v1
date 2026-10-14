import { ApiProperty } from '@nestjs/swagger';
import { MeDto } from '../users/me.dto';

/** API-AUTH-01: тело запроса (схема — LoginDto в packages/shared). */
export class LoginBody {
  @ApiProperty({ format: 'email', maxLength: 254 }) email: string;
  @ApiProperty({ maxLength: 200 }) password: string;
}

export class LoginResponse {
  @ApiProperty({ type: MeDto }) user: MeDto;
}
