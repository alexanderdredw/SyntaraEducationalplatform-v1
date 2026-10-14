import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { createHmac, randomInt } from 'node:crypto';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import { type ClassCodeConfig, isWellFormedClassCode, normalizeClassCode } from '@syntara/shared';
import { type Database, schema } from '@syntara/db';
import { ApiException } from '../../common/api-exception';
import { isUniqueViolation, type Tx } from '../../common/idempotency';
import { AppConfigService } from '../../config/app-config.service';
import { ENV, type Env } from '../../config/env';
import { DB } from '../../infra/tokens';

export interface ActiveCode {
  classId: string;
  className: string;
  schoolId: string | null;
}

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
  ) {}

  hash(code: string): Buffer {
    return createHmac('sha256', this.env.SESSION_SECRET).update(`class-code:${code}`).digest();
  }

  async issue(classId: string, createdBy: string): Promise<{ code: string; expiresAt: Date }> {
    const cfg = await this.config.get<ClassCodeConfig>('class.code');
    const expiresAt = new Date(Date.now() + cfg.ttl_days * 24 * 60 * 60 * 1000);
    for (let attempt = 0; attempt < 10; attempt++) {
      const code = Array.from(
        { length: cfg.length },
        () => cfg.alphabet[randomInt(0, cfg.alphabet.length)],
      ).join('');
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
}
