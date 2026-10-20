import { Inject, Injectable, Module } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import { BATTLE_CODE_RE, normalizeBattleCode } from '@syntara/shared';
import { type Database, schema } from '@syntara/db';
import { DB } from '../../infra/tokens';

/**
 * BR-CODE-01/03: проверка «код занят» для подсистемы классов — только чтение. Отвечает лишь, есть ли активная
 * сессия Battle (lobby, in_progress) с таким кодом; ничего не сообщает о сессии и ничего не меняет.
 */
@Injectable()
export class BattleCodes {
  constructor(@Inject(DB) private readonly db: Database) {}

  async isActiveCode(raw: string): Promise<boolean> {
    const code = normalizeBattleCode(raw);
    if (!BATTLE_CODE_RE.test(code)) return false;
    const { battleSessions } = schema;
    const [row] = await this.db
      .select({ id: battleSessions.id })
      .from(battleSessions)
      .where(and(eq(battleSessions.code, code), inArray(battleSessions.status, ['lobby', 'in_progress'])))
      .limit(1);
    return row !== undefined;
  }
}

/** Отдельный модуль без зависимостей от классов: его импортируют и battle, и classes (без циклов). */
@Module({ providers: [BattleCodes], exports: [BattleCodes] })
export class BattleCodesModule {}
