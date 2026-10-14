import { Module } from '@nestjs/common';
import { MeController } from './me.controller';
import { MeService } from './me.service';

/** Модуль «users» (раздел 2.2 SPEC): профиль текущего пользователя (6.3). */
@Module({
  controllers: [MeController],
  providers: [MeService],
  exports: [MeService],
})
export class UsersModule {}
