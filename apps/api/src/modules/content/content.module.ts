import { Module } from '@nestjs/common';
import { VisibilityService } from './visibility.service';

/** Модуль «content» (раздел 2.2 SPEC): видимость учебного контента (BR-VIS-01); редактор — итерация 7. */
@Module({
  providers: [VisibilityService],
  exports: [VisibilityService],
})
export class ContentModule {}
