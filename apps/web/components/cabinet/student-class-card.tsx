'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Users } from 'lucide-react';
import { Button, Card, Field, Input, Modal } from '@syntara/ui';
import { apiRequest } from '@/lib/api/browser';
import type { components } from '@/lib/api/schema';
import { AppLink } from '../app-link';
import { CLASS_OVERVIEW_KEY, NAV_BADGES_KEY } from './nav-state';

type StudentClass = components['schemas']['StudentClassDto'];
type Problem = 'invalid' | 'battle' | 'tooMany' | 'error' | null;

const KEY = ['student', 'class'];

/**
 * Карточка класса (REQ-ST-CAT-01, API-S-02): «Вы в классе «{name}»», «Учитель: … · школа», «Выйти из класса»
 * с подтверждением (PH-40) → API-S-03; это не выход из аккаунта. Без класса — поле «Подключиться к классу»
 * и подтверждение вступления (BR-CLS-02, API-S-01). Заголовок, подпись «Код класса», пример, подсказка и иконка
 * «люди» отличают блок от карточки «Battle» (BR-CODE-07); код Battle — подсказка со ссылкой (BR-CODE-04).
 */
export function StudentClassCard() {
  const t = useTranslations('student.class');
  const tj = useTranslations('join');
  const tf = useTranslations('forms');
  const locale = useLocale();
  const queryClient = useQueryClient();
  const [code, setCode] = useState('');
  const [confirmJoin, setConfirmJoin] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [problem, setProblem] = useState<Problem>(null);
  const [retryMinutes, setRetryMinutes] = useState(1);
  const [pending, setPending] = useState(false);

  const current = useQuery({
    queryKey: KEY,
    queryFn: async () => {
      const res = await apiRequest<StudentClass | null>('/api/student/class', { locale });
      if (res.kind !== 'ok') throw new Error('class');
      return res.data ?? null;
    },
  });

  // «Мой класс», плашка каталога и счётчики панели зависят от класса (API-S-19, API-S-20).
  const refreshClassViews = () => {
    void queryClient.invalidateQueries({ queryKey: CLASS_OVERVIEW_KEY });
    void queryClient.invalidateQueries({ queryKey: NAV_BADGES_KEY });
  };

  const join = async () => {
    setPending(true);
    const res = await apiRequest<StudentClass>('/api/student/join', {
      method: 'POST',
      body: { code },
      locale,
    });
    setPending(false);
    setConfirmJoin(false);
    if (res.kind === 'ok') {
      setCode('');
      setProblem(null);
      queryClient.setQueryData(KEY, res.data);
      refreshClassViews();
    } else if (res.kind === 'http' && res.status === 404)
      setProblem(res.error.fieldErrors?.code === 'isBattleCode' ? 'battle' : 'invalid');
    else if (res.kind === 'http' && res.status === 429) {
      setRetryMinutes(Math.max(1, Math.ceil((res.error.retryAfterSeconds ?? 60) / 60)));
      setProblem('tooMany');
    } else setProblem('error');
  };

  const leave = async () => {
    setPending(true);
    const res = await apiRequest('/api/student/class/leave', { method: 'POST', locale });
    setPending(false);
    setConfirmLeave(false);
    if (res.kind === 'ok') {
      queryClient.setQueryData(KEY, null);
      refreshClassViews();
    } else setProblem('error');
  };

  if (current.isPending) return <Card aria-busy="true" className="h-24" />;
  const cls = current.data;

  if (cls) {
    return (
      <Card
        data-testid="student-class-card"
        className="flex flex-wrap items-center justify-between gap-3 px-4 py-4"
      >
        <div>
          <p>{t('inClass', { name: cls.className })}</p>
          <p className="text-sm text-[var(--text-muted)]">
            {cls.schoolName
              ? t('teacherSchool', { teacher: cls.teacherName, school: cls.schoolName })
              : t('teacher', { teacher: cls.teacherName })}
          </p>
        </div>
        <Button variant="secondary" size="sm" onClick={() => setConfirmLeave(true)}>
          {t('leave')}
        </Button>
        <Modal
          open={confirmLeave}
          onOpenChange={setConfirmLeave}
          title={t('leaveConfirm', { name: cls.className })}
          closeLabel={t('cancel')}
        >
          <div className="flex flex-wrap justify-end gap-3">
            <Button variant="secondary" onClick={() => setConfirmLeave(false)}>
              {t('cancel')}
            </Button>
            <Button onClick={() => void leave()} disabled={pending}>
              {t('leaveYes')}
            </Button>
          </div>
        </Modal>
      </Card>
    );
  }

  return (
    <Card data-testid="student-join" className="p-5">
      <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold">
        <Users aria-hidden="true" className="size-5 text-[var(--accent)]" />
        {t('join')}
      </h2>
      <form
        className="flex flex-col gap-3 sm:flex-row sm:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          if (code.trim()) setConfirmJoin(true);
        }}
      >
        <div className="flex-1">
          <Field
            id="student-join-code"
            label={tj('codeLabel')}
            hint={tj('codeHint')}
            icon={<Users aria-hidden="true" className="size-4" />}
          >
            <Input
              value={code}
              placeholder={tj('codePlaceholder')}
              onChange={(e) => {
                setCode(e.target.value);
                setProblem(null);
              }}
              autoComplete="off"
              autoCapitalize="characters"
            />
          </Field>
        </div>
        <Button type="submit" disabled={!code.trim()} className="sm:min-h-[var(--field-h)]">
          {t('joinSubmit')}
        </Button>
      </form>
      {problem ? (
        <p role="alert" className="mt-3 text-sm text-[var(--danger-text)]">
          {problem === 'invalid'
            ? tj('invalid')
            : problem === 'battle'
              ? tj.rich('isBattleCode', {
                  link: (chunks) => (
                    <AppLink href="/learn/battles" className="font-semibold underline">
                      {chunks}
                    </AppLink>
                  ),
                })
              : problem === 'tooMany'
                ? tj('tooMany', { minutes: retryMinutes })
                : tf('serverError')}
        </p>
      ) : null}
      <Modal
        open={confirmJoin}
        onOpenChange={setConfirmJoin}
        title={tj('confirmTitle')}
        closeLabel={tj('cancel')}
      >
        <div className="flex flex-wrap justify-end gap-3">
          <Button variant="secondary" onClick={() => setConfirmJoin(false)}>
            {tj('cancel')}
          </Button>
          <Button onClick={() => void join()} disabled={pending}>
            {tj('confirm')}
          </Button>
        </div>
      </Modal>
    </Card>
  );
}
