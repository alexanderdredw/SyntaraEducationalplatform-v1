'use client';

import { type ReactNode } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ClipboardList, Flame, Plus, Trophy, Zap } from 'lucide-react';
import { Avatar, BadgeIcon, Button, Card, cn, ProgressBar, Skeleton } from '@syntara/ui';
import { apiRequest } from '@/lib/api/browser';
import { ACTIVITY_KEY, DASHBOARD_KEY, PROFILE_KEY } from '../learn/query-keys';
import type { components } from '@/lib/api/schema';
import { formatDateTime } from '@/lib/datetime';
import { AppLink } from '../app-link';
import { ActivityCalendar } from './activity-calendar';

type Profile = components['schemas']['ProfileDto'];
type Dashboard = components['schemas']['DashboardDto'];
type Activity = components['schemas']['ActivityDto'];
type StudentDashboard = components['schemas']['StudentDashboardDto'];
type TeacherDashboard = components['schemas']['TeacherDashboardDto'];

const linkClass = 'text-sm font-medium text-[var(--accent-bright)] hover:underline';

/**
 * «Личный кабинет», вкладка «Обзор» (REQ-PRF-22…25; шапка — REQ-PRF-20 в оболочке): заполненность, карточки роли
 * в порядке REQ-PRF-23 (высота в ряду одинаковая), календарь активности ученика, пустые состояния с действием.
 * Числа — из тех же сервисов, что разделы (AC-PRF-02).
 */
export function AccountOverview({ timeZone }: { timeZone: string }) {
  const t = useTranslations('account.overview');
  const locale = useLocale();
  const get =
    <T,>(path: string) =>
    async () => {
      const res = await apiRequest<T>(path, { locale });
      if (res.kind !== 'ok') throw new Error(path);
      return res.data;
    };
  const profile = useQuery({ queryKey: PROFILE_KEY, queryFn: get<Profile>('/api/me/profile') });
  const dashboard = useQuery({ queryKey: DASHBOARD_KEY, queryFn: get<Dashboard>('/api/me/dashboard') });

  return (
    <div className="flex flex-col gap-6" data-testid="account-overview">
      {/* Имя и роль — в шапке; заголовок страницы — для экранного диктора. */}
      <h1 className="sr-only">{t('title')}</h1>
      {profile.data ? <Completeness profile={profile.data} /> : null}
      {dashboard.isError ? (
        <p role="alert" className="text-sm text-[var(--danger-text)]">
          {t('loadFailed')}
        </p>
      ) : dashboard.data?.student ? (
        <StudentOverview data={dashboard.data.student} timeZone={timeZone} />
      ) : dashboard.data?.teacher ? (
        <TeacherOverview data={dashboard.data.teacher} timeZone={timeZone} />
      ) : (
        <Card aria-busy="true" className="flex flex-col gap-3">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-full" />
        </Card>
      )}
    </div>
  );
}

function Block({
  title,
  testId,
  children,
  action,
  className,
}: {
  title: string;
  testId: string;
  children: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <Card className={cn('flex h-full flex-col gap-3', className)} data-testid={testId}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-cabinet-block font-semibold">{title}</h2>
        {action}
      </div>
      {children}
    </Card>
  );
}

/** REQ-PRF-24: пустое состояние с действием. */
function Empty({ text, action, href }: { text: string; action?: string; href?: string }) {
  return (
    <div className="flex flex-1 flex-col items-start justify-center gap-2" data-testid="overview-empty">
      <p className="text-sm text-[var(--text-muted)]">{text}</p>
      {action && href ? (
        <AppLink href={href} className={linkClass}>
          {action}
        </AppLink>
      ) : null}
    </div>
  );
}

/** Ряд из двух карточек одной высоты (REQ-PRF-23). */
const Row = ({ children }: { children: ReactNode }) => (
  <div className="grid items-stretch gap-6 lg:grid-cols-2">{children}</div>
);

/** REQ-PRF-22: «Профиль заполнен на N %» и недостающее со ссылками; «Скрыть» — на 30 дней (API-ME-18). */
function Completeness({ profile }: { profile: Profile }) {
  const t = useTranslations('account.completeness');
  const queryClient = useQueryClient();
  const c = profile.completeness;
  if (c.percent >= 100 || c.hiddenUntil) return null;
  const href = (key: string) =>
    key === 'email' || key === 'emailVerified' ? '/account/settings#email' : '/account/profile';
  const hide = async () => {
    const res = await apiRequest('/api/me/profile-completeness/hide', { method: 'POST' });
    if (res.kind === 'ok') await queryClient.invalidateQueries({ queryKey: PROFILE_KEY });
  };
  return (
    <Card tone="callout" className="flex flex-col gap-3" data-testid="profile-completeness">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-cabinet-block font-semibold">{t('title', { percent: c.percent })}</h2>
        <Button variant="text" size="sm" onClick={() => void hide()}>
          {t('hide')}
        </Button>
      </div>
      <ProgressBar value={c.percent} label={t('title', { percent: c.percent })} />
      <ul className="flex flex-col gap-1.5">
        {/* Без email подтверждать нечего: остаётся одна ссылка «Добавь email» (процент считается как есть). */}
        {c.missing
          .filter((key) => !(key === 'emailVerified' && c.missing.includes('email')))
          .map((key) => (
            <li key={key}>
              <AppLink href={href(key)} className={linkClass} data-testid={`completeness-${key}`}>
                {t(`items.${key}`)} →
              </AppLink>
            </li>
          ))}
      </ul>
    </Card>
  );
}

function StudentOverview({ data, timeZone }: { data: StudentDashboard; timeZone: string }) {
  const t = useTranslations('account.overview.student');
  const ta = useTranslations('student.achievements');
  const tp = useTranslations('student.progress');
  const tc = useTranslations('student.class');
  const tm = useTranslations('student.myClass');
  const tcal = useTranslations('account.calendar');
  const locale = useLocale();
  const activity = useQuery({
    queryKey: ACTIVITY_KEY,
    queryFn: async () => {
      const res = await apiRequest<Activity>('/api/me/activity?weeks=12', { locale });
      if (res.kind !== 'ok') throw new Error('activity');
      return res.data;
    },
  });
  const a = data.achievements;
  const step = data.nextStep;
  return (
    <div className="flex flex-col gap-6">
      {/* (1) «С чего начать сейчас?» — на всю ширину. */}
      <Block title={tp('start.title')} testId="overview-next-step">
        <p className="text-sm" data-testid="overview-next-action" data-action={step.action}>
          {tp(`actions.${step.action}`, {
            topic: step.topicTitle ?? '',
            due: step.dueAt ? formatDateTime(step.dueAt, timeZone) : '',
          })}
        </p>
        <p className="text-xs text-[var(--text-muted)]">
          {tp(`reasons.${step.reason}`, { percent: step.percent ?? 0 })}
        </p>
        <div>
          <Button asChild>
            <AppLink href={step.href}>{tp('start.label')} →</AppLink>
          </Button>
        </div>
      </Block>

      {/* (2) «Мой прогресс» | «Достижения». */}
      <Row>
        <Block
          title={`${t('progressTitle')} · ${t('progressPeriod')}`}
          testId="overview-progress"
          action={
            <AppLink href="/learn/progress" className={linkClass}>
              {t('more')}
            </AppLink>
          }
        >
          <p className="text-2xl font-bold" data-testid="overview-progress-percent">
            {data.progress.percent} %
          </p>
          <p className="text-sm text-[var(--text-muted)]">
            {tm('progress', { mastered: data.progress.mastered, total: data.progress.total })}
          </p>
          <ProgressBar value={data.progress.percent} label={t('progressTitle')} />
        </Block>
        <Block
          title={t('achievements')}
          testId="overview-achievements"
          action={
            <AppLink href="/learn/achievements" className={linkClass}>
              {t('allAchievements')}
            </AppLink>
          }
        >
          <div className="flex flex-wrap items-center gap-4 text-sm">
            <span className="inline-flex items-center gap-1.5 font-semibold">
              <Trophy aria-hidden="true" className="size-4 text-[var(--warning)]" />
              {ta('level', { level: a.level })}
              {a.rankTitle ? (
                <span className="font-normal text-[var(--text-muted)]">· {a.rankTitle}</span>
              ) : null}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Zap aria-hidden="true" className="size-4 text-[var(--text-muted)]" />
              {ta('xpTotal', { xp: a.xpTotal })}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Flame aria-hidden="true" className="size-4 text-[var(--text-muted)]" />
              {ta('streak', { days: a.streakDays })}
            </span>
          </div>
          <ProgressBar
            value={a.xpPerLevel ? Math.round(((a.xpPerLevel - a.xpToNext) / a.xpPerLevel) * 100) : 0}
            label={ta('levelProgress')}
          />
          <p className="text-xs text-[var(--text-muted)]">{ta('toNext', { xp: a.xpToNext })}</p>
        </Block>
      </Row>

      {/* (3) Календарь активности — на всю ширину (REQ-PRF-21). */}
      <Block title={tcal('title')} testId="overview-activity">
        {activity.data ? (
          <ActivityCalendar data={activity.data} timeZone={timeZone} />
        ) : (
          <Skeleton className="h-36 w-full" />
        )}
      </Block>

      {/* (4) «Ближайшие задания» | «Класс». */}
      <Row>
        <Block
          title={tm('upcoming')}
          testId="overview-assignments"
          action={
            data.assignments.length ? (
              <AppLink href="/learn/assignments" className={linkClass}>
                {tm('allAssignments')}
              </AppLink>
            ) : undefined
          }
        >
          {data.assignments.length ? (
            <ul className="flex flex-col gap-2">
              {data.assignments.map((item) => (
                <li
                  key={item.id}
                  className="flex items-start gap-2 text-sm"
                  data-testid="overview-assignment"
                >
                  <ClipboardList
                    aria-hidden="true"
                    className="mt-0.5 size-4 shrink-0 text-[var(--text-muted)]"
                  />
                  <span className="min-w-0">
                    <span className="font-medium">{item.topicTitle}</span>
                    <span className="block text-xs text-[var(--text-muted)]">
                      {item.subjectTitle} · {formatDateTime(item.dueAt, timeZone)}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <Empty text={tm('noAssignments')} action={t('noAssignmentsAction')} href="/learn/subjects" />
          )}
        </Block>
        <Block title={t('classTitle')} testId="overview-class">
          {data.class ? (
            <>
              <p className="text-sm font-semibold">{tc('inClass', { name: data.class.name })}</p>
              <div className="flex items-center gap-3">
                <Avatar
                  name={data.class.teacher.name}
                  avatar={data.class.teacher.avatar}
                  size={40}
                  decorative
                />
                <span className="text-sm">{tc('teacher', { teacher: data.class.teacher.name })}</span>
              </div>
              <AppLink href="/learn/class" className={cn(linkClass, 'mt-auto')}>
                {tm('title')} →
              </AppLink>
            </>
          ) : (
            <Empty text={t('noClass')} action={t('noClassAction')} href="/learn/class" />
          )}
        </Block>
      </Row>

      {/* (5) «Последние бейджи» | «Последний Battle». */}
      <Row>
        <Block title={t('badgesTitle')} testId="overview-badges">
          {data.badges.length ? (
            <ul className="flex flex-wrap gap-3">
              {data.badges.map((b) => (
                <li key={b.code} className="flex items-center gap-2 text-sm" data-testid="overview-badge">
                  {/* FIX-05: та же иконка и цвет, что в «Достижениях». */}
                  <BadgeIcon code={b.code} imageUrl={b.imageUrl} size={40} />
                  {b.title}
                </li>
              ))}
            </ul>
          ) : (
            <Empty text={t('noBadgesTitle')} action={t('noBadgesAction')} href="/learn/subjects" />
          )}
        </Block>
        <Block
          title={t('battleTitle')}
          testId="overview-battle"
          action={
            data.lastBattle ? (
              <AppLink href="/learn/battles" className={linkClass}>
                {t('myBattles')}
              </AppLink>
            ) : undefined
          }
        >
          {data.lastBattle ? (
            <AppLink
              href={`/learn/battles/${data.lastBattle.sessionId}/results`}
              className="text-sm hover:underline"
            >
              <span className="font-medium">{data.lastBattle.title}</span>
              <span className="block text-[var(--text-muted)]">
                {data.lastBattle.place
                  ? t('battleResult', {
                      place: data.lastBattle.place,
                      correct: data.lastBattle.correct,
                      total: data.lastBattle.total,
                    })
                  : t('battleNoPlace', { correct: data.lastBattle.correct, total: data.lastBattle.total })}
              </span>
            </AppLink>
          ) : (
            <Empty text={t('noBattle')} action={t('noBattleAction')} href="/learn/battles" />
          )}
        </Block>
      </Row>
    </div>
  );
}

function TeacherOverview({ data, timeZone }: { data: TeacherDashboard; timeZone: string }) {
  const t = useTranslations('account.overview.teacher');
  const actions = [
    { key: 'newSubject', href: '/teacher/subjects/new' },
    { key: 'assign', href: '/teacher/assignments' },
    { key: 'launchBattle', href: '/teacher/battles' },
    { key: 'createClass', href: '/teacher/classes' },
  ] as const;
  return (
    <div className="flex flex-col gap-6">
      {/* (1) «Требуют внимания» | «Ближайшие сроки заданий»; сводка — в строке цифр шапки (REQ-PRF-23). */}
      <Row>
        <Block title={t('attention')} testId="overview-attention">
          {data.review.enabled ? (
            <p className="text-sm">{t('review', { count: data.review.count })}</p>
          ) : null}
          {data.attention.length ? (
            <ul className="flex flex-col gap-2">
              {data.attention.map((a) => (
                <li key={`${a.classId}:${a.studentId}`}>
                  {/* REQ-PRF-25: ссылка на аналитику класса с подсветкой ученика.
                      TODO(OWNER): причина «тема ниже 50 %» — в API-T-25 по ученикам её нет (только «неактивен»). */}
                  <AppLink
                    href={`/teacher/classes/${a.classId}/analytics?student=${a.studentId}`}
                    data-testid="overview-attention-student"
                    className="flex items-center gap-3 rounded-[var(--radius-field)] p-1 text-sm hover:bg-[var(--field)]"
                  >
                    <Avatar name={a.name} avatar={a.avatar} size={32} decorative />
                    <span className="min-w-0">
                      <span className="block font-medium">{a.name}</span>
                      <span className="block text-xs text-[var(--text-muted)]">
                        {a.daysInactive === null
                          ? t('reasonNever', { className: a.className })
                          : t('reasonInactive', { className: a.className, days: a.daysInactive })}
                      </span>
                    </span>
                  </AppLink>
                </li>
              ))}
            </ul>
          ) : (
            <Empty text={t('allActive')} />
          )}
        </Block>

        <Block title={t('deadlines')} testId="overview-deadlines">
          {data.deadlines.length ? (
            <ul className="flex flex-col gap-3">
              {data.deadlines.map((d) => (
                <li key={d.id} className="text-sm" data-testid="overview-deadline">
                  <AppLink href="/teacher/assignments" className="flex flex-col gap-1 hover:underline">
                    <span className="font-medium">{d.topicTitle}</span>
                    <span className="block text-xs text-[var(--text-muted)]">
                      {d.className} · {formatDateTime(d.dueAt, timeZone)}
                    </span>
                    {/* REQ-PRF-25: прогресс сдачи «Сдано X из Y» с мини-полосой. */}
                    <span className="text-xs" data-testid="overview-deadline-progress">
                      {t('submitted', { submitted: d.submitted, total: d.total })}
                    </span>
                    <ProgressBar
                      value={d.total ? Math.round((d.submitted / d.total) * 100) : 0}
                      label={t('submitted', { submitted: d.submitted, total: d.total })}
                      className="h-1.5"
                    />
                  </AppLink>
                </li>
              ))}
            </ul>
          ) : (
            <Empty text={t('noDeadlines')} action={t('assign')} href="/teacher/assignments" />
          )}
        </Block>
      </Row>

      {/* (2) «Последние Battle» | «Быстрые действия». */}
      <Row>
        <Block title={t('battles')} testId="overview-battles">
          {data.battles.length ? (
            <ul className="flex flex-col gap-2">
              {data.battles.map((b) => (
                <li key={b.sessionId} className="text-sm">
                  <AppLink
                    href={`/teacher/battle-sessions/${b.sessionId}/results`}
                    className="hover:underline"
                  >
                    <span className="font-medium">{b.title}</span>
                    <span className="block text-xs text-[var(--text-muted)]">
                      {t('participants', { count: b.participants })}
                      {b.finishedAt ? ` · ${formatDateTime(b.finishedAt, timeZone)}` : ''}
                    </span>
                  </AppLink>
                </li>
              ))}
            </ul>
          ) : (
            <Empty text={t('noBattles')} action={t('noBattlesAction')} href="/teacher/battles" />
          )}
        </Block>

        <Block title={t('actions')} testId="overview-actions">
          <div className="flex flex-wrap gap-2">
            {actions.map((a) => (
              <Button key={a.key} variant="secondary" asChild>
                <AppLink href={a.href}>
                  <Plus aria-hidden="true" className="size-4" />
                  {t(a.key)}
                </AppLink>
              </Button>
            ))}
          </div>
        </Block>
      </Row>
    </div>
  );
}
