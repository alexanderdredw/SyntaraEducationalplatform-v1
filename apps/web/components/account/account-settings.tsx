'use client';

import { type FormEvent, type ReactNode, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { type Locale, passwordStrength } from '@syntara/shared';
import { Badge, Button, Card, cn, Field, Input, Modal, SegmentedControl, Skeleton } from '@syntara/ui';
import { apiRequest, type ApiResult } from '@/lib/api/browser';
import type { components } from '@/lib/api/schema';
import { formatDateTime } from '@/lib/datetime';
import { usePreferences } from '../preferences/preferences-provider';
import { LanguageSegments, useCurrentTheme } from '../shell/preference-controls';

type Profile = components['schemas']['ProfileDto'];
type Feedback = { kind: 'ok' | 'error'; text: string } | null;

/**
 * «Настройки аккаунта» (REQ-PRF-06…09): email (добавить, изменить, удалить; подтверждение), пароль (текущий,
 * новый, повтор, надёжность), вход и устройства, предпочтения — те же, что в хедере, и синхронны с ним.
 * Уведомления не показываются до решения владельца (PH-46 notifications_section, вопрос 6).
 */
export function AccountSettings({
  timeZone,
  enabledLocales,
  minPasswordLength,
}: {
  timeZone: string;
  enabledLocales: Locale[];
  minPasswordLength: number;
}) {
  const t = useTranslations('account.settings');
  const locale = useLocale();
  const profile = useQuery({
    queryKey: ['me', 'profile'],
    queryFn: async () => {
      const res = await apiRequest<Profile>('/api/me/profile', { locale });
      if (res.kind !== 'ok') throw new Error('profile');
      return res.data;
    },
  });
  return (
    <div className="flex flex-col gap-6" data-testid="account-settings">
      <h1 className="text-cabinet-title font-bold">{t('title')}</h1>
      {profile.data ? (
        <>
          <EmailSection profile={profile.data} />
          <PasswordSection minLength={minPasswordLength} />
          <DevicesSection lastLoginAt={profile.data.lastLoginAt} timeZone={timeZone} />
        </>
      ) : (
        <Card aria-busy="true" className="flex flex-col gap-4">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-11 w-full" />
        </Card>
      )}
      <PreferencesSection enabledLocales={enabledLocales} />
    </div>
  );
}

function Section({ title, id, children }: { title: string; id: string; children: ReactNode }) {
  return (
    <Card className="flex flex-col gap-4" aria-labelledby={id} data-testid={`settings-${id}`}>
      <h2 id={id} className="text-cabinet-block font-semibold">
        {title}
      </h2>
      {children}
    </Card>
  );
}

function Message({ feedback, testId }: { feedback: Feedback; testId?: string }) {
  return (
    <p
      role={feedback?.kind === 'error' ? 'alert' : 'status'}
      aria-live="polite"
      data-testid={testId}
      className={cn(
        'text-sm',
        feedback?.kind === 'error' ? 'text-[var(--danger-text)]' : 'text-[var(--success-text)]',
      )}
    >
      {feedback?.text ?? null}
    </p>
  );
}

/** Ошибки полей API (ключи validation.*), лимит попыток (429) — общее сообщение. */
function useErrors() {
  const t = useTranslations('account.settings');
  const tv = useTranslations('validation');
  return (res: ApiResult<unknown>): { fields: Record<string, string>; general: string | null } => {
    if (res.kind !== 'http') return { fields: {}, general: t('failed') };
    if (res.status === 429) {
      const minutes = Math.max(1, Math.ceil((res.error.retryAfterSeconds ?? 60) / 60));
      return { fields: {}, general: t('rateLimited', { minutes }) };
    }
    const fields = Object.fromEntries(
      Object.entries(res.error.fieldErrors ?? {}).map(([field, key]) => [field, tv.has(key) ? tv(key) : key]),
    );
    return { fields, general: Object.keys(fields).length ? null : t('failed') };
  };
}

function EmailSection({ profile }: { profile: Profile }) {
  const t = useTranslations('account.settings');
  const locale = useLocale();
  const queryClient = useQueryClient();
  const errorsOf = useErrors();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [pending, setPending] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);
  const [removePassword, setRemovePassword] = useState('');
  const [removeErrors, setRemoveErrors] = useState<Record<string, string>>({});

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setPending(true);
    setErrors({});
    setFeedback(null);
    const res = await apiRequest('/api/me/email', {
      method: 'POST',
      locale,
      body: { email: email.trim(), currentPassword: password },
    });
    setPending(false);
    if (res.kind === 'ok') {
      setFeedback({ kind: 'ok', text: t('email.sent', { email: email.trim() }) });
      setOpen(false);
      setEmail('');
      setPassword('');
      return;
    }
    const { fields, general } = errorsOf(res);
    setErrors(fields);
    if (general) setFeedback({ kind: 'error', text: general });
  };

  const resend = async () => {
    const res = await apiRequest('/api/auth/email/resend', { method: 'POST', locale });
    setFeedback(
      res.kind === 'ok' ? { kind: 'ok', text: t('email.resent') } : { kind: 'error', text: t('failed') },
    );
  };

  const remove = async (event: FormEvent) => {
    event.preventDefault();
    setRemoveErrors({});
    const res = await apiRequest('/api/me/email', {
      method: 'DELETE',
      locale,
      body: { currentPassword: removePassword },
    });
    if (res.kind === 'ok') {
      setRemoveOpen(false);
      setRemovePassword('');
      setFeedback({ kind: 'ok', text: t('email.removed') });
      await queryClient.invalidateQueries({ queryKey: ['me', 'profile'] });
      return;
    }
    const { fields, general } = errorsOf(res);
    setRemoveErrors(general ? { currentPassword: general } : fields);
  };

  return (
    <Section title={t('email.title')} id="email">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm" data-testid="settings-email-current">
          {profile.email ?? t('email.none')}
        </span>
        {profile.email ? (
          <Badge tone={profile.emailVerified ? 'success' : 'danger'}>
            {profile.emailVerified ? t('email.verified') : t('email.unverified')}
          </Badge>
        ) : null}
        {profile.email && !profile.emailVerified ? (
          <Button variant="text" onClick={() => void resend()}>
            {t('email.resend')}
          </Button>
        ) : null}
      </div>
      {profile.role === 'teacher' ? (
        <p className="text-xs text-[var(--text-muted)]">{t('email.teacherLogin')}</p>
      ) : null}

      {open ? (
        <form onSubmit={submit} noValidate className="flex flex-col gap-4" data-testid="email-form">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('email.newEmail')} error={errors.email} required>
              <Input
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </Field>
            <Field label={t('currentPassword')} error={errors.currentPassword} required>
              <Input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </Field>
          </div>
          <div className="flex flex-wrap gap-3">
            <Button type="submit" variant="primary-blue" disabled={pending}>
              {t('email.submit')}
            </Button>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              {t('cancel')}
            </Button>
          </div>
        </form>
      ) : (
        <div className="flex flex-wrap gap-3">
          <Button variant="secondary" onClick={() => setOpen(true)}>
            {profile.email ? t('email.change') : t('email.add')}
          </Button>
          {profile.canRemoveEmail ? (
            <Button variant="danger-text" onClick={() => setRemoveOpen(true)}>
              {t('email.remove')}
            </Button>
          ) : null}
        </div>
      )}
      <Message feedback={feedback} testId="email-feedback" />

      <Modal
        open={removeOpen}
        onOpenChange={setRemoveOpen}
        title={t('email.removeTitle')}
        description={t('email.removeText')}
        closeLabel={t('cancel')}
      >
        <form onSubmit={remove} noValidate className="flex flex-col gap-4">
          <Field label={t('currentPassword')} error={removeErrors.currentPassword} required>
            <Input
              type="password"
              autoComplete="current-password"
              value={removePassword}
              onChange={(e) => setRemovePassword(e.target.value)}
            />
          </Field>
          <div className="flex flex-wrap gap-3">
            <Button variant="secondary" onClick={() => setRemoveOpen(false)}>
              {t('cancel')}
            </Button>
            <Button type="submit" variant="danger">
              {t('email.removeConfirm')}
            </Button>
          </div>
        </form>
      </Modal>
    </Section>
  );
}

function PasswordSection({ minLength }: { minLength: number }) {
  const t = useTranslations('account.settings');
  const tv = useTranslations('validation');
  const locale = useLocale();
  const errorsOf = useErrors();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [pending, setPending] = useState(false);
  const strength = passwordStrength(next, minLength);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setFeedback(null);
    const local: Record<string, string> = {};
    if (!current) local.currentPassword = tv('required');
    if (next.length < minLength) local.password = tv('passwordTooShort');
    else if (next === current) local.password = tv('samePassword');
    if (repeat !== next) local.repeat = t('password.mismatch');
    setErrors(local);
    if (Object.keys(local).length) return;
    setPending(true);
    const res = await apiRequest('/api/auth/password/change', {
      method: 'POST',
      locale,
      body: { currentPassword: current, password: next },
    });
    setPending(false);
    if (res.kind === 'ok') {
      setCurrent('');
      setNext('');
      setRepeat('');
      setFeedback({ kind: 'ok', text: t('password.changed') });
      return;
    }
    const { fields, general } = errorsOf(res);
    setErrors(fields);
    if (general) setFeedback({ kind: 'error', text: general });
  };

  return (
    <Section title={t('password.title')} id="password">
      <form onSubmit={submit} noValidate className="flex flex-col gap-4" data-testid="password-form">
        <Field label={t('currentPassword')} error={errors.currentPassword} required>
          <Input
            type="password"
            autoComplete="current-password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('password.new')} error={errors.password} hint={t('password.hint')} required>
            <Input
              type="password"
              autoComplete="new-password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
            />
          </Field>
          <Field label={t('password.repeat')} error={errors.repeat} required>
            <Input
              type="password"
              autoComplete="new-password"
              value={repeat}
              onChange={(e) => setRepeat(e.target.value)}
            />
          </Field>
        </div>
        {next ? (
          <div className="flex items-center gap-3" data-testid="password-strength">
            <div aria-hidden="true" className="flex gap-1">
              {[1, 2, 3].map((level) => (
                <span
                  key={level}
                  className={cn(
                    'h-1.5 w-10 rounded-full bg-[var(--field)]',
                    strength >= level &&
                      (strength === 1
                        ? 'bg-[var(--danger)]'
                        : strength === 2
                          ? 'bg-[var(--warning)]'
                          : 'bg-[var(--success)]'),
                  )}
                />
              ))}
            </div>
            <span className="text-xs text-[var(--text-muted)]">
              {t('password.strengthLabel')}: {t(`password.strength.${strength}`)}
            </span>
          </div>
        ) : null}
        <div>
          <Button type="submit" variant="primary-blue" disabled={pending}>
            {t('password.change')}
          </Button>
        </div>
        <Message feedback={feedback} testId="password-feedback" />
      </form>
    </Section>
  );
}

function DevicesSection({ lastLoginAt, timeZone }: { lastLoginAt: string | null; timeZone: string }) {
  const t = useTranslations('account.settings');
  const locale = useLocale();
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [pending, setPending] = useState(false);
  const revoke = async () => {
    setPending(true);
    const res = await apiRequest('/api/me/sessions/revoke-others', { method: 'POST', locale });
    setPending(false);
    setFeedback(
      res.kind === 'ok' ? { kind: 'ok', text: t('devices.revoked') } : { kind: 'error', text: t('failed') },
    );
  };
  return (
    <Section title={t('devices.title')} id="devices">
      <p className="text-sm" data-testid="settings-last-login">
        {lastLoginAt
          ? t('devices.lastLogin', { date: formatDateTime(lastLoginAt, timeZone) })
          : t('devices.never')}
      </p>
      <div>
        <Button variant="secondary" disabled={pending} onClick={() => void revoke()}>
          {t('devices.revoke')}
        </Button>
      </div>
      <Message feedback={feedback} testId="devices-feedback" />
    </Section>
  );
}

/** REQ-PRF-09: те же настройки, что в хедере (API-ME-02, cookie), — состояние общее с хедером. */
function PreferencesSection({ enabledLocales }: { enabledLocales: Locale[] }) {
  const t = useTranslations('account.settings.prefs');
  const { setTheme, dataSaver, setDataSaver } = usePreferences();
  const theme = useCurrentTheme();
  return (
    <Section title={t('title')} id="prefs">
      <div className="flex flex-col gap-2">
        <span className="text-[13px] text-[var(--text-muted)]">{t('language')}</span>
        <LanguageSegments enabledLocales={enabledLocales} />
      </div>
      <div className="flex flex-col gap-2">
        <span className="text-[13px] text-[var(--text-muted)]">{t('theme')}</span>
        <SegmentedControl
          label={t('theme')}
          value={theme}
          onValueChange={(v) => setTheme(v as 'light' | 'dark')}
          options={[
            { value: 'dark', label: t('themeDark') },
            { value: 'light', label: t('themeLight') },
          ]}
        />
      </div>
      <div className="flex flex-col gap-2">
        <span className="text-[13px] text-[var(--text-muted)]">{t('dataSaver')}</span>
        <SegmentedControl
          label={t('dataSaver')}
          value={dataSaver ? 'on' : 'off'}
          onValueChange={(v) => setDataSaver(v === 'on')}
          options={[
            { value: 'off', label: t('off') },
            { value: 'on', label: t('on') },
          ]}
        />
      </div>
    </Section>
  );
}
