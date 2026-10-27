'use client';

import { createContext, type ReactNode, useContext } from 'react';
import { useLocale } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '@/lib/api/browser';
import type { components } from '@/lib/api/schema';
import { useLearnViewer } from '../../learn/viewer';
import type { Lesson } from '../../lesson/lesson-view';
import { lessonQueryKey } from '../../learn/query-keys';
import { atlasQueryKey } from './routes';

export type AtlasData = components['schemas']['AtlasDto'];
export type AtlasElement = AtlasData['elements'][number];
export type Glossary = components['schemas']['GlossaryDto'];

const SubjectContext = createContext<{ subjectId: string; timeZone: string }>({
  subjectId: '',
  timeZone: 'Asia/Almaty',
});

/** ID предмета модуля (адреса и запросы экранов атласа) и часовой пояс платформы (ключ lesson_opened). */
export function AtlasSubjectProvider({
  subjectId,
  timeZone,
  children,
}: {
  subjectId: string;
  timeZone: string;
  children: ReactNode;
}) {
  return <SubjectContext.Provider value={{ subjectId, timeZone }}>{children}</SubjectContext.Provider>;
}

export const useAtlasSubject = () => useContext(SubjectContext).subjectId;
export const usePlatformTimeZone = () => useContext(SubjectContext).timeZone;

/** Данные экранов атласа: ученик — со статусами тем (API-S-23), гость и учитель — без (API-PUB-15). */
export function useAtlasData() {
  const subjectId = useAtlasSubject();
  const locale = useLocale();
  const { guest, api } = useLearnViewer();
  return useQuery({
    queryKey: atlasQueryKey(subjectId, guest, locale),
    queryFn: async () => {
      const res = await apiRequest<AtlasData>(`${api}/subjects/${subjectId}/atlas`, { locale });
      if (res.kind !== 'ok') throw new Error('atlas');
      return res.data;
    },
    staleTime: 5 * 60_000,
  });
}

/** Урок темы (API-S-06 / API-PUB-13) — тексты окна элемента и экрана «Учёные». */
export function useAtlasLesson(topicId: string | undefined) {
  const locale = useLocale();
  const { guest, api } = useLearnViewer();
  return useQuery({
    queryKey: lessonQueryKey(topicId ?? '', guest, locale),
    queryFn: async () => {
      const res = await apiRequest<Lesson>(`${api}/topics/${topicId}`, { locale });
      if (res.kind !== 'ok') throw new Error('lesson');
      return res.data;
    },
    enabled: Boolean(topicId),
    staleTime: 5 * 60_000,
  });
}

/** Глоссарий предмета (API-S-22 / API-PUB-14) — экраны «Глоссарий» и «Поиск». */
export function useAtlasGlossary(enabled = true) {
  const subjectId = useAtlasSubject();
  const locale = useLocale();
  const { guest, api } = useLearnViewer();
  return useQuery({
    queryKey: ['student', 'glossary', subjectId, guest, locale],
    queryFn: async () => {
      const res = await apiRequest<Glossary>(`${api}/subjects/${subjectId}/glossary`, { locale });
      if (res.kind !== 'ok') throw new Error('glossary');
      return res.data;
    },
    enabled,
    staleTime: 5 * 60_000,
  });
}

/** Цвета групп атласа (AnatomyViewer.js, GROUP_COLORS): бейджи, фильтр, поиск, вид «Таблица». */
export const GROUP_COLORS: Record<string, string> = {
  nonmetal: '#4ADE80',
  noble_gas: '#C084FC',
  alkali_metal: '#F87171',
  alkaline_earth: '#FB923C',
  metalloid: '#FBBF24',
  halogen: '#A78BFA',
  transition_metal: '#60A5FA',
  post_transition: '#94A3B8',
  lanthanide: '#F472B6',
  actinide: '#34D399',
  scientist: '#FDE047',
};

/** Слои элемента и учёного (одинаковые у всех, `layers` в данных атласа) — чипы окна. */
export const ELEMENT_LAYERS = [
  'atomic_structure',
  'electron_shells',
  'physical_properties',
  'chemical_properties',
  'applications',
] as const;
export const SCIENTIST_LAYERS = ['biography', 'discovery', 'impact', 'ai_bridge'] as const;
