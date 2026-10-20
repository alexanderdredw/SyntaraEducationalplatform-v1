import { Body, Controller, Get, HttpCode, Param, Post, Req, Res } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiExtraModels,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import { type Response } from 'express';
import { ClassCodeDto, CreateClassDto, RegisterStudentDto } from '@syntara/shared';
import { type Dto } from '../../common/dto';
import { resolveLocale } from '../../common/locale';
import { RateLimit } from '../../common/rate-limit';
import { UuidParamPipe } from '../../common/uuid-param.pipe';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { LoginResponse, RegisterStudentBody } from '../auth/auth.dto';
import { Roles } from '../auth/auth.guards';
import { type AuthRequest } from '../auth/auth.types';
import {
  ClassCodeBody,
  CodeCheckDto,
  CreateClassBody,
  IssuedCodeDto,
  RosterStudentDto,
  StudentClassDto,
  TeacherClassDto,
  TemporaryPasswordDto,
} from './classes.dto';
import { ClassesService } from './classes.service';

/** Классы учителя (6.4): только свои классы (BR-ACL-02). */
@ApiTags('teacher')
@Controller('teacher/classes')
@Roles('teacher')
export class TeacherClassesController {
  constructor(private readonly classes: ClassesService) {}

  /** API-T-04 */
  @Get()
  @ApiOkResponse({ type: TeacherClassDto, isArray: true })
  list(@Req() req: AuthRequest): Promise<TeacherClassDto[]> {
    return this.classes.teacherClasses(req.user!.id);
  }

  /** API-T-05 */
  @Post()
  @HttpCode(201)
  @ApiBody({ type: CreateClassBody })
  @ApiCreatedResponse({ type: TeacherClassDto })
  create(
    @Body(new ZodValidationPipe(CreateClassDto)) dto: Dto<typeof CreateClassDto>,
    @Req() req: AuthRequest,
  ): Promise<TeacherClassDto> {
    return this.classes.create(req.user!.id, dto.name);
  }

  /** API-T-26 (минимальная версия): ученики класса. */
  @Get(':id/roster')
  @ApiOkResponse({ type: RosterStudentDto, isArray: true })
  @ApiNotFoundResponse()
  roster(@Param('id', new UuidParamPipe()) id: string, @Req() req: AuthRequest): Promise<RosterStudentDto[]> {
    return this.classes.roster(req.user!.id, id);
  }

  /** API-T-27: временный пароль ученику без email (BR-CLS-05). */
  @Post(':id/students/:studentId/temporary-password')
  @HttpCode(201)
  @ApiCreatedResponse({ type: TemporaryPasswordDto })
  @ApiNotFoundResponse()
  @ApiConflictResponse({ description: 'У ученика есть email — сброс по почте' })
  temporaryPassword(
    @Param('id', new UuidParamPipe()) id: string,
    @Param('studentId', new UuidParamPipe()) studentId: string,
    @Req() req: AuthRequest,
  ): Promise<TemporaryPasswordDto> {
    return this.classes.temporaryPassword(req.user!.id, id, studentId);
  }

  /** API-T-06 */
  @Post(':id/invite-codes')
  @HttpCode(201)
  @ApiCreatedResponse({ type: IssuedCodeDto })
  @ApiNotFoundResponse()
  issue(@Param('id', new UuidParamPipe()) id: string, @Req() req: AuthRequest): Promise<IssuedCodeDto> {
    return this.classes.issueCode(req.user!.id, id);
  }
}

/** Класс ученика (6.5). */
@ApiTags('student')
@Controller('student')
@Roles('student')
@ApiExtraModels(StudentClassDto)
export class StudentClassController {
  constructor(private readonly classes: ClassesService) {}

  /** API-S-01: после входа и подтверждения (BR-CLS-02). Лимит — как у проверки кода. */
  @Post('join')
  @HttpCode(200)
  @RateLimit('join')
  @ApiBody({ type: ClassCodeBody })
  @ApiOkResponse({ type: StudentClassDto })
  @ApiNotFoundResponse({
    description:
      'Код не найден или истёк (invalidCode); код активной сессии Battle — isBattleCode (BR-CODE-04)',
  })
  join(
    @Body(new ZodValidationPipe(ClassCodeDto)) dto: Dto<typeof ClassCodeDto>,
    @Req() req: AuthRequest,
  ): Promise<StudentClassDto> {
    return this.classes.join(req.user!, dto.code);
  }

  /** API-S-02 */
  @Get('class')
  @ApiOkResponse({ schema: { nullable: true, allOf: [{ $ref: getSchemaPath(StudentClassDto) }] } })
  async studentClass(@Req() req: AuthRequest, @Res() res: Response): Promise<void> {
    // Без класса — JSON null (Nest иначе отдал бы пустое тело).
    res.status(200).json(await this.classes.studentClass(req.user!.id));
  }

  /** API-S-03 (PH-40: подтверждение — в интерфейсе). */
  @Post('class/leave')
  @HttpCode(204)
  @ApiNoContentResponse()
  @ApiNotFoundResponse({ description: 'Ученик не состоит в классе' })
  leave(@Req() req: AuthRequest): Promise<void> {
    return this.classes.leave(req.user!);
  }
}

/** Публичная проверка кода (API-PUB-08) и регистрация ученика (API-AUTH-03S, BR-CLS-04). */
@ApiTags('public')
@Controller()
export class JoinController {
  constructor(private readonly classes: ClassesService) {}

  /** API-PUB-08: только `valid` (BR-CLS-02); лимит — 10 за 15 минут (API-GEN-06). */
  @Post('public/join/check')
  @HttpCode(200)
  @RateLimit('join')
  @ApiBody({ type: ClassCodeBody })
  @ApiOkResponse({ type: CodeCheckDto })
  @ApiNotFoundResponse({
    description: 'Код активной сессии Battle — fieldErrors.code = isBattleCode (BR-CODE-04)',
  })
  check(@Body(new ZodValidationPipe(ClassCodeDto)) dto: Dto<typeof ClassCodeDto>): Promise<CodeCheckDto> {
    return this.classes.check(dto.code);
  }

  /** API-AUTH-03S: самостоятельная регистрация ученика; код класса необязателен; сразу выполняется вход. */
  @Post('auth/register-student')
  @HttpCode(201)
  @RateLimit('join')
  @ApiTags('auth')
  @ApiBody({ type: RegisterStudentBody })
  @ApiCreatedResponse({ type: LoginResponse })
  @ApiBadRequestResponse({
    description:
      'Ошибки полей; неверный код — fieldErrors.code = invalidCode, код Battle — isBattleCode (BR-CODE-04)',
  })
  @ApiConflictResponse({ description: 'Логин или email заняты' })
  async registerStudent(
    @Body(new ZodValidationPipe(RegisterStudentDto)) dto: Dto<typeof RegisterStudentDto>,
    @Req() req: AuthRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LoginResponse> {
    const user = await this.classes.registerStudent(
      dto,
      resolveLocale(req.headers['accept-language']),
      req.headers['user-agent'],
      res,
    );
    return { user };
  }
}
