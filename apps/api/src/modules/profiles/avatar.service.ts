import { Inject, Injectable } from '@nestjs/common';
import { eq, inArray } from 'drizzle-orm';
import {
  AVATAR_COLORS,
  AVATAR_PRESETS,
  type AvatarColor,
  type AvatarKind,
  type AvatarPreset,
  avatarSmallKey,
  type AvatarView,
  initialsOf,
} from '@syntara/shared';
import { type Database, schema, stableAvatarColor } from '@syntara/db';
import { type Tx } from '../../common/idempotency';
import { DB } from '../../infra/tokens';
import { StorageService } from '../files/storage.service';

const { users, userProfiles, mediaFiles } = schema;

/** Строка профиля и картинки для AvatarView. */
export interface AvatarSource {
  userId: string;
  displayName: string;
  kind: string | null;
  preset: string | null;
  color: string | null;
  photoKey: string | null;
  photoStatus: 'pending' | 'clean' | 'rejected' | null;
}

const isPreset = (v: string | null): v is AvatarPreset => (AVATAR_PRESETS as readonly string[]).includes(v ?? '');
const isColor = (v: string | null): v is AvatarColor => (AVATAR_COLORS as readonly string[]).includes(v ?? '');

/**
 * Аватары для ответов API (6.7 AvatarDto, REQ-PRF-11): инициалы, аватар набора или картинка учителя. Картинка —
 * только чистая и только подписанной ссылкой нашего хранилища (BR-PRF-03, BR-PRF-09); пока она проверяется или
 * отклонена — инициалы. Пользователь без строки профиля (служебный, импорт) — инициалы постоянного цвета.
 * Права на чтение проверяет вызывающий сервис: здесь только представление.
 */
@Injectable()
export class AvatarService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly storage: StorageService,
  ) {}

  /** Аватары пользователей по id (порядок не важен; отсутствующие id — нет в карте). */
  async forUsers(userIds: readonly string[], db: Tx | Database = this.db): Promise<Map<string, AvatarView>> {
    const ids = [...new Set(userIds)];
    const result = new Map<string, AvatarView>();
    if (ids.length === 0) return result;
    const rows = await db
      .select({
        userId: users.id,
        displayName: users.displayName,
        kind: userProfiles.avatarKind,
        preset: userProfiles.avatarPreset,
        color: userProfiles.avatarColor,
        photoKey: mediaFiles.storageKey,
        photoStatus: mediaFiles.scanStatus,
      })
      .from(users)
      .leftJoin(userProfiles, eq(userProfiles.userId, users.id))
      .leftJoin(mediaFiles, eq(mediaFiles.id, userProfiles.avatarMediaId))
      .where(inArray(users.id, ids));
    await Promise.all(rows.map(async (r) => result.set(r.userId, await this.view(r))));
    return result;
  }

  async forUser(userId: string, db: Tx | Database = this.db): Promise<AvatarView | null> {
    return (await this.forUsers([userId], db)).get(userId) ?? null;
  }

  /** Представление одного аватара. Имя — текущее display_name (или имя на момент игры для Battle). */
  async view(source: AvatarSource): Promise<AvatarView> {
    const kind: AvatarKind =
      source.kind === 'preset' && isPreset(source.preset)
        ? 'preset'
        : source.kind === 'photo'
          ? 'photo'
          : 'initials';
    const clean = kind === 'photo' && source.photoStatus === 'clean' && source.photoKey;
    return {
      kind,
      preset: kind === 'preset' && isPreset(source.preset) ? source.preset : null,
      color: isColor(source.color) ? source.color : stableAvatarColor(source.userId),
      initials: initialsOf(source.displayName),
      photoUrl: clean ? await this.storage.downloadUrl(source.photoKey!) : null,
      photoUrlSmall: clean ? await this.storage.downloadUrl(avatarSmallKey(source.photoKey!)) : null,
    };
  }

  /** Тот же аватар с другим именем (инициалы) — участники Battle показываются с именем на момент игры. */
  withName(avatar: AvatarView, displayName: string): AvatarView {
    return { ...avatar, initials: initialsOf(displayName) };
  }
}
