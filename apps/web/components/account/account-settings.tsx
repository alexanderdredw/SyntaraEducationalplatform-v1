'use client';

import { type FormEvent, type ReactNode, useEffect, useState } from 'react';
import { Circle, CircleCheck, Eye, EyeOff, Monitor, Smartphone } from 'lucide-react';
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
type SessionItem = components['schemas']['SessionItemDto'];

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
      <div className="grid items-start gap-6 lg:grid-cols-[200px_minmax(0,1fr)]">
        <SettingsNav />
        <div className="flex min-w-0 flex-col gap-6">
          {profile.data ? (
            <>
              <EmailSection profile={profile.data} />
              <PasswordSection minLength={minPasswordLength} profile={profile.data} />
            </>
          ) : (
            <Card aria-busy="true" className="flex flex-col gap-4">
              <Skeleton className="h-6 w-40" />
              <Skeleton className="h-11 w-full" />
            </Card>
          )}
          <SecuritySection timeZone={timeZone} />
          <PreferencesSection enabledLocales={enabledLocales} />
        </div>
      </div>
    </div>
  );
}

const SECTIONS = ['email', 'password', 'security', 'prefs'] as const;

/**
 * REQ-PRF-29: ≥ 1024 px — слева закреплённое меню разделов с подсветкой текущего при прокрутке; на телефоне меню нет,
 * блоки подряд.
 */
function SettingsNav() {
  const t = useTranslations('account.settings.nav');
  const [active, setActive] = useState<(typeof SECTIONS)[number]>('email');
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        const id = visible[0]?.target.getAttribute('data-section') as (typeof SECTIONS)[number] | undefined;
        if (id) setActive(id);
      },
      { rootMargin: '-120px 0px -55% 0px' },
    );
    for (const id of SECTIONS) {
      const el = document.querySelector(`[data-section="${id}"]`);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, []);
  return (
    <nav
      aria-label={t('label')}
      className="hidden lg:sticky lg:top-[calc(var(--header-h)+24px)] lg:block"
      data-testid="settings-nav"
    >
      <ul className="flex flex-col gap-1">
        {SECTIONS.map((id) => (
          <li key={id}>
            <a
              href={`#${id}`}
              aria-current={active === id ? 'location' : undefined}
              onClick={() => setActive(id)}
              className={cn(
                'relative flex min-h-11 items-center rounded-[var(--radius-field)] px-3 text-sm',
                active === id
                  ? 'bg-[var(--accent-soft)] font-semibold text-[var(--text)] before:absolute before:top-1/2 before:left-1 before:h-5 before:w-[3px] before:-translate-y-1/2 before:rounded-full before:bg-[var(--accent-bright)]'
                  : 'text-[var(--text-muted)] hover:bg-[var(--field)] hover:text-[var(--text)]',
              )}
            >
              {t(id)}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function Section({
  title,
  id,
  description,
  children,
}: {
  title: string;
  id: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <Card
      className="flex scroll-mt-[calc(var(--header-h)+24px)] flex-col gap-4"
      aria-labelledby={`${id}-title`}
      data-testid={`settings-${id}`}
      data-section={id}
      id={id}
    >
      <div className="flex flex-col gap-1">
        <h2 id={`${id}-title`} className="text-cabinet-block font-semibold">
          {title}
        </h2>
        {description ? <p className="text-sm text-[var(--text-muted)]">{description}</p> : null}
      </div>
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
    <Section title={t('email.title')} id="email" description={t('email.why')}>
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

/** Поле пароля с кнопкой «показать/скрыть» (REQ-PRF-31). */
function PasswordInput({
  value,
  onChange,
  autoComplete,
  ...a11y
}: {
  value: string;
  onChange: (value: string) => void;
  autoComplete: 'current-password' | 'new-password';
  id?: string;
  'aria-invalid'?: boolean;
  'aria-describedby'?: string;
  'aria-required'?: boolean;
}) {
  const t = useTranslations('account.settings.password');
  const [shown, setShown] = useState(false);
  return (
    <div className="relative">
      <Input
        {...a11y}
        type={shown ? 'text' : 'password'}
        autoComplete={autoComplete}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="pr-12"
      />
      <button
        type="button"
        onClick={() => setShown((v) => !v)}
        aria-label={shown ? t('hide') : t('show')}
        aria-pressed={shown}
        aria-controls={a11y.id}
        className="absolute top-1/2 right-1 inline-flex size-11 -translate-y-1/2 items-center justify-center rounded-full text-[var(--text-muted)] hover:text-[var(--text)]"
      >
        {shown ? (
          <EyeOff aria-hidden="true" className="size-4" />
        ) : (
          <Eye aria-hidden="true" className="size-4" />
        )}
      </button>
    </div>
  );
}

const STRENGTH_TONE = [
  '',
  'bg-[var(--danger)]',
  'bg-[var(--warning)]',
  'bg-[var(--accent)]',
  'bg-[var(--success)]',
];

function PasswordSection({ minLength, profile }: { minLength: number; profile: Profile }) {
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
  // REQ-PRF-31: не совпадает с логином, email, именем — иначе «слабый».
  const strength = passwordStrength(
    next,
    [profile.login, profile.email, profile.firstName, profile.lastName],
    minLength,
  );
  const rules = [
    { key: 'length', ok: next.length >= minLength },
    { key: 'notCurrent', ok: next.length > 0 && next !== current },
    { key: 'match', ok: next.length > 0 && next === repeat },
  ] as const;

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
          <PasswordInput value={current} onChange={setCurrent} autoComplete="current-password" />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('password.new')} error={errors.password} required>
            <PasswordInput value={next} onChange={setNext} autoComplete="new-password" />
          </Field>
          <Field label={t('password.repeat')} error={errors.repeat} required>
            <PasswordInput value={repeat} onChange={setRepeat} autoComplete="new-password" />
          </Field>
        </div>
        {/* REQ-PRF-31: 4 уровня надёжности. */}
        <div
          className="flex flex-wrap items-center gap-x-3 gap-y-1"
          data-testid="password-strength"
          data-level={strength}
        >
          <div aria-hidden="true" className="flex gap-1">
            {[1, 2, 3, 4].map((level) => (
              <span
                key={level}
                className={cn(
                  'h-1.5 w-10 rounded-full',
                  strength >= level ? STRENGTH_TONE[strength] : 'bg-[var(--field)]',
                )}
              />
            ))}
          </div>
          <span className="text-xs text-[var(--text-muted)]" aria-live="polite">
            {strength > 0 ? `${t('password.strengthLabel')}: ${t(`password.strength.${strength}`)}` : null}
          </span>
        </div>
        {/* REQ-PRF-31: требования с галочками по мере ввода. */}
        <ul
          aria-label={t('password.rulesLabel')}
          className="flex flex-col gap-1 text-sm"
          data-testid="password-rules"
        >
          {rules.map((rule) => (
            <li
              key={rule.key}
              data-ok={rule.ok}
              className={cn(
                'flex items-center gap-2',
                rule.ok ? 'text-[var(--success-text)]' : 'text-[var(--text-muted)]',
              )}
            >
              {rule.ok ? (
                <CircleCheck aria-hidden="true" className="size-4" />
              ) : (
                <Circle aria-hidden="true" className="size-4" />
              )}
              {t(`password.rules.${rule.key}`)}
              <span className="sr-only">— {rule.ok ? t('password.ruleDone') : t('password.ruleTodo')}</span>
            </li>
          ))}
        </ul>
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

/** «Сегодня, 14:32» / «вчера, 09:05» / «12.10.2026 18:00» — часовой пояс платформы. */
function useWhen(timeZone: string) {
  const t = useTranslations('account.settings.security');
  const day = (iso: string | Date) =>
    new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(
      new Date(iso),
    );
  return (iso: string) => {
    const full = formatDateTime(iso, timeZone);
    const time = full.slice(-5);
    if (day(iso) === day(new Date())) return t('today', { time });
    if (day(iso) === day(new Date(Date.now() - 86_400_000))) return t('yesterday', { time });
    return full;
  };
}

/** REQ-PRF-32: устройства — список сессий, «Это устройство», выход с одного (с подтверждением) и со всех других. */
function SecuritySection({ timeZone }: { timeZone: string }) {
  const t = useTranslations('account.settings');
  const ts = useTranslations('account.settings.security');
  const locale = useLocale();
  const when = useWhen(timeZone);
  const queryClient = useQueryClient();
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [pending, setPending] = useState(false);
  const [confirm, setConfirm] = useState<SessionItem | null>(null);
  const sessions = useQuery({
    queryKey: ['me', 'sessions'],
    queryFn: async () => {
      const res = await apiRequest<SessionItem[]>('/api/me/sessions', { locale });
      if (res.kind !== 'ok') throw new Error('sessions');
      return res.data;
    },
  });
  const label = (s: SessionItem) =>
    [s.device.browser, s.device.os].filter(Boolean).join(' · ') || ts('unknownDevice');
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['me', 'sessions'] });
  const revokeAll = async () => {
    setPending(true);
    const res = await apiRequest('/api/me/sessions/revoke-others', { method: 'POST', locale });
    setPending(false);
    setFeedback(
      res.kind === 'ok' ? { kind: 'ok', text: t('devices.revoked') } : { kind: 'error', text: t('failed') },
    );
    await refresh();
  };
  const revokeOne = async (s: SessionItem) => {
    const res = await apiRequest(`/api/me/sessions/${s.id}`, { method: 'DELETE', locale });
    setConfirm(null);
    setFeedback(
      res.kind === 'ok' ? { kind: 'ok', text: ts('signedOut') } : { kind: 'error', text: t('failed') },
    );
    await refresh();
  };
  const others = (sessions.data ?? []).filter((s) => !s.current).length;
  return (
    <Section title={ts('title')} id="security">
      <h3 className="text-sm font-semibold">{ts('devices')}</h3>
      {sessions.data ? (
        <ul className="flex flex-col divide-y divide-[var(--border)]" data-testid="sessions">
          {sessions.data.map((s) => (
            <li
              key={s.id}
              className="flex flex-wrap items-center justify-between gap-3 py-3"
              data-testid="session"
            >
              <div className="flex min-w-0 items-center gap-3">
                <span
                  aria-hidden="true"
                  className="inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-[var(--field)] text-[var(--text-muted)]"
                >
                  {s.device.os === 'iPhone' || s.device.os === 'Android' ? (
                    <Smartphone className="size-5" />
                  ) : (
                    <Monitor className="size-5" />
                  )}
                </span>
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                    {label(s)}
                    {s.current ? <Badge tone="success">{ts('thisDevice')}</Badge> : null}
                  </p>
                  <p className="text-xs text-[var(--text-muted)]">
                    {ts('lastActive', { when: when(s.lastActiveAt) })}
                  </p>
                </div>
              </div>
              {s.current ? null : (
                <Button variant="secondary" size="sm" onClick={() => setConfirm(s)}>
                  {ts('signOut')}
                </Button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <Skeleton className="h-16 w-full" />
      )}
      <div>
        <Button variant="secondary" disabled={pending || others === 0} onClick={() => void revokeAll()}>
          {t('devices.revoke')}
        </Button>
      </div>
      <Message feedback={feedback} testId="devices-feedback" />
      <Modal
        open={confirm !== null}
        onOpenChange={(open) => !open && setConfirm(null)}
        title={confirm ? ts('signOutTitle', { device: label(confirm) }) : ''}
        description={ts('signOutText')}
        closeLabel={t('cancel')}
      >
        <div className="flex flex-wrap justify-end gap-3">
          <Button variant="secondary" onClick={() => setConfirm(null)}>
            {t('cancel')}
          </Button>
          <Button variant="danger" onClick={() => confirm && void revokeOne(confirm)}>
            {ts('signOut')}
          </Button>
        </div>
      </Modal>
    </Section>
  );
}

/**
 * REQ-PRF-09, REQ-PRF-33: те же настройки, что в хедере (API-ME-02, cookie), — состояние общее с хедером;
 * сохраняются сразу при переключении, рядом — отметка «Сохранено».
 */
function PreferencesSection({ enabledLocales }: { enabledLocales: Locale[] }) {
  const t = useTranslations('account.settings.prefs');
  const { setTheme, dataSaver, setDataSaver } = usePreferences();
  const theme = useCurrentTheme();
  const [saved, setSaved] = useState<'theme' | 'dataSaver' | null>(null);
  const mark = (key: 'theme' | 'dataSaver') =>
    saved === key ? (
      <span role="status" className="text-xs text-[var(--success-text)]" data-testid={`prefs-saved-${key}`}>
        {t('saved')}
      </span>
    ) : null;
  return (
    <Section title={t('title')} id="prefs">
      <div className="flex flex-col gap-2">
        <span className="text-[13px] text-[var(--text-muted)]">{t('language')}</span>
        <LanguageSegments enabledLocales={enabledLocales} />
      </div>
      <div className="flex flex-col gap-2">
        <span className="text-[13px] text-[var(--text-muted)]">{t('theme')}</span>
        <div className="flex flex-wrap items-center gap-3">
          <SegmentedControl
            label={t('theme')}
            value={theme}
            onValueChange={(v) => {
              setTheme(v as 'light' | 'dark');
              setSaved('theme');
            }}
            options={[
              { value: 'dark', label: t('themeDark') },
              { value: 'light', label: t('themeLight') },
            ]}
          />
          {mark('theme')}
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <span className="text-[13px] text-[var(--text-muted)]">{t('dataSaver')}</span>
        <div className="flex flex-wrap items-center gap-3">
          <SegmentedControl
            label={t('dataSaver')}
            value={dataSaver ? 'on' : 'off'}
            onValueChange={(v) => {
              setDataSaver(v === 'on');
              setSaved('dataSaver');
            }}
            options={[
              { value: 'off', label: t('off') },
              { value: 'on', label: t('on') },
            ]}
          />
          {mark('dataSaver')}
        </div>
      </div>
    </Section>
  );
}
