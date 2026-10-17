import { ApiProperty } from '@nestjs/swagger';

/** API-T-22: тело (схема — AssignmentCreateDto в packages/shared). */
export class AssignmentBody {
  @ApiProperty({ format: 'uuid' }) classId: string;
  @ApiProperty({ format: 'uuid' }) subjectId: string;
  @ApiProperty({ format: 'uuid' }) topicId: string;
  @ApiProperty({ format: 'date-time', description: 'Срок сдачи (ISO 8601 с часовым поясом)' }) dueAt: string;
}

export class CreatedDto {
  @ApiProperty({ format: 'uuid' }) id: string;
}

class SubmissionCountsDto {
  @ApiProperty() submitted: number;
  @ApiProperty() inReview: number;
  @ApiProperty() graded: number;
}

/** API-T-23 */
export class TeacherAssignmentDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() topicTitle: string;
  @ApiProperty() className: string;
  @ApiProperty({ format: 'date-time' }) dueAt: string;
  @ApiProperty({ type: SubmissionCountsDto }) counts: SubmissionCountsDto;
}

/** API-T-24: работа на проверку (PH-29 — ручной проверки нет, список пуст). */
export class ReviewItemDto {
  @ApiProperty({ format: 'uuid' }) id: string;
}

class OptionTopicDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() title: string;
}

class OptionSubjectDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() title: string;
  @ApiProperty({ description: 'Базовый предмет платформы' }) official: boolean;
  @ApiProperty({ type: OptionTopicDto, isArray: true }) topics: OptionTopicDto[];
}

/** API-T-28: предметы и темы, которые можно назначить классу. */
export class AssignmentOptionsDto {
  @ApiProperty({ type: OptionSubjectDto, isArray: true }) subjects: OptionSubjectDto[];
}

/** API-S-10 */
export class StudentAssignmentDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ format: 'uuid' }) topicId: string;
  @ApiProperty() topicTitle: string;
  @ApiProperty() subjectTitle: string;
  @ApiProperty({ format: 'date-time' }) dueAt: string;
  @ApiProperty({ enum: ['not_started', 'submitted', 'graded'] }) status:
    'not_started' | 'submitted' | 'graded';
  @ApiProperty({ type: Number, nullable: true, description: 'Оценка, % (лучшая попытка)' }) grade:
    number | null;
  @ApiProperty({ description: 'Срок прошёл, а работа не сдана' }) overdue: boolean;
}
