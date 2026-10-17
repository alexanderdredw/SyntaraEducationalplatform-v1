'use client';

import dynamic from 'next/dynamic';
import { Skeleton } from '@syntara/ui';
import { type TutorChatProps } from './tutor-chat';

/** REQ-NFR-PERF-01: учебный ИИ (чат и Markdown) загружается динамическим импортом — только когда открыт. */
const TutorChat = dynamic(() => import('./tutor-chat'), {
  ssr: false,
  loading: () => <Skeleton className="h-64 w-full" />,
});

export function TutorChatLoader(props: TutorChatProps) {
  return <TutorChat {...props} />;
}
