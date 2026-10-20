'use client';

import { type ReactNode, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { DropdownMenu } from 'radix-ui';
import { MoreHorizontal, Plus, Zap } from 'lucide-react';
import { type Locale, LOCALES } from '@syntara/shared';
import {
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  Modal,
  NavTabs,
  SegmentedControl,
  Skeleton,
} from '@syntara/ui';
import { useRouter } from '@/i18n/navigation';
import { apiRequest } from '@/lib/api/browser';
import type { components } from '@/lib/api/schema';
import { formatDateTime } from '@/lib/datetime';
import { AppLink } from '../app-link';
import { useErrorText } from '../forms/form-parts';
import { PageHeader } from '../teacher/parts';
import { LaunchDialog } from './launch-dialog';

type BattleItem = components['schemas']['BattleQuizListItemDto'];

/** Ширина страниц Battle учителя — как у заданий и аналитики (3.1: ~760 px). */
export const BATTLE_PAGE_WIDTH = 'max-w-[792px]';

/**
 * BT-T01 «Мои Battle» (/teacher/battles, REQ-BTL-T01): вкладки «Тесты» и «История игр», карточки тестов
 * (название, число вопросов, последняя игра, «Изменить», меню: дублировать, архивировать), «Новый Battle»,
 * пустое состояние с пояснением. Переключатель «Активные / Архив» нужен, чтобы вернуть тест из архива (API-BTL-04).
 */
export function TeacherBattles({
  tab,
  timeZone,
  history,
}: {
  tab: 'tests' | 'history';
  timeZone: string;
  /** Вкладка «История игр» (этап B5). */
  history?: ReactNode;
}) {
  const t = useTranslations('battle.teacher.list');
  return (
    <section
      className={`mx-auto flex ${BATTLE_PAGE_WIDTH} flex-col gap-6 px-4 py-8`}
      data-testid="teacher-battles"
    >
      <PageHeader title={t('title')} />
      <NavTabs
        label={t('tabsLabel')}
        link={AppLink}
        items={[
          { href: '/teacher/battles', label: t('tabTests'), active: tab === 'tests' },
          { href: '/teacher/battles?tab=history', label: t('tabHistory'), active: tab === 'history' },
        ]}
      />
      {tab === 'tests' ? <BattleTests timeZone={timeZone} /> : history}
    </section>
  );
}

function BattleTests({ timeZone }: { timeZone: string }) {
  const t = useTranslations('battle.teacher.list');
  const locale = useLocale();
  const queryClient = useQueryClient();
  const [archived, setArchived] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const key = ['teacher', 'battles', archived];

  const list = useQuery({
    queryKey: key,
    queryFn: async () => {
      const res = await apiRequest<BattleItem[]>(`/api/teacher/battles?archived=${archived}`, { locale });
      if (res.kind !== 'ok') throw new Error('battles');
      return res.data;
    },
  });

  async function act(item: BattleItem, action: 'duplicate' | 'archive' | 'restore') {
    const res =
      action === 'duplicate'
        ? await apiRequest(`/api/teacher/battles/${item.id}/duplicate`, { method: 'POST', locale })
        : await apiRequest(`/api/teacher/battles/${item.id}`, {
            method: 'PATCH',
            body: { archived: action === 'archive' },
            locale,
          });
    if (res.kind !== 'ok') return;
    setStatus(
      t(action === 'duplicate' ? 'duplicated' : action === 'archive' ? 'archivedDone' : 'restoredDone'),
    );
    await queryClient.invalidateQueries({ queryKey: ['teacher', 'battles'] });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SegmentedControl
          label={t('filterLabel')}
          value={archived ? 'archived' : 'active'}
          onValueChange={(v) => setArchived(v === 'archived')}
          options={[
            { value: 'active', label: t('active') },
            { value: 'archived', label: t('archived') },
          ]}
        />
        <NewBattleButton />
      </div>
      <p role="status" className="text-sm" data-testid="battles-status">
        {status}
      </p>
      {list.isPending ? <Skeleton className="h-28" /> : null}
      {list.data?.length === 0 ? (
        archived ? (
          <EmptyState title={t('emptyArchive')} />
        ) : (
          <EmptyState icon={<Zap className="size-6 text-[var(--accent)]" />} title={t('emptyTitle')}>
            <p className="max-w-md text-sm">{t('emptyText')}</p>
          </EmptyState>
        )
      ) : null}
      <ul className="grid gap-3" data-testid="battle-list">
        {list.data?.map((item) => (
          <li key={item.id}>
            <Card className="flex flex-wrap items-center gap-4 p-5" data-testid="battle-card">
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <h2 className="text-cabinet-block font-semibold [overflow-wrap:anywhere]">{item.title}</h2>
                <p className="text-sm text-[var(--text-muted)]">
                  {t('questions', { count: item.questionsCount })} ·{' '}
                  {item.lastPlayedAt
                    ? t('lastPlayed', { date: formatDateTime(item.lastPlayedAt, timeZone) })
                    : t('neverPlayed')}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {!item.archived && item.questionsCount > 0 ? (
                  <LaunchDialog
                    battleId={item.id}
                    trigger={<Button variant="primary-blue">{t('launch')}</Button>}
                  />
                ) : null}
                <AppLink
                  href={`/teacher/battles/${item.id}`}
                  className="inline-flex min-h-[var(--control-h)] items-center rounded-[var(--radius-pill)] border border-[var(--border)] px-4 text-sm font-semibold hover:border-[var(--border-strong)] hover:bg-[var(--field)]"
                >
                  {t('edit')}
                </AppLink>
                <DropdownMenu.Root>
                  <DropdownMenu.Trigger
                    aria-label={t('more', { title: item.title })}
                    className="inline-flex size-11 items-center justify-center rounded-full border border-[var(--border)] hover:border-[var(--border-strong)] hover:bg-[var(--field)]"
                  >
                    <MoreHorizontal aria-hidden="true" className="size-5" />
                  </DropdownMenu.Trigger>
                  <DropdownMenu.Portal>
                    <DropdownMenu.Content
                      align="end"
                      sideOffset={6}
                      className="z-50 min-w-48 rounded-[var(--radius-field)] border border-[var(--border)] bg-[var(--capsule)] p-1 text-[var(--text)] shadow-popover"
                    >
                      {(item.archived
                        ? (['duplicate', 'restore'] as const)
                        : (['duplicate', 'archive'] as const)
                      ).map((action) => (
                        <DropdownMenu.Item
                          key={action}
                          onSelect={() => void act(item, action)}
                          className="flex min-h-11 cursor-pointer items-center rounded-[var(--radius-item)] px-3 text-sm outline-none data-[highlighted]:bg-[var(--field)]"
                        >
                          {t(action === 'restore' ? 'unarchive' : action)}
                        </DropdownMenu.Item>
                      ))}
                    </DropdownMenu.Content>
                  </DropdownMenu.Portal>
                </DropdownMenu.Root>
              </div>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** «Новый Battle»: название и язык вопросов → API-BTL-02 → редактор. */
function NewBattleButton() {
  const t = useTranslations('battle.teacher');
  const tc = useTranslations('common');
  const tl = useTranslations('locale');
  const errorText = useErrorText();
  const locale = useLocale() as Locale;
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [language, setLanguage] = useState<Locale>(locale);
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  async function create() {
    if (!title.trim()) return setError('required');
    setBusy(true);
    const res = await apiRequest<{ id: string }>('/api/teacher/battles', {
      method: 'POST',
      body: { title: title.trim(), locale: language },
      locale,
    });
    setBusy(false);
    if (res.kind !== 'ok')
      return setError(res.kind === 'http' ? (res.error.fieldErrors?.title ?? 'required') : 'required');
    router.push(`/teacher/battles/${res.data.id}`);
  }

  return (
    <Modal
      open={open}
      onOpenChange={setOpen}
      title={t('create.title')}
      closeLabel={tc('close')}
      trigger={
        <Button variant="primary-blue">
          <Plus aria-hidden="true" className="size-4" />
          {t('list.new')}
        </Button>
      }
    >
      <form
        className="mt-4 flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void create();
        }}
      >
        <Field label={t('editor.name')} required error={errorText(error)}>
          <Input value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <div className="flex flex-col gap-2">
          <span className="text-[13px] text-[var(--text-muted)]">{t('editor.language')}</span>
          <SegmentedControl
            label={t('editor.language')}
            value={language}
            onValueChange={(v) => setLanguage(v as Locale)}
            options={LOCALES.map((l) => ({ value: l, label: tl(`names.${l}`) }))}
          />
          <p className="text-xs text-[var(--text-muted)]">{t('editor.languageHint')}</p>
        </div>
        <Button type="submit" variant="primary-blue" disabled={busy} className="self-start">
          {t('create.submit')}
        </Button>
      </form>
    </Modal>
  );
}
