import { Module } from '@nestjs/common';
import { AssignmentsModule } from '../assignments/assignments.module';
import { ContentModule } from '../content/content.module';
import { OwnershipGuard } from '../content/ownership.guard';
import { GamificationModule } from '../gamification/gamification.module';
import { StudentQuizController } from './student-quiz.controller';
import { StudentQuizService } from './student-quiz.service';
import { TeacherQuizController } from './quiz.controller';
import { QuizService } from './quiz.service';

/** Модуль «quiz» (раздел 2.2 SPEC): вопросы квиза для автора (итерация 7) и прохождение учеником (итерация 8). */
@Module({
  imports: [ContentModule, GamificationModule, AssignmentsModule],
  controllers: [TeacherQuizController, StudentQuizController],
  providers: [QuizService, OwnershipGuard, StudentQuizService],
})
export class QuizModule {}
