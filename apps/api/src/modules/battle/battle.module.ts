import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { ClassCodesModule } from '../classes/class-codes.service';
import { OwnershipGuard } from '../content/ownership.guard';
import { FilesModule } from '../files/files.module';
import { BattleEngine } from './battle-engine.service';
import { BattleQuizController } from './battle-quiz.controller';
import { BattleQuizService } from './battle-quiz.service';
import { BattleRealtime } from './battle-realtime.gateway';
import { BattleSessionController } from './battle-session.controller';
import { BattleSessionService } from './battle-session.service';
import { BattleStateService } from './battle-state.service';
import { StudentBattleController } from './student-battle.controller';
import { StudentBattleService } from './student-battle.service';

/** Модуль «battle» (раздел 2.2 SPEC, итерация 10.5): Battle-тесты, игровые сессии, участие учеников (7.12). */
@Module({
  // BR-CODE-01: от подсистемы классов — только проверка «код занят» (ClassCodesService.isActiveCode).
  imports: [FilesModule, AuditModule, ClassCodesModule],
  controllers: [BattleQuizController, BattleSessionController, StudentBattleController],
  providers: [
    BattleQuizService,
    BattleRealtime,
    BattleEngine,
    BattleStateService,
    BattleSessionService,
    StudentBattleService,
    OwnershipGuard,
  ],
  exports: [BattleRealtime, BattleSessionService, StudentBattleService],
})
export class BattleModule {}
