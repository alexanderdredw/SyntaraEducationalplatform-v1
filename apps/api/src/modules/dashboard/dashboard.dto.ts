import { ApiProperty } from '@nestjs/swagger';
import { StudentAssignmentDto } from '../assignments/assignments.dto';
import { AvatarDto } from '../profiles/profile.dto';
import { NextStepDto } from '../results/results.dto';

class DashboardAchievementsDto {
  @ApiProperty() level: number;
  @ApiProperty() rankTitle: string;
  @ApiProperty() xpTotal: number;
  @ApiProperty() xpToNext: number;
  @ApiProperty() xpPerLevel: number;
  @ApiProperty() streakDays: number;
  /** REQ-PRF-20.4: строка цифр шапки. */
  @ApiProperty({ description: 'Освоено тем (mastered_at) — всего' }) masteredTopics: number;
  @ApiProperty() badgesEarned: number;
  @ApiProperty() badgesTotal: number;
}

class DashboardProgressDto {
  @ApiProperty() mastered: number;
  @ApiProperty() total: number;
  @ApiProperty() percent: number;
}

class DashboardTeacherRef {
  @ApiProperty() name: string;
  @ApiProperty({ type: AvatarDto }) avatar: AvatarDto;
}

class DashboardClassDto {
  @ApiProperty() name: string;
  @ApiProperty({ type: DashboardTeacherRef }) teacher: DashboardTeacherRef;
}

class DashboardBadgeDto {
  @ApiProperty() code: string;
  @ApiProperty() title: string;
  @ApiProperty({ type: String, nullable: true }) imageUrl: string | null;
  @ApiProperty({ format: 'date-time' }) earnedAt: string;
}

class DashboardLastBattleDto {
  @ApiProperty({ format: 'uuid' }) sessionId: string;
  @ApiProperty() title: string;
  @ApiProperty({ type: Number, nullable: true }) place: number | null;
  @ApiProperty() correct: number;
  @ApiProperty() total: number;
  @ApiProperty({ format: 'date-time' }) finishedAt: string;
}

/** REQ-PRF-03: «Обзор» ученика. */
export class StudentDashboardDto {
  @ApiProperty({ type: DashboardAchievementsDto }) achievements: DashboardAchievementsDto;
  @ApiProperty({ type: DashboardProgressDto, description: 'За 30 дней — как API-S-14 period=30d' })
  progress: DashboardProgressDto;
  @ApiProperty({ type: NextStepDto, description: '«С чего начать сейчас?» (BR-ST-06)' })
  nextStep: NextStepDto;
  @ApiProperty({ type: DashboardClassDto, nullable: true }) class: DashboardClassDto | null;
  @ApiProperty({
    type: StudentAssignmentDto,
    isArray: true,
    description: 'До 3 несданных, ближайший срок — первым',
  })
  assignments: StudentAssignmentDto[];
  @ApiProperty({ type: DashboardBadgeDto, isArray: true, description: 'До 3 последних полученных' })
  badges: DashboardBadgeDto[];
  @ApiProperty({ type: DashboardLastBattleDto, nullable: true }) lastBattle: DashboardLastBattleDto | null;
}

class TeacherCountsDto {
  @ApiProperty() classes: number;
  @ApiProperty() students: number;
  @ApiProperty() subjects: number;
  @ApiProperty() publishedTopics: number;
  @ApiProperty({ description: 'Завершённых игр Battle (ведущий)' }) battlesHosted: number;
}

class TeacherReviewDto {
  @ApiProperty({ description: 'Очередь ручной проверки включена (PH-29)' }) enabled: boolean;
  @ApiProperty() count: number;
}

class TeacherAttentionDto {
  @ApiProperty({ format: 'uuid' }) classId: string;
  @ApiProperty() className: string;
  @ApiProperty({ format: 'uuid' }) studentId: string;
  @ApiProperty() name: string;
  @ApiProperty({ type: AvatarDto }) avatar: AvatarDto;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) lastActivityAt: string | null;
  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'Дней без активности; null — ещё не занимался (REQ-PRF-25)',
  })
  daysInactive: number | null;
}

class TeacherDeadlineDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ format: 'uuid' }) classId: string;
  @ApiProperty({ description: 'Сдано (REQ-PRF-25: «Сдано X из Y»)' }) submitted: number;
  @ApiProperty({ description: 'Учеников в классе' }) total: number;
  @ApiProperty() topicTitle: string;
  @ApiProperty() className: string;
  @ApiProperty({ format: 'date-time' }) dueAt: string;
}

class TeacherBattleDto {
  @ApiProperty({ format: 'uuid' }) sessionId: string;
  @ApiProperty() title: string;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) finishedAt: string | null;
  @ApiProperty() participants: number;
}

/** REQ-PRF-04: «Обзор» учителя. */
export class TeacherDashboardDto {
  @ApiProperty({ type: TeacherCountsDto }) counts: TeacherCountsDto;
  @ApiProperty({ type: TeacherReviewDto }) review: TeacherReviewDto;
  @ApiProperty({
    type: TeacherAttentionDto,
    isArray: true,
    description: 'До 5 — блок «Требуют внимания» аналитики',
  })
  attention: TeacherAttentionDto[];
  @ApiProperty({ type: TeacherDeadlineDto, isArray: true, description: 'До 5 ближайших сроков' })
  deadlines: TeacherDeadlineDto[];
  @ApiProperty({ type: TeacherBattleDto, isArray: true, description: 'До 3 последних завершённых игр' })
  battles: TeacherBattleDto[];
}

/** API-ME-12: сводка «Обзор» по активной роли — заполнена ровно одна часть. */
export class DashboardDto {
  @ApiProperty({ enum: ['student', 'teacher'] }) role: 'student' | 'teacher';
  @ApiProperty({ type: StudentDashboardDto, nullable: true }) student: StudentDashboardDto | null;
  @ApiProperty({ type: TeacherDashboardDto, nullable: true }) teacher: TeacherDashboardDto | null;
}

class ActivityDayDto {
  @ApiProperty({ format: 'date' }) date: string;
  @ApiProperty() count: number;
}

/** API-ME-15 (REQ-PRF-21) */
export class ActivityDto {
  @ApiProperty({ format: 'date' }) from: string;
  @ApiProperty({ format: 'date' }) to: string;
  @ApiProperty({ type: ActivityDayDto, isArray: true }) days: ActivityDayDto[];
  @ApiProperty() activeDays: number;
  @ApiProperty({ description: 'Самая длинная серия активных дней в окне' }) longestStreak: number;
}
