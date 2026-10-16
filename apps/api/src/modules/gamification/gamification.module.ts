import { Module } from '@nestjs/common';
import { GamificationService } from './gamification.service';

/** Модуль «gamification» (раздел 2.2 SPEC): XP, уровень, серия, бейджи (7.3–7.4). */
@Module({
  providers: [GamificationService],
  exports: [GamificationService],
})
export class GamificationModule {}
