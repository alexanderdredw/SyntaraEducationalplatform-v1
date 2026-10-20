import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { BattleCodesModule } from '../battle/battle-codes.service';
import { UsersModule } from '../users/users.module';
import { ClassCodesModule } from './class-codes.service';
import { JoinController, StudentClassController, TeacherClassesController } from './classes.controller';
import { ClassesService } from './classes.service';

/** Модуль «classes» (раздел 2.2 SPEC): классы, коды, вступление и выход (7.7). */
@Module({
  imports: [AuditModule, AuthModule, UsersModule, ClassCodesModule, BattleCodesModule],
  controllers: [TeacherClassesController, StudentClassController, JoinController],
  providers: [ClassesService],
  exports: [ClassesService],
})
export class ClassesModule {}
