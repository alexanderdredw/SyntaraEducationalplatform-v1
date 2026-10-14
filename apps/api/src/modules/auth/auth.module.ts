import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { RolesGuard, SessionGuard } from './auth.guards';
import { AuthService } from './auth.service';
import { SessionService } from './session.service';

/** Модуль «auth» (раздел 2.2 SPEC): вход, сессии, CSRF, роли (итерация 4 — минимальное ядро, Q-01). */
@Module({
  imports: [UsersModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    SessionService,
    // Порядок важен: сначала сессия и CSRF, затем роли.
    { provide: APP_GUARD, useClass: SessionGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
  exports: [SessionService],
})
export class AuthModule {}
