import { HttpStatus, Inject, Injectable, Module } from '@nestjs/common';
import { createHmac, randomInt } from 'node:crypto';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import {
  BATTLE_CODE_RE,
  type ClassCodeConfig,
  isWellFormedClassCode,
  normalizeClassCode,
} from '@syntara/shared';
import { type Database, schema } from '@syntara/db';
import { ApiException } from '../../common/api-exception';
import { isUniqueViolation, type Tx } from '../../common/idempotency';
import { AppConfigService } from '../../config/app-config.service';
import { ENV, type Env } from '../../config/env';
import { DB } from '../../infra/tokens';
import { BattleCodes, BattleCodesModule } from '../battle/battle-codes.service';

export interface ActiveCode {
  classId: string;
  className: string;
  schoolId: string | null;
}

/** Повторы генерации кода при коллизии (BR-CODE-03 — в пределах тех же 10 попыток). */
const CODE_ATTEMPTS = 10;

/**
 * Коды классов (BR-CLS-01, PH-07): 6 символов из алфавита PH-07, срок 30 дней; в БД — только хеш
 * SHA-256 с солью (HMAC с серверным секретом), поэтому код нельзя восстановить из базы.
 * Код показывается учителю один раз при выпуске.
 */
@Injectable()
export class ClassCodesService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(ENV) private readonly env: Env,
    private readonly config: AppConfigService,
    private readonly battleCodes: BattleCodes,
  ) {}

  hash(code: string): Buffer {
    return createHmac('sha256', this.env.SESSION_SECRET).update(`class-code:${code}`).digest();
  }

  /**
   * BR-CODE-03: новый код класса никогда не имеет вид кода Battle (`^[A-Z]{3}[1-9]{3}$`) и не совпадает с кодом
   * активной сессии Battle — такой код отбрасывается и генерируется заново; после 10 попыток — 503.
   */
  async issue(classId: string, createdBy: string): Promise<{ code: string; expiresAt: Date }> {
    const cfg = await this.config.get<ClassCodeConfig>('class.code');
    const expiresAt = new Date(Date.now() + cfg.ttl_days * 24 * 60 * 60 * 1000);
    for (let attempt = 0; attempt < CODE_ATTEMPTS; attempt++) {
      const code = Array.from(
        { length: cfg.length },
        () => cfg.alphabet[randomInt(0, cfg.alphabet.length)],
      ).join('');
      if (BATTLE_CODE_RE.test(code) || (await this.battleCodes.isActiveCode(code))) continue;
      try {
        await this.db
          .insert(schema.classInviteCodes)
          .values({ classId, codeHash: this.hash(code), expiresAt, createdBy });
        return { code, expiresAt };
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
      }
    }
    throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE, 'SERVICE_UNAVAILABLE', 'No free class code');
  }

  /** Действующий код (BR-CLS-01): нормализация ввода, формат PH-07, срок, активность, класс не в архиве. */
  async findActive(raw: string, tx: Tx | Database = this.db): Promise<ActiveCode | null> {
    const cfg = await this.config.get<ClassCodeConfig>('class.code');
    const code = normalizeClassCode(raw);
    if (!isWellFormedClassCode(code, cfg)) return null;
    const { classInviteCodes: c, classes } = schema;
    const [row] = await tx
      .select({ classId: classes.id, className: classes.name, schoolId: classes.schoolId })
      .from(c)
      .innerJoin(classes, eq(classes.id, c.classId))
      .where(
        and(
          eq(c.codeHash, this.hash(code)),
          eq(c.isActive, true),
          gt(c.expiresAt, sql`now()`),
          isNull(classes.archivedAt),
        ),
      );
    return row ?? null;
  }

  /**
   * BR-CODE-01/03: проверка «код занят» для подсистемы Battle — только чтение, сравнение HMAC-хеша.
   * Отвечает лишь, действует ли такой код класса; данных класса не возвращает.
   */
  async isActiveCode(raw: string): Promise<boolean> {
    return (await this.findActive(raw)) !== null;
  }
}

/** Коды классов — отдельный модуль: его импортируют classes и battle (проверка «код занят»). */
@Module({
  imports: [BattleCodesModule],
  providers: [ClassCodesService],
  exports: [ClassCodesService],
})
export class ClassCodesModule {}
