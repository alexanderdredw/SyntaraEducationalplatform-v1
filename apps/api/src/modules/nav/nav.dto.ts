import { ApiProperty } from '@nestjs/swagger';
import { NAV_SECTIONS } from '@syntara/shared';
import { StudentAssignmentDto } from '../assignments/assignments.dto';
import { StudentClassDto } from '../classes/classes.dto';

/** API-S-19: предмет, выданный классу (REQ-NAV-11). */
export class ClassSubjectDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() title: string;
  @ApiProperty({ type: String, nullable: true }) description: string | null;
  @ApiProperty({ description: 'Опубликованные темы' }) topicsTotal: number;
  @ApiProperty({ description: 'Освоенные учеником темы (≥ порога PH-38)' }) topicsMastered: number;
  @ApiProperty({ description: 'Выдан классу после последнего открытия «Мой класс» (REQ-NAV-14)' })
  isNew: boolean;
}

/** API-S-19 */
export class ClassOverviewDto {
  @ApiProperty({ type: StudentClassDto, nullable: true }) class: StudentClassDto | null;
  @ApiProperty({ type: ClassSubjectDto, isArray: true }) subjects: ClassSubjectDto[];
  @ApiProperty({
    type: StudentAssignmentDto,
    isArray: true,
    description: 'До 3 незавершённых заданий, ближайший срок — первым',
  })
  upcomingAssignments: StudentAssignmentDto[];
}

/** API-S-20 */
export class NavBadgesDto {
  @ApiProperty({ description: 'Задания без сдачи, включая просроченные' }) assignmentsOpen: number;
  @ApiProperty({ description: 'Из них просроченные' }) assignmentsOverdue: number;
  @ApiProperty() classHasNew: boolean;
  @ApiProperty() achievementsHasNew: boolean;
}

/** API-S-21 */
export class NavSeenBody {
  @ApiProperty({ enum: NAV_SECTIONS }) section: string;
}
