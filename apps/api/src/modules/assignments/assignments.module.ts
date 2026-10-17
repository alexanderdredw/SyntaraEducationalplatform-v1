import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { ContentModule } from '../content/content.module';
import { StudentAssignmentsController, TeacherAssignmentsController } from './assignments.controller';
import { AssignmentsService } from './assignments.service';

/** Модуль «assignments» (раздел 2.2 SPEC): задания учителя и «Мои задания» ученика (итерация 10). */
@Module({
  imports: [AuditModule, ContentModule],
  controllers: [TeacherAssignmentsController, StudentAssignmentsController],
  providers: [AssignmentsService],
  exports: [AssignmentsService],
})
export class AssignmentsModule {}
