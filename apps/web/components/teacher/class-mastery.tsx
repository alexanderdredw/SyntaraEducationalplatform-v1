'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Badge, type BadgeTone, Card, EmptyState, Field, Select, Skeleton, Table, Td, Th } from '@syntara/ui';
import { apiRequest } from '@/lib/api/browser';
import type { components } from '@/lib/api/schema';

type MasteryMap = components['schemas']['MasteryMapDto'];
type Status = 'mastered' | 'started' | 'not_started';

const TONES: Record<Status, BadgeTone> = { mastered: 'success', started: 'accent', not_started: 'neutral' };
const STATUSES: Status[] = ['mastered', 'started', 'not_started'];

/**
 * «Карта освоения» (REQ-TCH-AN-01, API-T-29, решение владельца 2026-10-17): таблица «ученики × темы» выбранного
 * предмета — базового или своего, выданного классу. Ячейка — цвет и подпись статуса («Освоена» ≥ 80 % / «Начата» /
 * «Не начата»), не только цвет. На узком экране прокручивается таблица (первый столбец закреплён).
 */
export function ClassMastery({ classId }: { classId: string }) {
  const t = useTranslations('teacher.mastery');
  const ta = useTranslations('teacher.analytics');
  const tas = useTranslations('teacher.assignments');
  const ts = useTranslations('student.subject.status');
  const locale = useLocale();
  const [subjectId, setSubjectId] = useState<string | null>(null);
  const data = useQuery({
    queryKey: ['teacher', 'mastery', classId, subjectId, locale],
    queryFn: async () => {
      const query = subjectId ? `?subjectId=${subjectId}` : '';
      const res = await apiRequest<MasteryMap>(`/api/teacher/classes/${classId}/mastery${query}`, { locale });
      if (res.kind !== 'ok') throw new Error('mastery');
      return res.data;
    },
    placeholderData: keepPreviousData,
  });
  if (!data.data) return <Skeleton className="h-64" />;
  const map = data.data;
  const subject = map.subjects.find((s) => s.id === map.subjectId);
  const label = (status: Status, percent: number | null) =>
    percent === null ? ts(status) : t('withPercent', { status: ts(status), percent });

  return (
    <div className="flex flex-col gap-4" data-testid="class-mastery">
      {map.subjects.length > 0 ? (
        <div className="max-w-sm">
          <Field label={tas('subject')}>
            <Select
              value={map.subjectId ?? undefined}
              options={map.subjects.map((s) => ({ value: s.id, label: s.title }))}
              onValueChange={setSubjectId}
            />
          </Field>
        </div>
      ) : null}

      <div
        className="flex flex-wrap items-center gap-2 text-sm text-[var(--text-muted)]"
        data-testid="mastery-legend"
      >
        <span>{t('legend')}:</span>
        {STATUSES.map((s) => (
          <Badge key={s} tone={TONES[s]}>
            {ts(s)}
          </Badge>
        ))}
      </div>

      {map.students.length === 0 ? (
        <Card>
          <EmptyState title={ta('noStudents')} />
        </Card>
      ) : map.topics.length === 0 ? (
        <Card>
          <EmptyState title={tas('noTopics')} />
        </Card>
      ) : (
        <Table
          label={t('title')}
          caption={t('caption', { subject: subject?.title ?? '' })}
          data-testid="mastery-table"
        >
          <thead>
            <tr>
              <Th scope="col" sticky>
                {t('student')}
              </Th>
              {map.topics.map((topic) => (
                <Th key={topic.id} scope="col">
                  {topic.title}
                </Th>
              ))}
            </tr>
          </thead>
          <tbody>
            {map.students.map((student) => (
              <tr key={student.id} data-testid="mastery-row">
                <Th scope="row" sticky>
                  {student.name}
                </Th>
                {map.topics.map((topic) => {
                  const cell = map.cells.find((c) => c.studentId === student.id && c.topicId === topic.id);
                  const status = (cell?.status ?? 'not_started') as Status;
                  return (
                    <Td key={topic.id} data-testid="mastery-cell" data-status={status}>
                      <Badge tone={TONES[status]}>{label(status, cell?.percent ?? null)}</Badge>
                    </Td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}
