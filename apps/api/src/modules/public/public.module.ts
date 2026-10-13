import { Module } from '@nestjs/common';
import { PublicController } from './public.controller';
import { PublicService } from './public.service';

/** Модуль «public» (раздел 2.2 SPEC): операции 6.2 без входа. */
@Module({
  controllers: [PublicController],
  providers: [PublicService],
})
export class PublicModule {}
