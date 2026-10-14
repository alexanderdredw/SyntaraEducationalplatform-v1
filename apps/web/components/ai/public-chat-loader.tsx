'use client';

import dynamic from 'next/dynamic';
import { Skeleton } from '@syntara/ui';

/** REQ-NFR-PERF-01: ИИ-модуль (чат и Markdown) загружается динамическим импортом только на /ai. */
const PublicChat = dynamic(() => import('./public-chat'), {
  ssr: false,
  loading: () => <Skeleton className="h-96 w-full" />,
});

export function PublicChatLoader({ atlasUrls }: { atlasUrls: string[] }) {
  return <PublicChat atlasUrls={atlasUrls} />;
}
