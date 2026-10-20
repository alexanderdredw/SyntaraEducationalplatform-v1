'use client';

import { type ReactNode, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Button, Checkbox, Field, Input, Modal } from '@syntara/ui';
import { useRouter } from '@/i18n/navigation';
import { apiRequest } from '@/lib/api/browser';

/** Создание сессии (API-BTL-20); ошибки — ключи `battle.host.errors.*`. */
export async function createSession(
  battleId: string,
  body: { settings?: Record<string, unknown> },
  locale: string,
): Promise<{ ok: true; sessionId: string } | { ok: false; error: string }> {
  const res = await apiRequest<{ sessionId: string }>(`/api/teacher/battles/${battleId}/sessions`, {
    method: 'POST',
    body,
    locale,
  });
  if (res.kind === 'ok') return { ok: true, sessionId: res.data.sessionId };
  return { ok: false, error: res.kind === 'http' ? (res.error.fieldErrors?.battle ?? 'unknown') : 'network' };
}

/**
 * BT-T03 «Запуск» (REQ-BTL-T03): настройки сессии (SPEC 7.12), «Создать игру» → лобби ведущего. Класс не выбирается:
 * войти по коду может любой ученик платформы (BR-BTL-02, Q-BTL-01).
 * Значения по умолчанию — PH-45 (промежуточный рейтинг включён, позднее подключение выключено, 100 участников).
 */
export function LaunchDialog({ battleId, trigger }: { battleId: string; trigger: ReactNode }) {
  const t = useTranslations('battle.host');
  const tc = useTranslations('common');
  const locale = useLocale();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [settings, setSettings] = useState({
    shuffleQuestions: false,
    shuffleOptions: false,
    leaderboard: true,
    autoAdvance: false,
    lateJoin: false,
  });
  const [maxParticipants, setMaxParticipants] = useState('100');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    const max = Math.min(100, Math.max(1, Number(maxParticipants) || 100));
    setBusy(true);
    const res = await createSession(battleId, { settings: { ...settings, maxParticipants: max } }, locale);
    setBusy(false);
    if (res.ok) return router.push(`/teacher/battle-sessions/${res.sessionId}`);
    setError(t.has(`errors.${res.error}`) ? t(`errors.${res.error}`) : t('errors.unknown'));
  }

  const flags = ['leaderboard', 'shuffleQuestions', 'shuffleOptions', 'autoAdvance', 'lateJoin'] as const;
  return (
    <Modal
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        setError(null);
      }}
      title={t('launch.title')}
      closeLabel={tc('close')}
      trigger={trigger}
    >
      <div className="mt-4 flex max-h-[70vh] flex-col gap-4 overflow-y-auto" data-testid="battle-launch">
        <fieldset className="flex flex-col gap-3">
          <legend className="mb-1 text-[13px] text-[var(--text-muted)]">{t('launch.settings')}</legend>
          {flags.map((key) => (
            <Checkbox
              key={key}
              label={t(`launch.${key}`)}
              checked={settings[key]}
              onCheckedChange={(checked) => setSettings((s) => ({ ...s, [key]: checked }))}
            />
          ))}
        </fieldset>
        <Field label={t('launch.maxParticipants')} hint={t('launch.maxHint')}>
          <Input
            type="number"
            inputMode="numeric"
            min={1}
            max={100}
            value={maxParticipants}
            onChange={(e) => setMaxParticipants(e.target.value)}
          />
        </Field>
        {error ? (
          <p role="alert" className="text-sm text-[var(--danger-text)]">
            {error}
          </p>
        ) : null}
        <Button variant="primary-blue" className="self-start" disabled={busy} onClick={() => void submit()}>
          {t('launch.submit')}
        </Button>
      </div>
    </Modal>
  );
}
