import { Module } from '@nestjs/common';
import { AssignmentsModule } from '../assignments/assignments.module';
import { ClassesModule } from '../classes/classes.module';
import { StudentNavController } from './nav.controller';
import { NavService } from './nav.service';

/** Модуль «nav» (docs/NAV_TZ_2.md): «Мой класс» и счётчики панели ученика (API-S-19…21). */
@Module({
  imports: [ClassesModule, AssignmentsModule],
  controllers: [StudentNavController],
  providers: [NavService],
})
export class NavModule {}
