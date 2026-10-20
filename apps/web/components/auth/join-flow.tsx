'use client';

import { useEffect, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Users } from 'lucide-react';
import { Button, Card, Field, Input, Modal } from '@syntara/ui';
import { useRouter } from '@/i18n/navigation';
import { apiRequest, type ApiResult } from '@/lib/api/browser';
import { AppLink } from '../app-link';
import { StudentAuth } from './student-auth';
import { usePreservedState } from '../preferences/preserved-state';

type Viewer = 'guest' | 'student' | 'other';
type Check = 'idle' | 'valid' | 'invalid' | 'battle' | 'tooMany' | 'error';

/** BR-CODE-04: ответ «это код Battle» (404, fieldErrors.code = isBattleCode). */
const isBattleCode = (res: ApiResult<unknown>) =>
  res.kind === 'http' && res.status === 404 && res.error.fieldErrors?.code === 'isBattleCode';

/**
 * /join (REQ-GEN-AUTH-03, BR-CLS-02, PH-44): до входа — только проверка годности кода (API-PUB-08);
 * гостю с годным кодом — форма ученика (вход или регистрация) с заполненным кодом; вошедшему ученику — подтверждение
 * «Присоединиться к классу?» и API-S-01. Код хранится в памяти вкладки и переживает переход на вход.
 * Код Battle — подсказка со ссылкой на раздел «Battle» (гостю — на вход ученика), вступления нет (BR-CODE-04).
 */
export function JoinFlow({ viewer }: { viewer: Viewer }) {
  const t = useTranslations('join');
  const th = useTranslations('help');
  const tf = useTranslations('forms');
  const locale = useLocale();
  const router = useRouter();
  const [code, setCode] = usePreservedState('join.code', '');
  const [currentViewer, setCurrentViewer] = useState<Viewer>(viewer);
  const [check, setCheck] = useState<Check>('idle');
  const [retryMinutes, setRetryMinutes] = useState(1);
  const [confirm, setConfirm] = useState(false);
  const [pending, setPending] = useState(false);

  const tooMany = (seconds: number | undefined) => {
    setRetryMinutes(Math.max(1, Math.ceil((seconds ?? 60) / 60)));
    setCheck('tooMany');
  };

  const runCheck = async () => {
    if (!code.trim()) return;
    setPending(true);
    const res = await apiRequest<{ valid: boolean }>('/api/public/join/check', {
      method: 'POST',
      body: { code },
      locale,
    });
    setPending(false);
    if (res.kind === 'ok') {
      setCheck(res.data.valid ? 'valid' : 'invalid');
      if (res.data.valid && currentViewer === 'student') setConfirm(true);
    } else if (isBattleCode(res)) setCheck('battle');
    else if (res.kind === 'http' && res.status === 429) tooMany(res.error.retryAfterSeconds);
    else setCheck('error');
  };

  const join = async () => {
    setPending(true);
    const res = await apiRequest('/api/student/join', { method: 'POST', body: { code }, locale });
    setPending(false);
    setConfirm(false);
    if (res.kind === 'ok') {
      setCode('');
      router.push('/learn/subjects');
    } else if (isBattleCode(res)) setCheck('battle');
    else if (res.kind === 'http' && res.status === 404) setCheck('invalid');
    else if (res.kind === 'http' && res.status === 429) tooMany(res.error.retryAfterSeconds);
    else setCheck('error');
  };

  // REQ-GEN-AUTH-03: после входа с кодом — сразу экран подтверждения «Присоединиться к классу?».
  const autoChecked = useRef(false);
  useEffect(() => {
    if (autoChecked.current || viewer !== 'student' || !code.trim()) return;
    autoChecked.current = true;
    void runCheck();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex flex-col gap-6" data-testid="join-flow">
      <Card>
        <form
          className="flex flex-col gap-3 sm:flex-row sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            void runCheck();
          }}
        >
          <div className="flex-1">
            <Field
              id="join-code"
              label={t('codeLabel')}
              hint={t('codeHint')}
              icon={<Users aria-hidden="true" className="size-4" />}
            >
              <Input
                value={code}
                placeholder={t('codePlaceholder')}
                autoComplete="off"
                autoCapitalize="characters"
                onChange={(e) => {
                  setCode(e.target.value);
                  setCheck('idle');
                }}
              />
            </Field>
          </div>
          <Button type="submit" disabled={pending || !code.trim()} className="sm:min-h-[var(--field-h)]">
            {t('check')}
          </Button>
        </form>

        <div className="mt-4" aria-live="polite">
          {check === 'valid' && currentViewer === 'guest' ? (
            <div className="flex flex-wrap items-center gap-3" data-testid="join-valid">
              <p>{t('valid')}</p>
              <AppLink
                href="/auth/login?returnTo=%2Fjoin"
                className="inline-flex min-h-11 items-center font-semibold text-[var(--accent)] hover:underline"
              >
                {t('login')}
              </AppLink>
            </div>
          ) : null}
          {check === 'valid' && currentViewer === 'other' ? (
            <p data-testid="join-only-students">{t('onlyStudents')}</p>
          ) : null}
          {check === 'invalid' ? (
            <div className="flex flex-wrap items-center gap-3" data-testid="join-invalid">
              <p className="text-[var(--danger-text)]">{t('invalid')}</p>
              <AppLink
                href="/support"
                className="inline-flex min-h-11 items-center text-[var(--accent)] hover:underline"
              >
                {th('supportLink')}
              </AppLink>
            </div>
          ) : null}
          {check === 'battle' ? (
            <p className="text-[var(--danger-text)]" data-testid="join-battle-code">
              {t.rich('isBattleCode', {
                link: (chunks) => (
                  <AppLink
                    href={currentViewer === 'guest' ? '/auth/start?role=student' : '/learn/battles'}
                    className="font-semibold underline"
                  >
                    {chunks}
                  </AppLink>
                ),
              })}
            </p>
          ) : null}
          {check === 'tooMany' ? (
            <p className="text-[var(--danger-text)]">{t('tooMany', { minutes: retryMinutes })}</p>
          ) : null}
          {check === 'error' ? <p className="text-[var(--danger-text)]">{tf('serverError')}</p> : null}
        </div>
      </Card>

      {check === 'valid' && currentViewer === 'guest' ? (
        // Гость с годным кодом — та же форма ученика с заполненным кодом (REQ-GEN-AUTH-03).
        <StudentAuth
          initialCode={code}
          onLoggedIn={(me, via) => {
            // Регистрация с кодом уже добавила ученика в класс; после входа — подтверждение вступления.
            if (via === 'register') {
              setCode('');
              router.replace('/learn/subjects');
              router.refresh();
            } else if (me.roles.includes('student')) {
              setCurrentViewer('student');
              setConfirm(true);
              router.refresh();
            } else {
              setCurrentViewer('other');
              router.refresh();
            }
          }}
        />
      ) : null}

      <Modal open={confirm} onOpenChange={setConfirm} title={t('confirmTitle')} closeLabel={t('cancel')}>
        <div className="flex flex-wrap justify-end gap-3">
          <Button variant="secondary" onClick={() => setConfirm(false)}>
            {t('cancel')}
          </Button>
          <Button onClick={() => void join()} disabled={pending}>
            {t('confirm')}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
