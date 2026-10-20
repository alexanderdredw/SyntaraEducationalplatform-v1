import { Body, Controller, Get, Header, HttpCode, Param, Post, Query, Req, Res } from '@nestjs/common';
import {
  ApiBody,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiProduces,
  ApiQuery,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { type Response } from 'express';
import {
  type BattleHostSnapshot,
  type BattleResults,
  BattleHistoryQuery,
  BattleSessionCreateDto,
  BattleTransitionDto,
} from '@syntara/shared';
import { type Dto } from '../../common/dto';
import { resolveLocale } from '../../common/locale';
import { UuidParamPipe } from '../../common/uuid-param.pipe';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { Roles } from '../auth/auth.guards';
import { type AuthRequest } from '../auth/auth.types';
import { Owns } from '../content/ownership.guard';
import {
  BattleHistoryDto,
  BattleResultsDto,
  BattleSessionCreateBody,
  BattleSessionCreatedDto,
  BattleSnapshotDto,
  BattleTransitionBody,
} from './battle.dto';
import { BattleRealtime } from './battle-realtime.gateway';
import { BattleSessionService } from './battle-session.service';
import { BattleStateService } from './battle-state.service';

const transition = new ZodValidationPipe(BattleTransitionDto);

/**
 * Игровые сессии ведущего (SPEC 6.8 API-BTL-20…31, SM-BTL). Чужая сессия → 404 (BR-BTL-12). Переходы —
 * с `{ expectedVersion }`; несовпадение версии → 409 staleState и свежий снимок в теле ошибки.
 */
@ApiTags('teacher')
@Controller('teacher')
@Roles('teacher')
export class BattleSessionController {
  constructor(
    private readonly sessions: BattleSessionService,
    private readonly state: BattleStateService,
    private readonly realtime: BattleRealtime,
  ) {}

  /** API-BTL-20 */
  @Post('battles/:id/sessions')
  @Owns('battle')
  @HttpCode(201)
  @ApiBody({ type: BattleSessionCreateBody })
  @ApiCreatedResponse({ type: BattleSessionCreatedDto })
  @ApiUnprocessableEntityResponse({ description: 'noQuestions / noCorrectOption' })
  @ApiConflictResponse({ description: 'tooManyActiveSessions (BR-BTL-05)' })
  create(
    @Param('id', new UuidParamPipe()) id: string,
    @Body(new ZodValidationPipe(BattleSessionCreateDto)) dto: Dto<typeof BattleSessionCreateDto>,
    @Req() req: AuthRequest,
  ): Promise<BattleSessionCreatedDto> {
    return this.sessions.create(req.user!.id, id, dto);
  }

  /** API-BTL-29 (объявлен до `:sid`). */
  @Get('battle-sessions')
  @ApiQuery({ name: 'battleId', required: false })
  @ApiQuery({ name: 'cursor', required: false })
  @ApiQuery({ name: 'limit', required: false })
  @ApiOkResponse({ type: BattleHistoryDto })
  history(
    @Query(new ZodValidationPipe(BattleHistoryQuery)) query: Dto<typeof BattleHistoryQuery>,
    @Req() req: AuthRequest,
  ) {
    return this.sessions.history(req.user!.id, query);
  }

  /** API-BTL-21 */
  @Get('battle-sessions/:sid')
  @Owns('battleSession', 'sid')
  @ApiOkResponse({ type: BattleSnapshotDto })
  snapshot(@Param('sid', new UuidParamPipe()) sid: string): Promise<BattleHostSnapshot> {
    return this.state.host(sid);
  }

  /** API-BTL-22: SSE-поток ведущего (6.9); первым приходит `snapshot`. */
  @Get('battle-sessions/:sid/events')
  @Owns('battleSession', 'sid')
  @ApiProduces('text/event-stream')
  @ApiOkResponse({
    description: 'text/event-stream: snapshot, participant_*, question_*, answer_progress, …',
  })
  async events(
    @Param('sid', new UuidParamPipe()) sid: string,
    @Req() req: AuthRequest,
    @Res() res: Response,
  ): Promise<void> {
    const snapshot = await this.state.host(sid);
    this.realtime.open(
      {
        sessionId: sid,
        role: 'host',
        userId: req.user!.id,
        authSessionId: req.user!.sessionId,
        participantId: null,
        res,
      },
      { version: snapshot.version, data: snapshot },
    );
  }

  /** API-BTL-23 */
  @Post('battle-sessions/:sid/start')
  @Owns('battleSession', 'sid')
  @HttpCode(200)
  @ApiBody({ type: BattleTransitionBody })
  @ApiOkResponse({ type: BattleSnapshotDto })
  @ApiUnprocessableEntityResponse({ description: 'noParticipants' })
  @ApiConflictResponse({ description: 'staleState (+ snapshot) / invalidTransition' })
  start(
    @Param('sid', new UuidParamPipe()) sid: string,
    @Body(transition) dto: Dto<typeof BattleTransitionDto>,
    @Req() req: AuthRequest,
  ) {
    return this.sessions.transition(req.user!.id, sid, 'start', dto.expectedVersion);
  }

  /** API-BTL-24 */
  @Post('battle-sessions/:sid/close-question')
  @Owns('battleSession', 'sid')
  @HttpCode(200)
  @ApiBody({ type: BattleTransitionBody })
  @ApiOkResponse({ type: BattleSnapshotDto })
  @ApiConflictResponse({ description: 'staleState (+ snapshot) / invalidTransition' })
  closeQuestion(
    @Param('sid', new UuidParamPipe()) sid: string,
    @Body(transition) dto: Dto<typeof BattleTransitionDto>,
    @Req() req: AuthRequest,
  ) {
    return this.sessions.transition(req.user!.id, sid, 'close', dto.expectedVersion);
  }

  /** API-BTL-25 */
  @Post('battle-sessions/:sid/next')
  @Owns('battleSession', 'sid')
  @HttpCode(200)
  @ApiBody({ type: BattleTransitionBody })
  @ApiOkResponse({ type: BattleSnapshotDto })
  @ApiConflictResponse({ description: 'staleState (+ snapshot) / invalidTransition' })
  next(
    @Param('sid', new UuidParamPipe()) sid: string,
    @Body(transition) dto: Dto<typeof BattleTransitionDto>,
    @Req() req: AuthRequest,
  ) {
    return this.sessions.transition(req.user!.id, sid, 'next', dto.expectedVersion);
  }

  /** API-BTL-26 */
  @Post('battle-sessions/:sid/finish')
  @Owns('battleSession', 'sid')
  @HttpCode(200)
  @ApiBody({ type: BattleTransitionBody })
  @ApiOkResponse({ type: BattleSnapshotDto })
  @ApiConflictResponse({ description: 'staleState (+ snapshot) / invalidTransition' })
  finish(
    @Param('sid', new UuidParamPipe()) sid: string,
    @Body(transition) dto: Dto<typeof BattleTransitionDto>,
    @Req() req: AuthRequest,
  ) {
    return this.sessions.transition(req.user!.id, sid, 'finish', dto.expectedVersion);
  }

  /** API-BTL-27 */
  @Post('battle-sessions/:sid/cancel')
  @Owns('battleSession', 'sid')
  @HttpCode(200)
  @ApiBody({ type: BattleTransitionBody })
  @ApiOkResponse({ type: BattleSnapshotDto })
  @ApiConflictResponse({ description: 'staleState (+ snapshot) / invalidTransition (только из lobby)' })
  cancel(
    @Param('sid', new UuidParamPipe()) sid: string,
    @Body(transition) dto: Dto<typeof BattleTransitionDto>,
    @Req() req: AuthRequest,
  ) {
    return this.sessions.transition(req.user!.id, sid, 'cancel', dto.expectedVersion);
  }

  /** API-BTL-28 */
  @Post('battle-sessions/:sid/participants/:pid/kick')
  @Owns('battleSession', 'sid')
  @HttpCode(200)
  @ApiOkResponse({ type: BattleSnapshotDto })
  kick(
    @Param('sid', new UuidParamPipe()) sid: string,
    @Param('pid', new UuidParamPipe()) pid: string,
    @Req() req: AuthRequest,
  ) {
    return this.sessions.kick(req.user!.id, sid, pid);
  }

  /** API-BTL-30 */
  @Get('battle-sessions/:sid/results')
  @Owns('battleSession', 'sid')
  @ApiOkResponse({ type: BattleResultsDto })
  results(@Param('sid', new UuidParamPipe()) sid: string): Promise<BattleResults> {
    return this.state.results(sid);
  }

  /** API-BTL-31: UTF-8 с BOM, «;». */
  @Get('battle-sessions/:sid/results.csv')
  @Owns('battleSession', 'sid')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @ApiProduces('text/csv')
  @ApiOkResponse({ description: 'CSV итогов (UTF-8 с BOM, разделитель «;»)' })
  async csv(@Param('sid', new UuidParamPipe()) sid: string, @Req() req: AuthRequest, @Res() res: Response) {
    const body = await this.sessions.csv(sid, resolveLocale(req.headers['accept-language']));
    res.setHeader('Content-Disposition', `attachment; filename="battle-${sid}.csv"`);
    res.send(body);
  }
}
