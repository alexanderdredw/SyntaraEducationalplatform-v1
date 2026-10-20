import { setRequestLocale } from 'next-intl/server';
import { BattleEditor } from '@/components/battle/battle-editor';
import { requireOwned } from '@/lib/require-owned';

/** /teacher/battles/:id (8.6.1, REQ-BTL-T02): редактор Battle-теста; только владелец (BR-BTL-12). */
export default async function Page({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  await requireOwned(`/api/teacher/battles/${encodeURIComponent(id)}`);
  return <BattleEditor battleId={id} />;
}
