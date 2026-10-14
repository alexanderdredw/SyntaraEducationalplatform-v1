'use client';

import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { cn } from '@syntara/ui';
import { apiRequest } from '@/lib/api/browser';
import type { components } from '@/lib/api/schema';

type School = components['schemas']['SchoolDto'];

export interface SchoolValue {
  schoolId: string;
  schoolName: string;
  manual: boolean;
}

const inputClass =
  'min-h-12 w-full rounded-xl border border-[var(--border)] bg-[var(--field)] px-4 text-base text-[var(--text)] placeholder:text-[var(--text-muted)] aria-[invalid=true]:border-[var(--danger)]';

/**
 * Школа ученика (REQ-GEN-AUTH-02): поиск по справочнику с автодополнением (API-PUB-09, ARIA combobox) или ввод
 * вручную — такая школа сохраняется с отметкой «не проверена».
 */
export function SchoolCombobox({
  id,
  value,
  onChange,
  error,
}: {
  id: string;
  value: SchoolValue;
  onChange: (value: SchoolValue) => void;
  error?: string;
}) {
  const t = useTranslations('studentAuth');
  const locale = useLocale();
  const listId = useId();
  const [query, setQuery] = useState(value.manual ? '' : value.schoolName);
  const [options, setOptions] = useState<School[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [searched, setSearched] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (value.manual || value.schoolId) return;
    if (timer.current) clearTimeout(timer.current);
    const q = query.trim();
    if (q.length < 2) return;
    timer.current = setTimeout(async () => {
      const res = await apiRequest<School[]>(`/api/public/schools?q=${encodeURIComponent(q)}`, { locale });
      setOptions(res.kind === 'ok' ? res.data : []);
      setSearched(true);
      setActive(-1);
      setOpen(true);
    }, 250);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [query, value.manual, value.schoolId, locale]);

  const choose = (school: School) => {
    onChange({ schoolId: school.id, schoolName: school.name, manual: false });
    setQuery(school.name);
    setOpen(false);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (!open || options.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => (i + 1) % options.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => (i <= 0 ? options.length - 1 : i - 1));
    } else if (e.key === 'Enter' && active >= 0) {
      e.preventDefault();
      choose(options[active]!);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  const describedBy = `${id}-hint${error ? ` ${id}-error` : ''}`;

  if (value.manual) {
    return (
      <div className="flex flex-col gap-2">
        <input
          id={id}
          className={inputClass}
          value={value.schoolName}
          maxLength={200}
          placeholder={t('schoolManualPlaceholder')}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          onChange={(e) => onChange({ schoolId: '', schoolName: e.target.value, manual: true })}
        />
        <button
          type="button"
          className="self-start text-xs text-[var(--text-muted)] underline hover:text-[var(--text)]"
          onClick={() => onChange({ schoolId: '', schoolName: '', manual: false })}
        >
          {t('schoolFromList')}
        </button>
        <p id={`${id}-hint`} className="text-xs text-[var(--text-muted)]">
          {t('schoolUnverified')}
        </p>
      </div>
    );
  }

  return (
    <div className="relative flex flex-col gap-2">
      <input
        id={id}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open && options.length > 0}
        aria-controls={listId}
        aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        autoComplete="off"
        className={inputClass}
        value={query}
        placeholder={t('schoolPlaceholder')}
        onChange={(e) => {
          setQuery(e.target.value);
          if (e.target.value.trim().length < 2) {
            setOptions([]);
            setSearched(false);
          }
          if (value.schoolId) onChange({ schoolId: '', schoolName: '', manual: false });
        }}
        onKeyDown={onKeyDown}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {open && options.length > 0 ? (
        <ul
          id={listId}
          role="listbox"
          className="absolute left-0 right-0 top-12 z-20 mt-1 max-h-64 overflow-auto rounded-xl border border-[var(--border)] bg-[var(--surface)] p-1 shadow-xl"
        >
          {options.map((school, i) => (
            <li
              key={school.id}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(school);
              }}
              className={cn(
                'flex min-h-11 cursor-pointer flex-col justify-center rounded-lg px-3 py-1 text-sm',
                i === active && 'bg-[var(--field)]',
              )}
            >
              <span>{school.name}</span>
              {school.city ? <span className="text-xs text-[var(--text-muted)]">{school.city}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
      {searched && options.length === 0 && !value.schoolId ? (
        <p role="status" className="text-xs text-[var(--text-muted)]">
          {t('schoolNoResults')}
        </p>
      ) : null}
      <button
        type="button"
        className="self-start text-xs text-[var(--text-muted)] underline hover:text-[var(--text)]"
        onClick={() => onChange({ schoolId: '', schoolName: query, manual: true })}
      >
        {t('schoolManual')}
      </button>
      <p id={`${id}-hint`} className="text-xs text-[var(--text-muted)]">
        {t('schoolHint')}
      </p>
    </div>
  );
}
