import { ApiProperty } from '@nestjs/swagger';
import { PROGRESS_PERIODS, type ProgressPeriod, type TopicColor } from '@syntara/shared';

class EngagementDto {
  @ApiProperty() active: number;
  @ApiProperty() total: number;
  @ApiProperty({ description: 'Окно активности, дней (PH-30 inactive_days)' }) windowDays: number;
}

class WeakTopicDto {
  @ApiProperty({ format: 'uuid' }) topicId: string;
  @ApiProperty() title: string;
  @ApiProperty({ description: 'Учеников класса с попытками' }) students: number;
  @ApiProperty({ description: 'Среднее best_percent, %' }) percent: number;
  @ApiProperty({ enum: ['red', 'blue', 'green'] }) color: TopicColor;
}

class AttentionDto {
  @ApiProperty({ format: 'uuid' }) studentId: string;
  @ApiProperty() name: string;
  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    description: 'null — событий ещё не было',
  })
  lastActivityAt: string | null;
  @ApiProperty({ enum: ['inactive'] }) reason: 'inactive';
}

/** API-T-25 */
export class ClassAnalyticsDto {
  @ApiProperty({ description: 'Средняя успеваемость, % (BR-AN-02)' }) avgPercent: number;
  @ApiProperty({ type: EngagementDto }) engagement: EngagementDto;
  @ApiProperty({ type: WeakTopicDto, isArray: true }) weakTopics: WeakTopicDto[];
  @ApiProperty({ type: AttentionDto, isArray: true }) attention: AttentionDto[];
}

class DayRangeDto {
  @ApiProperty({ format: 'date' }) from: string;
  @ApiProperty({ format: 'date' }) to: string;
}

/** BR-ST-06: следующий шаг; тексты «Что делать» и «Почему» — в интерфейсе по action и reason. */
export class NextStepDto {
  @ApiProperty({ enum: ['assignment', 'improve_topic', 'next_topic', 'catalog'] })
  action: 'assignment' | 'improve_topic' | 'next_topic' | 'catalog';
  @ApiProperty({ enum: ['assignment_due', 'below_mastery', 'continue', 'start'] })
  reason: 'assignment_due' | 'below_mastery' | 'continue' | 'start';
  @ApiProperty({ description: 'Внутренний маршрут без префикса языка' }) href: string;
  @ApiProperty({ type: String, nullable: true }) topicTitle: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) dueAt: string | null;
  @ApiProperty({ type: Number, nullable: true, description: 'Лучший результат темы, %' }) percent:
    number | null;
}

class ProgressValueDto {
  @ApiProperty() mastered: number;
  @ApiProperty() total: number;
  @ApiProperty() percent: number;
  @ApiProperty({ description: 'Изменение процента к концу периода сравнения, п. п.' }) deltaPercent: number;
}

class StreakDto {
  @ApiProperty() days: number;
  @ApiProperty({ type: String, format: 'date', nullable: true }) lastActivityDate: string | null;
  @ApiProperty() delta: number;
}

/** API-S-14 */
export class ProgressDto {
  @ApiProperty({ enum: PROGRESS_PERIODS }) period: ProgressPeriod;
  @ApiProperty({ enum: PROGRESS_PERIODS, isArray: true, description: 'Четверть — только если задана (Q-23)' })
  availablePeriods: ProgressPeriod[];
  @ApiProperty({ type: DayRangeDto }) range: DayRangeDto;
  @ApiProperty({ type: DayRangeDto }) compareRange: DayRangeDto;
  @ApiProperty({ type: NextStepDto }) nextStep: NextStepDto;
  @ApiProperty({ type: ProgressValueDto }) progress: ProgressValueDto;
  @ApiProperty({ type: StreakDto }) streak: StreakDto;
}

class BadgeDto {
  @ApiProperty() code: string;
  @ApiProperty() title: string;
  @ApiProperty() condition: string;
  @ApiProperty({ type: String, nullable: true }) imageUrl: string | null;
  @ApiProperty() earned: boolean;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) earnedAt: string | null;
}

/** API-S-15 */
export class AchievementsDto {
  @ApiProperty() level: number;
  @ApiProperty() rankTitle: string;
  @ApiProperty() xpTotal: number;
  @ApiProperty() xpToNext: number;
  @ApiProperty({ description: 'XP на уровень (PH-39 per_level) — для полосы прогресса' }) xpPerLevel: number;
  @ApiProperty() streakDays: number;
  @ApiProperty({ type: BadgeDto, isArray: true }) badges: BadgeDto[];
  @ApiProperty() earnedCount: number;
  @ApiProperty() totalCount: number;
}
