'use client';

import { type ReactNode } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { BookOpen, ClipboardList, Flame, Plus, Trophy, Users, Zap } from 'lucide-react';
import { Avatar, Badge, Button, Card, ProgressBar, Skeleton } from '@syntara/ui';
import { apiRequest } from '@/lib/api/browser';
import type { components } from '@/lib/api/schema';
import { formatDateTime } from '@/lib/datetime';
import { AppLink } from '../app-link';

type Profile = components['schemas']['ProfileDto'];
type Dashboard = components['schemas']['DashboardDto'];
type StudentDashboard = components['schemas']['StudentDashboardDto'];
type TeacherDashboard = components['schemas']['TeacherDashboardDto'];

const linkClass = 'text-sm font-medium text-[var(--accent-bright)] hover:underline';

/**
 * «Личный кабинет», вкладка «Обзор» (REQ-PRF-02…04): карточка профиля и сводка роли (API-ME-06, API-ME-12).
 * Числа — из тех же сервисов, что «Показатели», «Достижения», «Мои задания» и аналитика (AC-PRF-02).
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
  const profile = useQuery({ queryKey: ['me', 'profile'], queryFn: get<Profile>('/api/me/profile') });
  const dashboard = useQuery({ queryKey: ['me', 'dashboard'], queryFn: get<Dashboard>('/api/me/dashboard') });

  return (
    <div className="flex flex-col gap-6" data-testid="account-overview">
      <h1 className="text-cabinet-title font-bold">{t('title')}</h1>
      {profile.data ? <ProfileCard profile={profile.data} timeZone={timeZone} /> : <CardSkeleton />}
      {dashboard.isError ? (
        <p role="alert" className="text-sm text-[var(--danger-text)]">
          {t('loadFailed')}
        </p>
      ) : dashboard.data?.student ? (
        <StudentOverview data={dashboard.data.student} timeZone={timeZone} />
      ) : dashboard.data?.teacher ? (
        <TeacherOverview data={dashboard.data.teacher} timeZone={timeZone} />
      ) : (
        <CardSkeleton />
      )}
    </div>
  );
}

function CardSkeleton() {
  return (
    <Card aria-busy="true" className="flex flex-col gap-3">
      <Skeleton className="h-6 w-48" />
      <Skeleton className="h-4 w-full" />
    </Card>
  );
}

function Block({
  title,
  testId,
  children,
  action,
}: {
  title: string;
  testId: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <Card className="flex flex-col gap-3" data-testid={testId}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-cabinet-block font-semibold">{title}</h2>
        {action}
      </div>
      {children}
    </Card>
  );
}

/** REQ-PRF-02: аватар ≈ 96 px, имя, роль, логин или email, школа, «На платформе с …», «Редактировать профиль». */
function ProfileCard({ profile, timeZone }: { profile: Profile; timeZone: string }) {
  const t = useTranslations('account.overview');
  const tr = useTranslations('cabinet.roles');
  const locale = useLocale();
  const name = [profile.firstName, profile.lastName].filter(Boolean).join(' ');
  const since = new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone }).format(
    new Date(profile.createdAt),
  );
  return (
    <Card className="flex flex-col gap-5 sm:flex-row sm:items-center" data-testid="profile-card">
      <Avatar name={name} avatar={profile.avatar} size={96} />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-xl font-bold break-words">{name}</h2>
          <Badge tone="accent">{tr(profile.role)}</Badge>
        </div>
        <p className="text-sm text-[var(--text-muted)] break-all">
          {profile.role === 'student' && profile.login ? profile.login : (profile.email ?? profile.login)}
        </p>
        {profile.school ? <p className="text-sm">{profile.school.name}</p> : null}
        <p className="text-xs text-[var(--text-muted)]">{t('since', { date: since })}</p>
      </div>
      <Button variant="secondary" asChild>
        <AppLink href="/account/profile">{t('editProfile')}</AppLink>
      </Button>
    </Card>
  );
}

function StudentOverview({ data, timeZone }: { data: StudentDashboard; timeZone: string }) {
  const t = useTranslations('account.overview.student');
  const ta = useTranslations('student.achievements');
  const tp = useTranslations('student.progress');
  const tc = useTranslations('student.class');
  const tm = useTranslations('student.myClass');
  const a = data.achievements;
  const step = data.nextStep;
  return (
    <div className="grid gap-6 lg:grid-cols-2">
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
          </>
        ) : (
          <div>
            <Button variant="secondary" asChild>
              <AppLink href="/learn/class">{tc('join')}</AppLink>
            </Button>
          </div>
        )}
      </Block>

      <Block
        title={tm('upcoming')}
        testId="overview-assignments"
        action={
          <AppLink href="/learn/assignments" className={linkClass}>
            {tm('allAssignments')}
          </AppLink>
        }
      >
        {data.assignments.length ? (
          <ul className="flex flex-col gap-2">
            {data.assignments.map((item) => (
              <li key={item.id} className="flex items-start gap-2 text-sm" data-testid="overview-assignment">
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
          <p className="text-sm text-[var(--text-muted)]">{tm('noAssignments')}</p>
        )}
      </Block>

      <Block title={t('badgesTitle')} testId="overview-badges">
        {data.badges.length ? (
          <ul className="flex flex-wrap gap-3">
            {data.badges.map((b) => (
              <li key={b.code} className="flex items-center gap-2 text-sm" data-testid="overview-badge">
                {b.imageUrl ? (
                  <img src={b.imageUrl} alt="" width={32} height={32} className="size-8 rounded-full" />
                ) : (
                  <Trophy aria-hidden="true" className="size-6 text-[var(--warning)]" />
                )}
                {b.title}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-[var(--text-muted)]">{t('noBadges')}</p>
        )}
      </Block>

      <Block
        title={t('battleTitle')}
        testId="overview-battle"
        action={
          <AppLink href="/learn/battles" className={linkClass}>
            {t('myBattles')}
          </AppLink>
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
          <p className="text-sm text-[var(--text-muted)]">{t('noBattle')}</p>
        )}
      </Block>
    </div>
  );
}

function TeacherOverview({ data, timeZone }: { data: TeacherDashboard; timeZone: string }) {
  const t = useTranslations('account.overview.teacher');
  const counts = [
    { key: 'classes', icon: Users },
    { key: 'students', icon: Users },
    { key: 'subjects', icon: BookOpen },
    { key: 'publishedTopics', icon: BookOpen },
  ] as const;
  const actions = [
    { key: 'newSubject', href: '/teacher/subjects/new' },
    { key: 'assign', href: '/teacher/assignments' },
    { key: 'launchBattle', href: '/teacher/battles' },
    { key: 'createClass', href: '/teacher/classes' },
  ] as const;
  return (
    <div className="flex flex-col gap-6">
      <Block title={t('summary')} testId="overview-summary">
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {counts.map(({ key, icon: Icon }) => (
            <div
              key={key}
              className="rounded-[var(--radius-field)] bg-[var(--field)] p-3"
              data-testid={`overview-count-${key}`}
            >
              <dt className="flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
                <Icon aria-hidden="true" className="size-3.5" />
                {t(`counts.${key}`)}
              </dt>
              <dd className="text-2xl font-bold">{data.counts[key]}</dd>
            </div>
          ))}
        </dl>
      </Block>

      <div className="grid gap-6 lg:grid-cols-2">
        <Block title={t('attention')} testId="overview-attention">
          {data.review.enabled ? (
            <p className="text-sm">{t('review', { count: data.review.count })}</p>
          ) : null}
          {data.attention.length ? (
            <ul className="flex flex-col gap-2">
              {data.attention.map((a) => (
                <li key={`${a.classId}:${a.studentId}`}>
                  <AppLink
                    href={`/teacher/classes/${a.classId}/analytics`}
                    className="flex items-center gap-3 rounded-[var(--radius-field)] p-1 text-sm hover:bg-[var(--field)]"
                  >
                    <Avatar name={a.name} avatar={a.avatar} size={32} decorative />
                    <span className="min-w-0">
                      <span className="block font-medium">{a.name}</span>
                      <span className="block text-xs text-[var(--text-muted)]">
                        {a.lastActivityAt
                          ? t('lastActivity', {
                              className: a.className,
                              date: formatDateTime(a.lastActivityAt, timeZone),
                            })
                          : t('noActivity', { className: a.className })}
                      </span>
                    </span>
                  </AppLink>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-[var(--text-muted)]">{t('noAttention')}</p>
          )}
        </Block>

        <Block title={t('deadlines')} testId="overview-deadlines">
          {data.deadlines.length ? (
            <ul className="flex flex-col gap-2">
              {data.deadlines.map((d) => (
                <li key={d.id} className="text-sm">
                  <AppLink href="/teacher/assignments" className="hover:underline">
                    <span className="font-medium">{d.topicTitle}</span>
                    <span className="block text-xs text-[var(--text-muted)]">
                      {d.className} · {formatDateTime(d.dueAt, timeZone)}
                    </span>
                  </AppLink>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-[var(--text-muted)]">{t('noDeadlines')}</p>
          )}
        </Block>

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
            <p className="text-sm text-[var(--text-muted)]">{t('noBattles')}</p>
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
      </div>
    </div>
  );
}
