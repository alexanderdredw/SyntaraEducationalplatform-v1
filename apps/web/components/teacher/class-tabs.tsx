'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { NavTabs } from '@syntara/ui';
import { usePathname } from '@/i18n/navigation';
import { apiRequest } from '@/lib/api/browser';
import type { components } from '@/lib/api/schema';
import { AppLink } from '../app-link';

type TeacherClass = components['schemas']['TeacherClassDto'];

const TABS = ['roster', 'mastery', 'analytics'] as const;

/**
 * Шапка страниц класса (REQ-TCH-AN-01, T10): «← К классам», название класса и вкладки «Ростер», «Карта освоения»,
 * «Аналитика класса» — ссылки на /teacher/classes/:id/{roster,mastery,analytics}; класс сохраняется при переключении.
 */
export function ClassTabs({ classId }: { classId: string }) {
  const t = useTranslations('teacher.analytics');
  const locale = useLocale();
  const pathname = usePathname();
  const classes = useQuery({
    queryKey: ['teacher', 'classes'],
    queryFn: async () => {
      const res = await apiRequest<TeacherClass[]>('/api/teacher/classes', { locale });
      if (res.kind !== 'ok') throw new Error('classes');
      return res.data;
    },
  });
  const name = classes.data?.find((c) => c.id === classId)?.name ?? '';
  return (
    <header className="flex flex-wrap items-center justify-between gap-4">
      <div className="flex items-center gap-4">
        <AppLink
          href="/teacher/classes"
          className="text-sm text-[var(--text-muted)] hover:text-[var(--text)]"
        >
          {t('back')}
        </AppLink>
        <h1 className="text-cabinet-title font-bold" data-testid="class-name">
          {name}
        </h1>
      </div>
      <NavTabs
        label={t('tabs')}
        link={AppLink}
        items={TABS.map((tab) => ({
          href: `/teacher/classes/${classId}/${tab}`,
          label: t(tab),
          active: pathname.endsWith(`/${tab}`),
        }))}
      />
    </header>
  );
}
