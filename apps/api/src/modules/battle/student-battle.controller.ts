import { Body, Controller, Get, HttpCode, Param, Post, Query, Req, Res } from '@nestjs/common';
import {
  ApiBody,
  ApiConflictResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiProduces,
  ApiQuery,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { type Response } from 'express';
import {
  BattleAnswerDto,
  BattleHistoryQuery,
  BattleJoinDto,
  type BattleResults,
  type BattleStudentSnapshot,
} from '@syntara/shared';
import { type Dto } from '../../common/dto';
import { RateLimit } from '../../common/rate-limit';
import { UuidParamPipe } from '../../common/uuid-param.pipe';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { Roles } from '../auth/auth.guards';
import { type AuthRequest } from '../auth/auth.types';
import { Owns } from '../content/ownership.guard';
import {
  BattleAcceptedDto,
  BattleAnswerBody,
  BattleJoinBody,
  BattleJoinedDto,
  BattleResultsDto,
  BattleSnapshotDto,
  BattleStudentHistoryDto,
} from './battle.dto';
import { BattleRealtime } from './battle-realtime.gateway';
import { BattleStateService } from './battle-state.service';
import { StudentBattleService } from './student-battle.service';

/**
 * Battle ученика (SPEC 6.8 API-BTL-40…46). Сессия, где ученик не участник, → 404 (BR-BTL-12).
 * Правильность ответа до раскрытия не сообщается (BR-BTL-03).
 */
@ApiTags('student')
@Controller('student')
@Roles('student')
export class StudentBattleController {
  constructor(
    private readonly battles: StudentBattleService,
    private readonly state: BattleStateService,
    private readonly realtime: BattleRealtime,
  ) {}

  /**
   * API-BTL-40: ввод кода — 10 за 10 минут на ученика и 30 на IP (BR-BTL-01); ключи лимита отдельные от ввода кода
   * класса (BR-CODE-06), подсказка `isClassCode` тоже учитывается в лимите (BR-CODE-04).
   */
  @Post('battles/join')
  @HttpCode(200)
  @RateLimit('battleJoin')
  @ApiBody({ type: BattleJoinBody })
  @ApiOkResponse({ type: BattleJoinedDto })
  @ApiNotFoundResponse({
    description:
      'codeNotFound — в том числе код чужого класса; isClassCode — это действующий код класса (BR-CODE-04)',
  })
  @ApiUnprocessableEntityResponse({
    description: 'invalidBattleCode — не формат ^[A-Z]{3}[1-9]{3}$ (BR-CODE-02)',
  })
  @ApiConflictResponse({ description: 'kicked / full / alreadyStarted' })
  join(@Body(new ZodValidationPipe(BattleJoinDto)) dto: Dto<typeof BattleJoinDto>, @Req() req: AuthRequest) {
    return this.battles.join(req.user!.id, dto.code);
  }

  /** API-BTL-45 (объявлен до `:sid`). */
  @Get('battle-sessions')
  @ApiQuery({ name: 'cursor', required: false })
  @ApiQuery({ name: 'limit', required: false })
  @ApiOkResponse({ type: BattleStudentHistoryDto })
  history(
    @Query(new ZodValidationPipe(BattleHistoryQuery)) query: Dto<typeof BattleHistoryQuery>,
    @Req() req: AuthRequest,
  ) {
    return this.battles.history(req.user!.id, query);
  }

  /** API-BTL-41 */
  @Get('battle-sessions/:sid')
  @Owns('battleParticipation', 'sid')
  @ApiOkResponse({ type: BattleSnapshotDto })
  snapshot(
    @Param('sid', new UuidParamPipe()) sid: string,
    @Req() req: AuthRequest,
  ): Promise<BattleStudentSnapshot> {
    return this.state.student(sid, req.user!.id);
  }

  /** API-BTL-42: SSE-поток ученика; выгнанному — снимок с `kicked: true`, поток закрывается. */
  @Get('battle-sessions/:sid/events')
  @Owns('battleParticipation', 'sid')
  @ApiProduces('text/event-stream')
  @ApiOkResponse({
    description: 'text/event-stream: snapshot, question_*, answer_accepted, leaderboard, finished, …',
  })
  async events(
    @Param('sid', new UuidParamPipe()) sid: string,
    @Req() req: AuthRequest,
    @Res() res: Response,
  ): Promise<void> {
    const [snapshot, participant] = await Promise.all([
      this.state.student(sid, req.user!.id),
      this.battles.participant(req.user!.id, sid),
    ]);
    this.realtime.open(
      {
        sessionId: sid,
        role: 'student',
        userId: req.user!.id,
        authSessionId: req.user!.sessionId,
        participantId: participant.id,
        res,
      },
      { version: snapshot.version, data: snapshot },
    );
    if (snapshot.kicked) res.end();
  }

  /** API-BTL-43 */
  @Post('battle-sessions/:sid/answers')
  @Owns('battleParticipation', 'sid')
  @HttpCode(200)
  @ApiBody({ type: BattleAnswerBody })
  @ApiOkResponse({ type: BattleAcceptedDto })
  @ApiConflictResponse({ description: 'questionClosed / alreadyAnswered / kicked / notInGame' })
  answer(
    @Param('sid', new UuidParamPipe()) sid: string,
    @Body(new ZodValidationPipe(BattleAnswerDto)) dto: Dto<typeof BattleAnswerDto>,
    @Req() req: AuthRequest,
  ) {
    return this.battles.answer(req.user!.id, sid, dto);
  }

  /** API-BTL-44 */
  @Post('battle-sessions/:sid/leave')
  @Owns('battleParticipation', 'sid')
  @HttpCode(204)
  @ApiNoContentResponse()
  leave(@Param('sid', new UuidParamPipe()) sid: string, @Req() req: AuthRequest): Promise<void> {
    return this.battles.leave(req.user!.id, sid);
  }

  /** API-BTL-46 */
  @Get('battle-sessions/:sid/results')
  @Owns('battleParticipation', 'sid')
  @ApiOkResponse({ type: BattleResultsDto })
  @ApiConflictResponse({ description: 'notFinished / kicked' })
  results(@Param('sid', new UuidParamPipe()) sid: string, @Req() req: AuthRequest): Promise<BattleResults> {
    return this.battles.results(req.user!.id, sid);
  }
}
