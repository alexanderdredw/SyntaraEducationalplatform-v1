import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { ClassesModule } from './classes/classes.module';
import { ContentModule } from './content/content.module';
import { QuizModule } from './quiz/quiz.module';
import { AssignmentsModule } from './assignments/assignments.module';
import { ResultsModule } from './results/results.module';
import { GamificationModule } from './gamification/gamification.module';
import { AiModule } from './ai/ai.module';
import { TutorModule } from './ai/tutor.module';
import { SupportModule } from './support/support.module';
import { PublicModule } from './public/public.module';
import { FilesModule } from './files/files.module';
import { AuditModule } from './audit/audit.module';
import { BattleModule } from './battle/battle.module';
import { NavModule } from './nav/nav.module';
import { ProfilesModule } from './profiles/profiles.module';
import { DashboardModule } from './dashboard/dashboard.module';

/** Доменные модули модульного монолита (раздел 2.2 SPEC). */
export const DOMAIN_MODULES = [
  AuthModule,
  UsersModule,
  ClassesModule,
  ContentModule,
  QuizModule,
  AssignmentsModule,
  ResultsModule,
  GamificationModule,
  AiModule,
  TutorModule,
  SupportModule,
  PublicModule,
  FilesModule,
  AuditModule,
  BattleModule,
  NavModule,
  ProfilesModule,
  DashboardModule,
];
