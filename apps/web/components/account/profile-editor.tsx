'use client';

import { type FormEvent, type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { RadioGroup, Tooltip } from 'radix-ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Camera, Check, Copy } from 'lucide-react';
import {
  AVATAR_COLORS,
  AVATAR_PHOTO_MIME,
  AVATAR_PRESETS,
  initialsOf,
  PROFILE_LIMITS,
  SPREADSHEET_ERROR,
} from '@syntara/shared';
import {
  Avatar,
  type AvatarData,
  AvatarArt,
  avatarColorStyle,
  avatarPresetColor,
  Button,
  Card,
  cn,
  Field,
  Input,
  SegmentedControl,
  Skeleton,
  Textarea,
  Toast,
  ToastProvider,
} from '@syntara/ui';
import { useRouter } from '@/i18n/navigation';
import { apiRequest } from '@/lib/api/browser';
import { PROFILE_KEY } from '../learn/query-keys';
import { isSpreadsheetUpload } from '@/lib/upload';
import type { components } from '@/lib/api/schema';
import { formatDateTime } from '@/lib/datetime';
import { AvatarCrop } from './avatar-crop';
import { ProfilePreview } from './profile-preview';
import { useUnsavedWarning } from './use-unsaved-warning';

type Profile = components['schemas']['ProfileDto'];
type UploadUrl = components['schemas']['UploadUrlResponse'];
type Kind = 'initials' | 'preset' | 'photo';

interface Draft {
  firstName: string;
  lastName: string;
  position: string;
  about: string;
  kind: Kind;
  preset: string;
  color: string;
  /** Новая картинка: id загруженного файла и локальный предпросмотр. */
  mediaId: string | null;
  previewUrl: string | null;
}

const fromProfile = (p: Profile): Draft => ({
  firstName: p.firstName,
  lastName: p.lastName ?? '',
  position: p.position ?? '',
  about: p.about ?? '',
  kind: p.avatar.kind,
  preset: p.avatar.preset ?? AVATAR_PRESETS[0],
  color: p.avatar.color,
  mediaId: null,
  previewUrl: null,
});

const fieldsChanged = (a: Draft, b: Draft) =>
  a.firstName.trim() !== b.firstName ||
  a.lastName.trim() !== b.lastName ||
  a.position.trim() !== b.position ||
  a.about.trim() !== b.about;

const avatarChanged = (a: Draft, b: Draft) =>
  a.kind !== b.kind ||
  a.color !== b.color ||
  (a.kind === 'preset' && a.preset !== b.preset) ||
  (a.kind === 'photo' && a.mediaId !== null);

/**
 * «Редактировать профиль» (REQ-PRF-05, API-ME-06…09): аватар (набор, инициалы с цветом; учитель — своя картинка с
 * обрезкой), имя и фамилия, у учителя — «Должность» и «О себе», логин и школа — только просмотр. «Сохранить» и
 * «Сохранено»; уход с несохранёнными изменениями — предупреждение.
 */
export function ProfileEditor({ timeZone }: { timeZone: string }) {
  const locale = useLocale();
  const profile = useQuery({
    queryKey: PROFILE_KEY,
    queryFn: async () => {
      const res = await apiRequest<Profile>('/api/me/profile', { locale });
      if (res.kind !== 'ok') throw new Error('profile');
      return res.data;
    },
  });
  if (!profile.data) {
    return (
      <Card className="flex flex-col gap-4" aria-busy="true">
        <Skeleton className="h-24 w-24 rounded-full" />
        <Skeleton className="h-11 w-full" />
        <Skeleton className="h-11 w-full" />
      </Card>
    );
  }
  return <ProfileForm profile={profile.data} timeZone={timeZone} />;
}

function ProfileForm({ profile, timeZone }: { profile: Profile; timeZone: string }) {
  const t = useTranslations('account.profile');
  const tv = useTranslations('validation');
  const locale = useLocale();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [baseline, setBaseline] = useState<Draft>(() => fromProfile(profile));
  const [draft, setDraft] = useState<Draft>(baseline);
  const [current, setCurrent] = useState<Profile>(profile);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle');
  const [cropFile, setCropFile] = useState<File | null>(null);
  const [upload, setUpload] = useState<'idle' | 'uploading' | string>('idle');
  const fileRef = useRef<HTMLInputElement>(null);
  const isTeacher = current.canUploadPhoto;
  const dirty = fieldsChanged(draft, baseline) || avatarChanged(draft, baseline);
  useUnsavedWarning(dirty, t('unsaved'));

  // Пока картинка проверяется — опрос статуса (BR-PRF-03: до проверки показываются инициалы).
  const pending = current.avatar.kind === 'photo' && current.avatar.photoStatus === 'pending';
  useEffect(() => {
    if (!pending) return;
    let tries = 0;
    const timer = setInterval(async () => {
      tries += 1;
      const res = await apiRequest<Profile>('/api/me/profile', { locale });
      if (res.kind === 'ok' && res.data.avatar.photoStatus !== 'pending') {
        setCurrent(res.data);
        queryClient.setQueryData(['me', 'profile'], res.data);
        router.refresh();
      }
      if (tries >= 40) clearInterval(timer);
    }, 3000);
    return () => clearInterval(timer);
  }, [pending, locale, queryClient, router]);

  const update = (patch: Partial<Draft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setStatus('idle');
  };
  /** REQ-PRF-28: «Отменить» — вернуть сохранённые значения. */
  const discard = () => {
    if (draft.previewUrl) URL.revokeObjectURL(draft.previewUrl);
    setDraft(baseline);
    setErrors({});
    setStatus('idle');
  };
  const dateText = (seconds: number) =>
    formatDateTime(new Date(Date.now() + seconds * 1000).toISOString(), timeZone);
  const message = (key: string) => (tv.has(key) ? tv(key) : tv('required'));

  /** Аватар, который сейчас видно в предпросмотре. */
  const preview: AvatarData = {
    ...current.avatar,
    kind: draft.kind,
    preset: draft.kind === 'preset' ? draft.preset : null,
    color: draft.color,
    initials: initialsOf(`${draft.firstName} ${draft.lastName}`) || current.avatar.initials,
    photoUrl: draft.kind === 'photo' ? (draft.previewUrl ?? current.avatar.photoUrl) : null,
    photoUrlSmall: draft.kind === 'photo' ? (draft.previewUrl ?? current.avatar.photoUrlSmall) : null,
  };
  const name = `${draft.firstName} ${draft.lastName}`.trim() || current.firstName;

  const chooseFile = async (file: File | undefined) => {
    setErrors((e) => ({ ...e, photo: '' }));
    if (!file) return;
    // BR-FILE-09: таблица — сразу то же сообщение, что вернёт сервер.
    if (await isSpreadsheetUpload(file)) {
      setErrors((e) => ({ ...e, photo: tv(SPREADSHEET_ERROR) }));
      return;
    }
    if (!(AVATAR_PHOTO_MIME as readonly string[]).includes(file.type)) {
      setErrors((e) => ({ ...e, photo: tv('fileType') }));
      return;
    }
    if (file.size > PROFILE_LIMITS.photoMaxBytes) {
      setErrors((e) => ({ ...e, photo: tv('fileTooLarge') }));
      return;
    }
    setCropFile(file);
  };

  /** API-ME-08 → PUT в хранилище → API-T-17; картинка станет аватаром после «Сохранить». */
  const uploadCropped = async (blob: Blob) => {
    setCropFile(null);
    setUpload('uploading');
    const issued = await apiRequest<UploadUrl>('/api/me/avatar/upload-url', {
      method: 'POST',
      locale,
      body: { fileName: 'avatar.jpg', mime: 'image/jpeg', size: blob.size },
    });
    if (issued.kind !== 'ok') {
      setUpload('idle');
      const retry = issued.kind === 'http' ? issued.error.retryAfterSeconds : undefined;
      setErrors((e) => ({
        ...e,
        photo:
          issued.kind === 'http' && issued.status === 429 && retry
            ? t('uploadLimit', { date: dateText(retry) })
            : t('uploadFailed'),
      }));
      return;
    }
    try {
      const put = await fetch(issued.data.uploadUrl, {
        method: 'PUT',
        headers: issued.data.headers,
        body: blob,
      });
      if (!put.ok) throw new Error('upload');
    } catch {
      setUpload('idle');
      setErrors((e) => ({ ...e, photo: t('uploadFailed') }));
      return;
    }
    const done = await apiRequest(`/api/files/${issued.data.mediaId}/complete`, { method: 'POST', locale });
    setUpload('idle');
    if (done.kind !== 'ok') {
      setErrors((e) => ({ ...e, photo: t('uploadFailed') }));
      return;
    }
    if (draft.previewUrl) URL.revokeObjectURL(draft.previewUrl);
    update({ kind: 'photo', mediaId: issued.data.mediaId, previewUrl: URL.createObjectURL(blob) });
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setErrors({});
    setStatus('saving');
    let next = current;
    if (fieldsChanged(draft, baseline)) {
      const body: Record<string, string> = {};
      if (draft.firstName.trim() !== baseline.firstName) body.firstName = draft.firstName.trim();
      if (draft.lastName.trim() !== baseline.lastName) body.lastName = draft.lastName.trim();
      if (isTeacher && draft.position.trim() !== baseline.position) body.position = draft.position.trim();
      if (isTeacher && draft.about.trim() !== baseline.about) body.about = draft.about.trim();
      const res = await apiRequest<Profile>('/api/me/profile', { method: 'PATCH', locale, body });
      if (res.kind !== 'ok') {
        setStatus('failed');
        if (res.kind === 'http' && res.error.fieldErrors) {
          const retry = res.error.retryAfterSeconds;
          setErrors(
            Object.fromEntries(
              Object.entries(res.error.fieldErrors).map(([field, key]) => [
                field,
                key === 'nameChangeLimit' && retry ? t('nameLimit', { date: dateText(retry) }) : message(key),
              ]),
            ),
          );
        }
        return;
      }
      next = res.data;
    }
    if (avatarChanged(draft, baseline)) {
      const body =
        draft.kind === 'preset'
          ? { kind: 'preset', preset: draft.preset, color: draft.color }
          : draft.kind === 'photo'
            ? { kind: 'photo', mediaId: draft.mediaId, color: draft.color }
            : { kind: 'initials', color: draft.color };
      const res = await apiRequest<Profile>('/api/me/avatar', { method: 'PUT', locale, body });
      if (res.kind !== 'ok') {
        setStatus('failed');
        return;
      }
      next = res.data;
    }
    if (draft.previewUrl) URL.revokeObjectURL(draft.previewUrl);
    const saved = fromProfile(next);
    setCurrent(next);
    setBaseline(saved);
    setDraft(saved);
    setStatus('saved');
    queryClient.setQueryData(['me', 'profile'], next);
    // Хедер, панель и меню профиля берут имя и аватар из API-ME-01 (SSR).
    router.refresh();
  };

  const kinds: Kind[] = isTeacher ? ['initials', 'preset', 'photo'] : ['initials', 'preset'];
  const rejected =
    current.avatar.kind === 'photo' && current.avatar.photoStatus === 'rejected' && !draft.mediaId;

  return (
    <form onSubmit={save} noValidate className="flex flex-col gap-6" data-testid="profile-form">
      <h1 className="text-cabinet-title font-bold">{t('title')}</h1>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="flex min-w-0 flex-col gap-6">
          <Card className="flex flex-col gap-5">
            <h2 className="text-cabinet-block font-semibold">{t('avatar')}</h2>
            <div className="flex flex-wrap items-center gap-5">
              <Avatar name={name} avatar={preview} size={96} />
              <SegmentedControl
                label={t('avatarKindsLabel')}
                value={draft.kind}
                onValueChange={(v) => update({ kind: v as Kind })}
                options={kinds.map((k) => ({ value: k, label: t(`avatarKinds.${k}`) }))}
              />
            </div>

            {draft.kind === 'initials' ? (
              <ChoiceGrid
                label={t('color')}
                value={draft.color}
                onChange={(color) => update({ color })}
                items={AVATAR_COLORS.map((c) => ({
                  value: c,
                  label: t(`colors.${c}`),
                  render: (
                    <span
                      aria-hidden="true"
                      className="inline-flex size-10 items-center justify-center rounded-full text-sm font-semibold"
                      style={avatarColorStyle(c)}
                    >
                      {preview.initials}
                    </span>
                  ),
                }))}
              />
            ) : null}

            {draft.kind === 'preset' ? (
              <ChoiceGrid
                label={t('presetLabel')}
                value={draft.preset}
                onChange={(preset) => update({ preset })}
                items={AVATAR_PRESETS.map((p) => ({
                  value: p,
                  label: t(`presets.${p}`),
                  render: (
                    <span
                      aria-hidden="true"
                      className="inline-flex size-12 items-center justify-center rounded-full"
                      style={avatarColorStyle(avatarPresetColor(p))}
                    >
                      <AvatarArt preset={p} className="size-[78%]" />
                    </span>
                  ),
                }))}
              />
            ) : null}

            {draft.kind === 'photo' && isTeacher ? (
              <div className="flex flex-col gap-2">
                <input
                  ref={fileRef}
                  type="file"
                  accept={AVATAR_PHOTO_MIME.join(',')}
                  className="sr-only"
                  tabIndex={-1}
                  aria-hidden="true"
                  data-testid="avatar-file"
                  onChange={(e) => {
                    void chooseFile(e.target.files?.[0]);
                    e.target.value = '';
                  }}
                />
                <div>
                  <Button
                    variant="secondary"
                    onClick={() => fileRef.current?.click()}
                    disabled={upload === 'uploading'}
                    aria-describedby="avatar-upload-hint"
                  >
                    <Camera aria-hidden="true" className="size-4" />
                    {upload === 'uploading' ? t('uploading') : t('upload')}
                  </Button>
                </div>
                <p id="avatar-upload-hint" className="text-xs text-[var(--text-muted)]">
                  {t('uploadHint')}
                </p>
                {pending && !draft.mediaId ? (
                  <p role="status" className="text-sm text-[var(--text-muted)]">
                    {t('checking')}
                  </p>
                ) : null}
                {rejected ? (
                  <p role="alert" className="text-sm text-[var(--danger-text)]">
                    {t('rejected')}
                  </p>
                ) : null}
                {errors.photo ? (
                  <p role="alert" className="text-sm text-[var(--danger-text)]">
                    {errors.photo}
                  </p>
                ) : null}
              </div>
            ) : null}
          </Card>

          <Card className="flex flex-col gap-5">
            <div className="grid gap-5 sm:grid-cols-2">
              <Field
                label={t('fields.firstName')}
                required
                error={errors.firstName}
                hint={
                  !current.nameEditable
                    ? t('nameNotEditable')
                    : current.nameChangeAvailableAt
                      ? t('nameLimit', { date: formatDateTime(current.nameChangeAvailableAt, timeZone) })
                      : undefined
                }
              >
                <Input
                  value={draft.firstName}
                  maxLength={PROFILE_LIMITS.nameMax}
                  autoComplete="given-name"
                  readOnly={!current.nameEditable}
                  onChange={(e) => update({ firstName: e.target.value })}
                />
              </Field>
              <Field
                label={isTeacher ? t('fields.lastName') : `${t('fields.lastName')} (${t('fields.optional')})`}
                error={errors.lastName}
              >
                <Input
                  value={draft.lastName}
                  maxLength={PROFILE_LIMITS.nameMax}
                  autoComplete="family-name"
                  readOnly={!current.nameEditable}
                  onChange={(e) => update({ lastName: e.target.value })}
                />
              </Field>
            </div>

            {isTeacher ? (
              <>
                <Field label={`${t('fields.position')} (${t('fields.optional')})`} error={errors.position}>
                  <Input
                    value={draft.position}
                    maxLength={PROFILE_LIMITS.positionMax}
                    placeholder={t('fields.positionPlaceholder')}
                    onChange={(e) => update({ position: e.target.value })}
                  />
                </Field>
                <Field
                  label={`${t('fields.about')} (${t('fields.optional')})`}
                  error={errors.about}
                  hint={t('fields.aboutCounter', { count: draft.about.length })}
                >
                  <Textarea
                    value={draft.about}
                    maxLength={PROFILE_LIMITS.aboutMax}
                    rows={4}
                    onChange={(e) => update({ about: e.target.value })}
                  />
                </Field>
              </>
            ) : null}

            {/* FIX-04: логин и школа — текст «только для чтения» (подпись + значение, без рамки поля) с пояснением. */}
            <dl className="grid gap-5 sm:grid-cols-2" data-testid="profile-readonly">
              {current.login ? (
                <ReadOnlyItem
                  label={t('fields.login')}
                  value={current.login}
                  hint={t('fields.loginHint')}
                  copy={{ label: t('fields.copyLogin'), done: t('fields.copied') }}
                />
              ) : null}
              <ReadOnlyItem
                label={t('fields.school')}
                value={current.school?.name ?? t('fields.noSchool')}
                hint={t('fields.schoolHint')}
              />
            </dl>
          </Card>
        </div>

        {/* REQ-PRF-26: «Как тебя видят другие» — справа от формы (телефон — под ней), сразу при изменениях. */}
        <aside className="lg:sticky lg:top-[calc(var(--header-h)+24px)]">
          <ProfilePreview
            role={isTeacher ? 'teacher' : 'student'}
            name={name}
            avatar={preview}
            login={current.login}
            position={draft.position.trim()}
            about={draft.about.trim()}
          />
        </aside>
      </div>

      {/* REQ-PRF-28: плашка несохранённых изменений, закреплённая внизу экрана. */}
      {dirty || status === 'saving' || status === 'failed' ? (
        <div
          role="region"
          aria-label={t('unsavedBar')}
          data-testid="unsaved-bar"
          className="sticky bottom-4 z-30 flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-card)] border border-[var(--border-strong)] bg-[var(--surface)] px-4 py-3 shadow-popover"
        >
          <p role="status" aria-live="polite" className="text-sm font-medium" data-testid="profile-status">
            {status === 'failed' && Object.keys(errors).length === 0 ? (
              <span className="text-[var(--danger-text)]">{t('saveFailed')}</span>
            ) : (
              t('unsavedBar')
            )}
          </p>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={discard} disabled={status === 'saving'}>
              {t('discard')}
            </Button>
            <Button
              type="submit"
              variant="primary-blue"
              disabled={!dirty || status === 'saving' || upload === 'uploading'}
            >
              {t('save')}
            </Button>
          </div>
        </div>
      ) : null}

      <AvatarCrop
        file={cropFile}
        onCancel={() => setCropFile(null)}
        onApply={(blob) => void uploadCropped(blob)}
      />
      <ToastProvider regionLabel={t('notifications')}>
        <Toast
          open={status === 'saved'}
          onOpenChange={(open) => !open && setStatus('idle')}
          title={t('savedToast')}
          tone="success"
        />
      </ToastProvider>
    </form>
  );
}

/** Выбор цвета или аватара набора: радиогруппа (стрелки перемещают выбор), подпись каждого варианта — для диктора. */
function ChoiceGrid({
  label,
  value,
  onChange,
  items,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  items: Array<{ value: string; label: string; render: ReactNode }>;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-2">
      <p id={id} className="text-[13px] text-[var(--text-muted)]">
        {label}
      </p>
      <RadioGroup.Root
        aria-labelledby={id}
        value={value}
        onValueChange={onChange}
        className="flex flex-wrap gap-2"
        orientation="horizontal"
        loop
      >
        <Tooltip.Provider delayDuration={200}>
          {items.map((item) => (
            // REQ-PRF-27: название — подсказкой при наведении и фокусе; выбранный — обводка и галочка.
            <Tooltip.Root key={item.value}>
              <Tooltip.Trigger asChild>
                <RadioGroup.Item
                  value={item.value}
                  aria-label={item.label}
                  className={cn(
                    'group relative inline-flex min-h-11 min-w-11 items-center justify-center rounded-full border-2 border-transparent p-0.5',
                    'hover:border-[var(--border-strong)] aria-checked:border-[var(--accent)]',
                  )}
                >
                  {item.render}
                  <span
                    aria-hidden="true"
                    className="absolute -right-0.5 -bottom-0.5 hidden size-4 items-center justify-center rounded-full bg-[var(--accent-strong)] text-white ring-2 ring-[var(--surface)] group-aria-checked:inline-flex"
                  >
                    <Check className="size-3" strokeWidth={3} />
                  </span>
                </RadioGroup.Item>
              </Tooltip.Trigger>
              <Tooltip.Portal>
                <Tooltip.Content
                  sideOffset={4}
                  className="z-50 rounded-[var(--radius-item)] bg-[var(--text)] px-2 py-1 text-xs text-[var(--bg)] shadow-popover"
                  data-testid="choice-tooltip"
                >
                  {item.label}
                </Tooltip.Content>
              </Tooltip.Portal>
            </Tooltip.Root>
          ))}
        </Tooltip.Provider>
      </RadioGroup.Root>
    </div>
  );
}

/** FIX-04: значение без рамки поля, пояснение «почему нельзя изменить»; у логина — «Копировать». */
function ReadOnlyItem({
  label,
  value,
  hint,
  copy,
}: {
  label: string;
  value: string;
  hint: string;
  copy?: { label: string; done: string };
}) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-[13px] text-[var(--text-muted)]">{label}</dt>
      <dd className="flex flex-wrap items-center gap-2 text-base font-medium break-all">
        {value}
        {copy ? (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              void navigator.clipboard?.writeText(value).then(() => setCopied(true));
            }}
          >
            <Copy aria-hidden="true" className="size-3.5" />
            {copied ? copy.done : copy.label}
          </Button>
        ) : null}
      </dd>
      <dd className="text-xs text-[var(--text-muted)]">{hint}</dd>
    </div>
  );
}
