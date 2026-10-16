import { Module } from '@nestjs/common';
import { OwnershipGuard } from '../content/ownership.guard';
import { FilesController, GalleryController } from './files.controller';
import { FilesService } from './files.service';
import { StorageService } from './storage.service';

/** Модуль «files» (раздел 2.2 SPEC): загрузка, лимиты и выдача файлов (7.8). */
@Module({
  controllers: [FilesController, GalleryController],
  providers: [FilesService, StorageService, OwnershipGuard],
  exports: [StorageService],
})
export class FilesModule {}
