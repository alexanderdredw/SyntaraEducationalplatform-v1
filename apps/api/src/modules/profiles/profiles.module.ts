import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { FilesModule } from '../files/files.module';
import { AccountController } from './account.controller';
import { AccountService } from './account.service';
import { AvatarService } from './avatar.service';
import { ProfileController } from './profile.controller';
import { ProfileService } from './profile.service';

/** Модуль «profiles» (SPEC 5.11, 8.7): профиль, аватары (REQ-PRF-11) — общий для кабинетов, классов и Battle. */
@Module({
  imports: [AuditModule, FilesModule],
  controllers: [ProfileController, AccountController],
  providers: [AvatarService, ProfileService, AccountService],
  exports: [AvatarService, ProfileService],
})
export class ProfilesModule {}
