import { Module } from '@nestjs/common';
import { AssignmentsModule } from '../assignments/assignments.module';
import { ContentModule } from '../content/content.module';
import { StudentResultsController, TeacherAnalyticsController } from './results.controller';
import { ResultsService } from './results.service';

/** Модуль «results» (раздел 2.2 SPEC): показатели, достижения ученика и аналитика класса (итерация 10). */
@Module({
  imports: [ContentModule, AssignmentsModule],
  controllers: [TeacherAnalyticsController, StudentResultsController],
  providers: [ResultsService],
})
export class ResultsModule {}
