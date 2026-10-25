import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, gt, ne } from 'drizzle-orm';
import {
  type AvatarPutDto,
  type AvatarUploadUrlDto,
  joinDisplayName,
  PROFILE_LIMITS,
  type ProfilePatchDto,
} from '@syntara/shared';
import { type Database, profileFor, schema } from '@syntara/db';
import { ApiException } from '../../common/api-exception';
import { type Tx } from '../../common/idempotency';
import { AppConfigService } from '../../config/app-config.service';
import { DB } from '../../infra/tokens';
import { AuditService } from '../audit/audit.service';
import { type AuthUser } from '../auth/auth.types';
import { FilesService } from '../files/files.service';
import { type UploadUrlResponse } from '../files/files.dto';
import { AvatarService } from './avatar.service';
import { type ProfileDto } from './profile.dto';

const { users, userProfiles, userRoles, mediaFiles, auditLog, classes, classMemberships, schools } = schema;

/** PH-46 (SPEC 11): значения по умолчанию вопросов PROFILE_TZ 2–6 — TODO(OWNER). */
export interface ProfileConfig {
  student_can_change_name: boolean;
  student_can_change_login: boolean;
  student_about: boolean;
  school_editable: boolean;
  notifications_section: boolean;
}

const DAY_MS = 86_400_000;
const AUDIT = {
  name: 'profile.name',
  avatar: 'profile.avatar',
  upload: 'profile.avatar_upload',
} as const;

type ProfileRow = typeof userProfiles.$inferSelect;
export type ProfileRole = 'student' | 'teacher';

/** Активная роль профиля: выбранная (cookie API-ME-03), если она учебная и есть у пользователя. */
export function profileRole(roles: readonly string[], preferred: string | undefined): ProfileRole {
  if ((preferred === 'student' || preferred === 'teacher') && roles.includes(preferred)) return preferred;
  return roles.includes('student') ? 'student' : 'teacher';
}

/**
 * Профиль (SPEC 5.11, 7.15; API-ME-06…09). Только свой профиль: id берётся из сессии, чужого профиля нет ни в одной
 * операции (BR-PRF-09). Имя меняется вместе с users.display_name в одной транзакции (BR-PRF-01).
 */
@Injectable()
export class ProfileService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly avatars: AvatarService,
    private readonly files: FilesService,
    private readonly audit: AuditService,
    private readonly config: AppConfigService,
  ) {}

  /** API-ME-06. `role` — активная роль (API-ME-03): бейдж роли в карточке профиля. */
  async get(user: AuthUser, role: ProfileRole, db: Tx | Database = this.db): Promise<ProfileDto> {
    const isTeacher = user.roles.includes('teacher');
    const settings = await this.config.get<ProfileConfig>('profile');
    const [account] = await db
      .select({
        login: users.login,
        email: users.email,
        verifiedAt: users.emailVerifiedAt,
        createdAt: users.createdAt,
        lastLoginAt: users.lastLoginAt,
        displayName: users.displayName,
      })
      .from(users)
      .where(eq(users.id, user.id));
    const profile = (await this.row(user.id, db)) ?? profileFor(user.id, account!.displayName);
    const [photo] = profile.avatarMediaId
      ? await db
          .select({ status: mediaFiles.scanStatus })
          .from(mediaFiles)
          .where(eq(mediaFiles.id, profile.avatarMediaId))
      : [];
    const avatar = (await this.avatars.forUser(user.id, db))!;
    const changes = await this.nameChanges(user.id, db);
    const left = Math.max(0, PROFILE_LIMITS.nameChanges - changes.length);
    return {
      firstName: profile.firstName,
      lastName: profile.lastName ?? null,
      position: isTeacher ? (profile.position ?? null) : null,
      about: isTeacher ? (profile.about ?? null) : null,
      avatar: { ...avatar, photoStatus: profile.avatarKind === 'photo' ? (photo?.status ?? null) : null },
      login: account!.login,
      email: account!.email,
      emailVerified: account!.email ? account!.verifiedAt !== null : null,
      school: await this.school(user, db),
      role,
      createdAt: account!.createdAt.toISOString(),
      lastLoginAt: account!.lastLoginAt?.toISOString() ?? null,
      nameEditable: isTeacher || settings.student_can_change_name,
      nameChangesLeft: left,
      nameChangeAvailableAt:
        left === 0
          ? new Date(changes[0]!.getTime() + PROFILE_LIMITS.nameChangeWindowDays * DAY_MS).toISOString()
          : null,
      canRemoveEmail: !isTeacher && account!.login !== null && account!.email !== null,
      canUploadPhoto: isTeacher,
    };
  }

  /**
   * API-ME-07 (BR-PRF-01, BR-PRF-04): имя сразу и везде (users.display_name), не чаще 3 раз за 30 дней — 429 с
   * retryAfterSeconds; «Должность» и «О себе» — только учитель.
   */
  async patch(user: AuthUser, role: ProfileRole, dto: ProfilePatchDto): Promise<ProfileDto> {
    const isTeacher = user.roles.includes('teacher');
    if (!isTeacher && (dto.position !== undefined || dto.about !== undefined)) {
      throw new ApiException(HttpStatus.BAD_REQUEST, 'VALIDATION_FAILED', 'Teacher-only fields', {
        ...(dto.position !== undefined ? { position: 'notAllowed' } : {}),
        ...(dto.about !== undefined ? { about: 'notAllowed' } : {}),
      });
    }
    return this.db.transaction(async (tx) => {
      const current = await this.lockRow(tx, user.id);
      const firstName = dto.firstName ?? current.firstName;
      const lastName = dto.lastName === undefined ? current.lastName : dto.lastName || null;
      const nameChanged = firstName !== current.firstName || lastName !== current.lastName;
      if (nameChanged) {
        const settings = await this.config.get<ProfileConfig>('profile');
        if (!isTeacher && !settings.student_can_change_name) {
          throw new ApiException(HttpStatus.FORBIDDEN, 'FORBIDDEN', 'Name change is disabled', {
            firstName: 'nameNotEditable',
          });
        }
        const changes = await this.nameChanges(user.id, tx);
        if (changes.length >= PROFILE_LIMITS.nameChanges) {
          const at = changes[0]!.getTime() + PROFILE_LIMITS.nameChangeWindowDays * DAY_MS;
          throw new ApiException(
            HttpStatus.TOO_MANY_REQUESTS,
            'RATE_LIMITED',
            'Name change limit',
            { firstName: 'nameChangeLimit' },
            Math.max(1, Math.ceil((at - Date.now()) / 1000)),
          );
        }
      }
      await tx
        .update(userProfiles)
        .set({
          firstName,
          lastName,
          ...(dto.position !== undefined ? { position: dto.position || null } : {}),
          ...(dto.about !== undefined ? { about: dto.about || null } : {}),
        })
        .where(eq(userProfiles.userId, user.id));
      if (nameChanged) {
        const [before] = await tx
          .select({ displayName: users.displayName })
          .from(users)
          .where(eq(users.id, user.id));
        const displayName = joinDisplayName(firstName, lastName);
        await tx.update(users).set({ displayName }).where(eq(users.id, user.id));
        await this.audit.record(
          {
            actorId: user.id,
            entityType: 'user',
            entityId: user.id,
            action: AUDIT.name,
            before: { displayName: before?.displayName },
            after: { displayName },
          },
          tx,
        );
      }
      return this.get({ ...user, displayName: joinDisplayName(firstName, lastName) }, role, tx);
    });
  }

  /**
   * API-ME-08 (BR-PRF-03): только учитель; не более 5 загрузок за 24 часа (счёт — по журналу аудита, удалённые
   * картинки тоже учитываются).
   */
  async uploadUrl(user: AuthUser, dto: AvatarUploadUrlDto): Promise<UploadUrlResponse> {
    if (!user.roles.includes('teacher')) {
      throw new ApiException(HttpStatus.FORBIDDEN, 'FORBIDDEN', 'Only a teacher uploads a picture');
    }
    return this.db.transaction(async (tx) => {
      // Блокировка профиля: параллельные запросы не обойдут лимит.
      await this.lockRow(tx, user.id);
      const since = new Date(Date.now() - PROFILE_LIMITS.photoUploadWindowHours * 3_600_000);
      const uploads = await tx
        .select({ at: auditLog.createdAt })
        .from(auditLog)
        .where(
          and(
            eq(auditLog.entityType, 'user'),
            eq(auditLog.entityId, user.id),
            eq(auditLog.action, AUDIT.upload),
            gt(auditLog.createdAt, since),
          ),
        )
        .orderBy(asc(auditLog.createdAt));
      if (uploads.length >= PROFILE_LIMITS.photoUploads) {
        const at = uploads[0]!.at.getTime() + PROFILE_LIMITS.photoUploadWindowHours * 3_600_000;
        throw new ApiException(
          HttpStatus.TOO_MANY_REQUESTS,
          'RATE_LIMITED',
          'Avatar upload limit',
          { file: 'avatarUploadLimit' },
          Math.max(1, Math.ceil((at - Date.now()) / 1000)),
        );
      }
      const response = await this.files.avatarUploadUrl(tx, user.id, dto);
      await this.audit.record(
        {
          actorId: user.id,
          entityType: 'user',
          entityId: user.id,
          action: AUDIT.upload,
          after: { mediaId: response.mediaId },
        },
        tx,
      );
      return response;
    });
  }

  /**
   * API-ME-09 (BR-PRF-02/03): инициалы с цветом, аватар набора или своя картинка учителя (своя, kind = 'avatar', не
   * отклонённая; пока проверяется — показываются инициалы). Прежняя картинка удаляется вместе с объектами.
   */
  async putAvatar(user: AuthUser, role: ProfileRole, dto: AvatarPutDto): Promise<ProfileDto> {
    if (dto.kind === 'photo' && !user.roles.includes('teacher')) {
      throw new ApiException(HttpStatus.FORBIDDEN, 'FORBIDDEN', 'Only a teacher uses a picture');
    }
    return this.db.transaction(async (tx) => {
      const current = await this.lockRow(tx, user.id);
      if (dto.kind === 'photo') {
        const [media] = await tx
          .select({ id: mediaFiles.id })
          .from(mediaFiles)
          .where(
            and(
              eq(mediaFiles.id, dto.mediaId!),
              eq(mediaFiles.ownerId, user.id),
              eq(mediaFiles.kind, 'avatar'),
              ne(mediaFiles.scanStatus, 'rejected'),
            ),
          );
        if (!media) throw new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Not found');
      }
      const mediaId = dto.kind === 'photo' ? dto.mediaId! : null;
      await tx
        .update(userProfiles)
        .set({
          avatarKind: dto.kind,
          avatarPreset: dto.kind === 'preset' ? dto.preset! : null,
          avatarMediaId: mediaId,
          ...(dto.color ? { avatarColor: dto.color } : {}),
        })
        .where(eq(userProfiles.userId, user.id));
      if (current.avatarMediaId && current.avatarMediaId !== mediaId) {
        await this.dropPhoto(tx, current.avatarMediaId);
      }
      await this.audit.record(
        {
          actorId: user.id,
          entityType: 'user',
          entityId: user.id,
          action: AUDIT.avatar,
          before: { kind: current.avatarKind, preset: current.avatarPreset, mediaId: current.avatarMediaId },
          after: { kind: dto.kind, preset: dto.preset ?? null, mediaId },
        },
        tx,
      );
      return this.get(user, role, tx);
    });
  }

  /**
   * BR-PRF-06 (API-SUP-09): сотрудник поддержки сбрасывает картинку-аватар пользователя на инициалы; картинка
   * удаляется вместе с объектами, запись — в журнал аудита. Картинки нет — 404.
   */
  async resetPhoto(userId: string, actorId: string, reason: { ticketId: string }): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [profile] = await tx
        .select()
        .from(userProfiles)
        .where(eq(userProfiles.userId, userId))
        .for('update');
      if (!profile || profile.avatarKind !== 'photo' || !profile.avatarMediaId) {
        throw new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Not found');
      }
      await tx
        .update(userProfiles)
        .set({ avatarKind: 'initials', avatarPreset: null, avatarMediaId: null })
        .where(eq(userProfiles.userId, userId));
      await this.dropPhoto(tx, profile.avatarMediaId);
      await this.audit.record(
        {
          actorId,
          entityType: 'user',
          entityId: userId,
          action: 'profile.avatar_reset',
          before: { kind: 'photo', mediaId: profile.avatarMediaId },
          after: { kind: 'initials', ticketId: reason.ticketId },
        },
        tx,
      );
    });
  }

  /** Есть ли у пользователя картинка-аватар (карточка обращения, API-SUP-02). */
  async hasPhoto(userId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ kind: userProfiles.avatarKind, mediaId: userProfiles.avatarMediaId })
      .from(userProfiles)
      .where(eq(userProfiles.userId, userId));
    return row?.kind === 'photo' && row.mediaId !== null;
  }

  /** Картинка больше не аватар: запись удаляется, объекты 256 и 64 px — задачей worker после фиксации. */
  async dropPhoto(tx: Tx, mediaId: string): Promise<void> {
    const [media] = await tx.delete(mediaFiles).where(eq(mediaFiles.id, mediaId)).returning();
    if (media) await this.files.enqueueDelete(tx, [media.storageKey, `${media.storageKey}-64`]);
  }

  /** Строка профиля под блокировкой; нет строки (служебный пользователь, импорт) — создаётся из display_name. */
  async lockRow(tx: Tx, userId: string): Promise<ProfileRow> {
    const [existing] = await tx
      .select()
      .from(userProfiles)
      .where(eq(userProfiles.userId, userId))
      .for('update');
    if (existing) return existing;
    const [account] = await tx
      .select({ displayName: users.displayName })
      .from(users)
      .where(eq(users.id, userId));
    await tx.insert(userProfiles).values(profileFor(userId, account!.displayName)).onConflictDoNothing();
    const [created] = await tx
      .select()
      .from(userProfiles)
      .where(eq(userProfiles.userId, userId))
      .for('update');
    return created!;
  }

  private async row(userId: string, db: Tx | Database): Promise<ProfileRow | undefined> {
    const [row] = await db.select().from(userProfiles).where(eq(userProfiles.userId, userId));
    return row;
  }

  /** Изменения имени за 30 дней (BR-PRF-01), старые первыми. */
  private async nameChanges(userId: string, db: Tx | Database): Promise<Date[]> {
    const since = new Date(Date.now() - PROFILE_LIMITS.nameChangeWindowDays * DAY_MS);
    const rows = await db
      .select({ at: auditLog.createdAt })
      .from(auditLog)
      .where(
        and(
          eq(auditLog.entityType, 'user'),
          eq(auditLog.entityId, userId),
          eq(auditLog.action, AUDIT.name),
          gt(auditLog.createdAt, since),
        ),
      )
      .orderBy(asc(auditLog.createdAt));
    return rows.map((r) => r.at);
  }

  /**
   * Школа профиля (REQ-PRF-02, только просмотр — BR-PRF-05): ученик — школа действующего класса, иначе указанная при
   * регистрации (user_roles); учитель — школа роли.
   */
  private async school(user: AuthUser, db: Tx | Database): Promise<{ name: string } | null> {
    if (user.roles.includes('student')) {
      const [fromClass] = await db
        .select({ name: schools.name })
        .from(classMemberships)
        .innerJoin(classes, eq(classes.id, classMemberships.classId))
        .innerJoin(schools, eq(schools.id, classes.schoolId))
        .where(and(eq(classMemberships.studentId, user.id), eq(classMemberships.status, 'active')))
        .limit(1);
      if (fromClass) return fromClass;
    }
    const [fromRole] = await db
      .select({ name: schools.name })
      .from(userRoles)
      .innerJoin(schools, eq(schools.id, userRoles.schoolId))
      .where(eq(userRoles.userId, user.id))
      .orderBy(asc(userRoles.role))
      .limit(1);
    return fromRole ?? null;
  }
}
