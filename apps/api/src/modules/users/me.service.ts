import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { type Locale } from '@syntara/shared';
import { type Database, schema } from '@syntara/db';
import { DB } from '../../infra/tokens';
import { type AuthUser } from '../auth/auth.types';
import { type MeDto } from './me.dto';

/** Инициалы для аватара: первые буквы первых двух слов имени. */
export function initialsOf(displayName: string): string {
  return displayName
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w.charAt(0).toUpperCase())
    .join('');
}

@Injectable()
export class MeService {
  constructor(@Inject(DB) private readonly db: Database) {}

  async me(user: AuthUser): Promise<MeDto> {
    const [prefs] = await this.db
      .select()
      .from(schema.userPreferences)
      .where(eq(schema.userPreferences.userId, user.id));
    return {
      id: user.id,
      displayName: user.displayName,
      initials: initialsOf(user.displayName),
      roles: user.roles,
      // Выбор активной роли (API-ME-03) — итерация 6; до этого — первая роль по порядку 5.2.
      activeRole: user.roles[0]!,
      preferences: {
        locale: (prefs?.locale ?? 'ru') as Locale,
        theme: prefs?.theme ?? 'system',
        dataSaver: prefs?.dataSaver ?? false,
      },
    };
  }
}
