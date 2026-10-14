import { Module } from '@nestjs/common';
import { PublicController } from './public.controller';
import { DemoService } from './demo.service';
import { PublicService } from './public.service';

/** Модуль «public» (раздел 2.2 SPEC): операции 6.2 без входа. */
@Module({
  controllers: [PublicController],
  providers: [PublicService, DemoService],
})
export class PublicModule {}
