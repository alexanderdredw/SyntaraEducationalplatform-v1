import { setRequestLocale } from 'next-intl/server';
import { AssistantPage } from '@/components/learn/assistant-page';

/** /learn/assistant (8.4.5, REQ-ST-AI-03, U02): общий учебный ИИ ученика. Только роль student (layout). */
export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  setRequestLocale((await params).locale);
  return <AssistantPage />;
}
