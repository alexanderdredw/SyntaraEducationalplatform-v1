import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { OwnershipGuard } from '../content/ownership.guard';
import { FilesController, GalleryController } from './files.controller';
import { FilesService } from './files.service';
import { PUBLIC_ONLY, REMOTE_ADDRESS_POLICY, RemoteImageFetcher } from './remote-image';
import { StorageService } from './storage.service';

/** Модуль «files» (раздел 2.2 SPEC): загрузка, лимиты и выдача файлов (7.8). */
@Module({
  imports: [AuditModule],
  controllers: [FilesController, GalleryController],
  providers: [
    FilesService,
    StorageService,
    OwnershipGuard,
    RemoteImageFetcher,
    { provide: REMOTE_ADDRESS_POLICY, useValue: PUBLIC_ONLY },
  ],
  exports: [StorageService, FilesService],
})
export class FilesModule {}
