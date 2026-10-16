import { Module } from '@nestjs/common';
import { OwnershipGuard } from '../content/ownership.guard';
import { TeacherQuizController } from './quiz.controller';
import { QuizService } from './quiz.service';

/** Модуль «quiz» (раздел 2.2 SPEC): вопросы квиза для автора (итерация 7); прохождение — итерация 8. */
@Module({
  controllers: [TeacherQuizController],
  providers: [QuizService, OwnershipGuard],
})
export class QuizModule {}
