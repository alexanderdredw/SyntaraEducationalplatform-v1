'use client';

import { useTranslations } from 'next-intl';
import { type ReactNode } from 'react';
import { battleDisplayName, initialsOf } from '@syntara/shared';
import { Avatar, type AvatarData, Card, ParticipantChip } from '@syntara/ui';

/**
 * «Как тебя видят другие» (REQ-PRF-26): обновляется сразу при изменениях формы. Ученик — строка в списке класса
 * учителя, строка рейтинга Battle («Асель Н.») и чип лобби; учитель — карточка учителя в «Мой класс».
 * Только представление — те же компоненты и правила имени, что на настоящих экранах.
 */
export function ProfilePreview({
  role,
  name,
  avatar,
  login,
  position,
  about,
}: {
  role: 'student' | 'teacher';
  name: string;
  avatar: AvatarData;
  login: string | null;
  position: string;
  about: string;
}) {
  const t = useTranslations('account.preview');
  const tc = useTranslations('student.class');
  const battleName = battleDisplayName(name);
  // В Battle — аватар набора или инициалы по имени в игре (без картинки).
  const battleAvatar = {
    kind: avatar.kind === 'preset' ? 'preset' : 'initials',
    preset: avatar.preset,
    color: avatar.color,
  } as const;
  return (
    <Card
      className="flex flex-col gap-4"
      data-testid="profile-preview"
      aria-labelledby="profile-preview-title"
    >
      <div>
        <h2 id="profile-preview-title" className="text-cabinet-block font-semibold">
          {t('title')}
        </h2>
        <p className="text-xs text-[var(--text-muted)]">{t('hint')}</p>
      </div>
      {role === 'student' ? (
        <>
          <PreviewItem label={t('roster')}>
            <div className="flex items-center gap-2.5 text-sm" data-testid="preview-roster">
              <Avatar name={name} avatar={avatar} size={32} decorative />
              <span className="min-w-0 truncate">
                {name}
                {login ? <span className="text-[var(--text-muted)]"> · {login}</span> : null}
              </span>
            </div>
          </PreviewItem>
          <PreviewItem label={t('leaderboard')}>
            <div className="flex items-center gap-2 text-sm" data-testid="preview-leaderboard">
              <span className="w-5 tabular-nums text-[var(--text-muted)]">1</span>
              <Avatar
                name={battleName}
                avatar={{
                  ...battleAvatar,
                  initials: initialsOf(battleName),
                  photoUrl: null,
                  photoUrlSmall: null,
                }}
                size={24}
                decorative
              />
              <span className="font-medium">{battleName}</span>
            </div>
          </PreviewItem>
          <PreviewItem label={t('lobby')}>
            <span data-testid="preview-chip">
              <ParticipantChip name={battleName} avatar={battleAvatar} />
            </span>
          </PreviewItem>
        </>
      ) : (
        <PreviewItem label={t('classCard')}>
          <div className="flex items-start gap-3 text-sm" data-testid="preview-teacher-card">
            <Avatar name={name} avatar={avatar} size={40} decorative />
            <div className="min-w-0">
              <p className="text-[var(--text-muted)]">{tc('teacher', { teacher: name })}</p>
              {position ? <p data-testid="preview-position">{position}</p> : null}
              {about ? (
                <p
                  className="mt-1 whitespace-pre-line text-[var(--text-muted)] break-words"
                  data-testid="preview-about"
                >
                  {about}
                </p>
              ) : null}
            </div>
          </div>
        </PreviewItem>
      )}
    </Card>
  );
}

function PreviewItem({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-[11px] font-semibold tracking-[0.08em] text-[var(--text-muted)] uppercase">
        {label}
      </p>
      <div className="rounded-[var(--radius-field)] border border-[var(--border)] bg-[var(--field)] px-3 py-2.5">
        {children}
      </div>
    </div>
  );
}
