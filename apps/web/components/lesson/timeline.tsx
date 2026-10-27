'use client';

import { useTranslations } from 'next-intl';
import type { components } from '@/lib/api/schema';

type TimelineEvent = NonNullable<components['schemas']['LessonDto']['timeline']>[number];

/**
 * Лента времени урока (REQ-TL-01…05): события по году; на компьютере — горизонтальная шкала с точками, на телефоне —
 * вертикальный список. Точка — кнопка: раскрывает раздел и прокручивает к нему (REQ-TL-04). Анимаций нет — ни при
 * «Экономии трафика», ни без неё (только видимый фокус).
 */
export function LessonTimeline({
  events,
  onSelect,
}: {
  events: TimelineEvent[];
  onSelect: (sectionId: string) => void;
}) {
  const t = useTranslations('student.lesson');
  return (
    <section aria-labelledby="lesson-timeline" className="flex flex-col gap-3" data-testid="lesson-timeline">
      <h3 id="lesson-timeline" className="text-cabinet-block font-semibold">
        {t('timeline')}
      </h3>
      <div className="md:overflow-x-auto md:pb-2">
        <ol className="relative flex flex-col gap-2 md:min-w-max md:flex-row md:gap-0 md:pt-2">
          {/* Линия шкалы — только на компьютере. */}
          <span
            aria-hidden="true"
            className="absolute left-0 right-0 top-[3.1rem] hidden h-0.5 bg-[var(--border-strong)] md:block"
          />
          {events.map((e) => (
            <li key={`${e.year}-${e.sectionId}`} className="md:w-36 md:shrink-0">
              <button
                type="button"
                onClick={() => onSelect(e.sectionId)}
                data-testid="timeline-point"
                className="group flex w-full items-start gap-3 rounded-[var(--radius-field)] p-2 text-left hover:bg-[var(--capsule)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)] md:flex-col md:items-center md:gap-2 md:text-center"
              >
                <span className="min-w-12 font-bold text-[var(--accent-bright)] md:min-w-0">{e.year}</span>
                <span
                  aria-hidden="true"
                  className="mt-1.5 hidden size-3.5 shrink-0 rounded-full border-2 border-[var(--surface)] bg-[var(--accent)] ring-2 ring-[var(--accent)] md:mt-0 md:block"
                />
                <span className="flex flex-col">
                  <span className="font-semibold">{e.name}</span>
                  {e.lived ? (
                    <span className="text-xs text-[var(--text-muted)]">
                      {e.lived.from}–{e.lived.to}
                    </span>
                  ) : null}
                  <span className="text-sm text-[var(--text-muted)]">{e.title}</span>
                </span>
              </button>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
