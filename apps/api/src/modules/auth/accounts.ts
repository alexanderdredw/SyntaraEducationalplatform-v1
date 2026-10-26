import { HttpStatus } from '@nestjs/common';
import { type Locale, type UserRole } from '@syntara/shared';
import { and, eq } from 'drizzle-orm';
import { profileFor, schema } from '@syntara/db';
import { ApiException } from '../../common/api-exception';
import { isUniqueViolation, type Tx } from '../../common/idempotency';

export interface NewAccount {
  email: string | null;
  login: string | null;
  displayName: string;
  /** Имя и фамилия, введённые раздельно (учитель, API-AUTH-03); иначе — из displayName. */
  firstName?: string;
  lastName?: string | null;
  passwordHash: string;
  role: UserRole;
  locale: Locale;
  /** Школа роли (user_roles.school_id): из класса (ученик), справочника или введённая вручную. */
  schoolId?: string | null;
}

/** Согласие с условиями и политикой конфиденциальности при регистрации (REQ-NFR-DATA-03, consents). */
export const CONSENT_TERMS_PRIVACY = 'terms_privacy';

/**
 * Создание аккаунта в транзакции: пользователь, роль, предпочтения (язык регистрации), профиль и согласие.
 * Аккаунт без email — child-safe (5.3 CHECK users_email_or_child_safe, PH-44).
 * Занятый email/логин → 409 с ключом ошибки поля.
 */
export async function createAccount(tx: Tx, account: NewAccount): Promise<string> {
  const { users, userRoles, userPreferences, userProfiles, consents } = schema;
  let userId: string;
  try {
    // Точка сохранения: нарушение уникальности не должно обрывать внешнюю транзакцию.
    userId = await tx.transaction(async (sp) => {
      const [user] = await sp
        .insert(users)
        .values({
          email: account.email,
          login: account.login,
          displayName: account.displayName,
          passwordHash: account.passwordHash,
          isChildSafe: account.email === null,
        })
        .returning({ id: users.id });
      return user!.id;
    });
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    const detail = String((err as { cause?: { detail?: string } }).cause?.detail ?? '');
    const field = detail.includes('(login)') ? 'login' : 'email';
    throw new ApiException(HttpStatus.CONFLICT, 'CONFLICT', `${field} is already taken`, {
      [field]: field === 'login' ? 'loginTaken' : 'emailTaken',
    });
  }
  await tx.insert(userRoles).values({ userId, role: account.role, schoolId: account.schoolId ?? null });
  await tx.insert(userPreferences).values({ userId, locale: account.locale });
  // 5.11: профиль — имя и фамилия из введённого имени, аватар — инициалы случайного цвета (BR-PRF-02).
  const profile = profileFor(userId, account.displayName);
  await tx
    .insert(userProfiles)
    .values(
      account.firstName
        ? { ...profile, firstName: account.firstName, lastName: account.lastName || null }
        : profile,
    );
  // TODO(OWNER): согласие родителя для учеников-детей (PH-44 «требует уточнения»); сейчас фиксируется согласие самого пользователя.
  await tx.insert(consents).values({
    userId,
    consentType: CONSENT_TERMS_PRIVACY,
    granted: true,
    grantedBy: userId,
    grantedAt: new Date(),
  });
  return userId;
}

/**
 * Школа из формы регистрации (ученик API-AUTH-03S, учитель API-AUTH-03): из справочника (только status = 'active'),
 * иначе введённая вручную — новая запись schools со статусом 'unverified' («не проверена»); иначе нет.
 */
export async function registrationSchool(
  tx: Tx,
  dto: { schoolId?: string | undefined; schoolName?: string | undefined },
): Promise<string | null> {
  const { schools } = schema;
  if (dto.schoolId) {
    const [school] = await tx
      .select({ id: schools.id })
      .from(schools)
      .where(and(eq(schools.id, dto.schoolId), eq(schools.status, 'active')));
    if (!school) {
      throw new ApiException(HttpStatus.BAD_REQUEST, 'VALIDATION_FAILED', 'Unknown school', {
        schoolId: 'invalidSchool',
      });
    }
    return school.id;
  }
  if (dto.schoolName?.trim()) {
    const [school] = await tx
      .insert(schools)
      .values({ name: dto.schoolName.trim(), status: 'unverified' })
      .returning({ id: schools.id });
    return school!.id;
  }
  return null;
}
