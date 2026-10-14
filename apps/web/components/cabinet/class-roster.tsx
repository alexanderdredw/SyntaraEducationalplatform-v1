'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { Button, Modal } from '@syntara/ui';
import { apiRequest } from '@/lib/api/browser';
import type { components } from '@/lib/api/schema';

type RosterStudent = components['schemas']['RosterStudentDto'];

/**
 * Ученики класса (API-T-26, минимальная версия) и временный пароль для ученика без email (API-T-27, BR-CLS-05):
 * пароль показывается учителю один раз, ученик меняет его при входе.
 */
export function ClassRoster({ classId }: { classId: string }) {
  const t = useTranslations('teacher.classes');
  const tc = useTranslations('common');
  const tf = useTranslations('forms');
  const locale = useLocale();
  const [issued, setIssued] = useState<{ name: string; password: string } | null>(null);
  const [failed, setFailed] = useState(false);

  const roster = useQuery({
    queryKey: ['teacher', 'roster', classId],
    queryFn: async () => {
      const res = await apiRequest<RosterStudent[]>(`/api/teacher/classes/${classId}/roster`, { locale });
      if (res.kind !== 'ok') throw new Error('roster');
      return res.data;
    },
  });

  const temporary = async (student: RosterStudent) => {
    setFailed(false);
    const res = await apiRequest<{ temporaryPassword: string }>(
      `/api/teacher/classes/${classId}/students/${student.id}/temporary-password`,
      { method: 'POST', locale },
    );
    if (res.kind === 'ok') setIssued({ name: student.displayName, password: res.data.temporaryPassword });
    else setFailed(true);
  };

  if (roster.isPending) return <p role="status" aria-busy="true" className="text-sm" />;
  if (!roster.data || roster.data.length === 0) {
    return <p className="text-sm text-[var(--text-muted)]">{t('noStudents')}</p>;
  }
  return (
    <div className="flex flex-col gap-2" data-testid="class-roster">
      <ul className="flex flex-col divide-y divide-[var(--border)]">
        {roster.data.map((student) => (
          <li key={student.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
            <span>
              {student.displayName}
              {student.login ? <span className="text-[var(--text-muted)]"> · {student.login}</span> : null}
            </span>
            {student.hasEmail ? (
              <span className="text-xs text-[var(--text-muted)]">{t('hasEmail')}</span>
            ) : (
              <Button variant="secondary" onClick={() => void temporary(student)}>
                {t('tempPassword')}
              </Button>
            )}
          </li>
        ))}
      </ul>
      {failed ? (
        <p role="alert" className="text-sm text-[var(--danger-text)]">
          {tf('serverError')}
        </p>
      ) : null}
      <Modal
        open={issued !== null}
        onOpenChange={(open) => !open && setIssued(null)}
        title={issued ? t('tempTitle', { name: issued.name }) : ''}
        closeLabel={tc('close')}
      >
        {issued ? (
          <div className="flex flex-col gap-3">
            <p data-testid="temporary-password" className="font-mono text-3xl font-bold tracking-widest">
              {issued.password}
            </p>
            <p className="text-sm text-[var(--text-muted)]">{t('tempOnce')}</p>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
