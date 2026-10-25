import { Module } from '@nestjs/common';
import { AssignmentsModule } from '../assignments/assignments.module';
import { BattleModule } from '../battle/battle.module';
import { ProfilesModule } from '../profiles/profiles.module';
import { ResultsModule } from '../results/results.module';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

/** Модуль «dashboard» (SPEC 8.7): сводка личного кабинета API-ME-12 поверх существующих сервисов (только чтение). */
@Module({
  imports: [ResultsModule, AssignmentsModule, BattleModule, ProfilesModule],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
