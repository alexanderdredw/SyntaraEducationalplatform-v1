import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { AuditModule } from '../audit/audit.module';
import { FilesModule } from '../files/files.module';
import { GamificationModule } from '../gamification/gamification.module';
import { AiDraftService } from './ai-draft.service';
import {
  StudentContentController,
  PublicContentController,
  TeacherSubjectsController,
  TeacherTopicsController,
} from './content.controller';
import { LessonService } from './lesson.service';
import { OwnershipGuard } from './ownership.guard';
import { StudentContentService } from './student-content.service';
import { SubjectsService } from './subjects.service';
import { TopicDeletionService } from './topic-deletion.service';
import { TopicsService } from './topics.service';
import { VisibilityService } from './visibility.service';

/**
 * Модуль «content» (раздел 2.2 SPEC): предметы, выдача классу, темы, публикация и версии (итерация 7);
 * видимость для ученика — единая точка VisibilityService (BR-VIS-01).
 */
@Module({
  imports: [AuditModule, FilesModule, AiModule, GamificationModule],
  controllers: [
    TeacherSubjectsController,
    TeacherTopicsController,
    StudentContentController,
    PublicContentController,
  ],
  providers: [
    VisibilityService,
    OwnershipGuard,
    SubjectsService,
    TopicsService,
    TopicDeletionService,
    LessonService,
    AiDraftService,
    StudentContentService,
  ],
  exports: [VisibilityService, OwnershipGuard, LessonService, StudentContentService],
})
export class ContentModule {}
