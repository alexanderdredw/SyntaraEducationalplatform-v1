import { Module } from '@nestjs/common';
import { OwnershipGuard } from '../content/ownership.guard';
import { FilesModule } from '../files/files.module';
import { BattleQuizController } from './battle-quiz.controller';
import { BattleQuizService } from './battle-quiz.service';

/** Модуль «battle» (раздел 2.2 SPEC, итерация 10.5): Battle-тесты, игровые сессии, участие учеников (7.12). */
@Module({
  imports: [FilesModule],
  controllers: [BattleQuizController],
  providers: [BattleQuizService, OwnershipGuard],
})
export class BattleModule {}
