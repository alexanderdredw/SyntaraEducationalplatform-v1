'use client';

import { type ComponentType, type ReactNode } from 'react';
import { Tabs as TabsPrimitive, ToggleGroup, Accordion as AccordionPrimitive } from 'radix-ui';
import { ChevronRight } from 'lucide-react';
import { cn } from './cn';

export interface TabItem {
  value: string;
  label: string;
  /** Значок перед подписью (эталон U04: книга, карандаш, облачко); декоративный. */
  icon?: ReactNode;
  content?: ReactNode;
}

/**
 * Tabs (3.2): капсульные вкладки — отдельные капсулы с рамкой, активная — синяя заливка (эталоны U04–U07);
 * под списком — линия на всю ширину. ←/→ переключают (Radix).
 */
export function Tabs({
  items,
  value,
  defaultValue,
  onValueChange,
  label,
}: {
  items: TabItem[];
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  label: string;
}) {
  return (
    <TabsPrimitive.Root
      value={value}
      defaultValue={defaultValue ?? items[0]?.value}
      onValueChange={onValueChange}
    >
      <TabsPrimitive.List
        aria-label={label}
        className="flex flex-wrap gap-2 border-b border-[var(--border)] pb-3"
      >
        {items.map((item) => (
          <TabsPrimitive.Trigger
            key={item.value}
            value={item.value}
            className="inline-flex min-h-[var(--control-h)] items-center gap-2 rounded-[var(--radius-pill)] border border-[var(--border)] px-4 text-sm font-semibold text-[var(--text-muted)] hover:border-[var(--border-strong)] hover:text-[var(--text)] disabled:cursor-not-allowed disabled:opacity-50 data-[state=active]:border-[var(--accent-strong)] data-[state=active]:bg-[var(--accent-strong)] data-[state=active]:text-white"
          >
            {item.icon ? (
              <span aria-hidden="true" className="inline-flex [&_svg]:size-4">
                {item.icon}
              </span>
            ) : null}
            {item.label}
          </TabsPrimitive.Trigger>
        ))}
      </TabsPrimitive.List>
      {items.map((item) =>
        item.content === undefined ? null : (
          <TabsPrimitive.Content key={item.value} value={item.value} className="pt-6">
            {item.content}
          </TabsPrimitive.Content>
        ),
      )}
    </TabsPrimitive.Root>
  );
}

export interface SegmentOption {
  value: string;
  label: string;
  disabled?: boolean;
  /** Подпись рядом с недоступным вариантом, например «скоро» (PH-04). */
  hint?: string;
  /** Значок после подписи — например, отметка заполненного языка (эталон T05). Не меняет доступное имя. */
  adornment?: ReactNode;
}

/** SegmentedControl (3.2): RU/KK/EN, тип, сложность, период. Всегда выбран ровно один вариант. */
export function SegmentedControl({
  options,
  value,
  onValueChange,
  label,
  className,
}: {
  options: SegmentOption[];
  value: string;
  onValueChange: (value: string) => void;
  label: string;
  className?: string;
}) {
  return (
    <ToggleGroup.Root
      type="single"
      value={value}
      onValueChange={(next) => {
        if (next) onValueChange(next);
      }}
      aria-label={label}
      className={cn(
        'inline-flex flex-wrap gap-1 rounded-[var(--radius-pill)] border border-[var(--capsule-border)] bg-[var(--capsule)] p-1',
        className,
      )}
    >
      {options.map((o) => (
        <ToggleGroup.Item
          key={o.value}
          value={o.value}
          disabled={o.disabled}
          className="min-h-[var(--control-h)] rounded-[var(--radius-pill)] px-3.5 text-sm text-[var(--text-muted)] not-disabled:hover:text-[var(--text)] disabled:cursor-not-allowed disabled:opacity-50 data-[state=on]:bg-[var(--accent-strong)] data-[state=on]:text-white"
        >
          {o.label}
          {o.hint ? <span className="ml-1 text-xs">{o.hint}</span> : null}
          {o.adornment}
        </ToggleGroup.Item>
      ))}
    </ToggleGroup.Root>
  );
}

export interface AccordionItem {
  value: string;
  title: ReactNode;
  content: ReactNode;
}

/**
 * Accordion (3.2): разделы — отдельные карточки со стрелкой «›» справа (эталоны U04, U09, U12);
 * по умолчанию все свёрнуты, можно раскрыть несколько (PH-36).
 */
export function Accordion({ items, multiple = true }: { items: AccordionItem[]; multiple?: boolean }) {
  const list = items.map((item) => (
    <AccordionPrimitive.Item
      key={item.value}
      value={item.value}
      className="rounded-[14px] border border-[var(--border)] bg-[var(--surface)] has-[button:hover]:border-[var(--border-strong)]"
    >
      <AccordionPrimitive.Header>
        <AccordionPrimitive.Trigger className="group flex min-h-[52px] w-full items-center justify-between gap-3 rounded-[14px] px-5 py-3 text-left">
          {item.title}
          <ChevronRight
            aria-hidden="true"
            className="size-4 shrink-0 text-[var(--text-muted)] group-data-[state=open]:rotate-90"
          />
        </AccordionPrimitive.Trigger>
      </AccordionPrimitive.Header>
      <AccordionPrimitive.Content className="px-5 pb-5 text-[var(--text-muted)]">
        {item.content}
      </AccordionPrimitive.Content>
    </AccordionPrimitive.Item>
  ));
  const listClass = 'flex flex-col gap-3';
  return multiple ? (
    <AccordionPrimitive.Root type="multiple" className={listClass}>
      {list}
    </AccordionPrimitive.Root>
  ) : (
    <AccordionPrimitive.Root type="single" collapsible className={listClass}>
      {list}
    </AccordionPrimitive.Root>
  );
}

export interface NavTabItem {
  href: string;
  label: string;
  active: boolean;
}

/**
 * NavTabs (3.2): вкладки-ссылки между страницами (например, «Ростер» / «Карта освоения» / «Аналитика класса»,
 * REQ-TCH-AN-01) — оформление как у Tabs; текущая страница — aria-current. `link` — компонент ссылки приложения.
 */
export function NavTabs({
  items,
  label,
  link: Link,
}: {
  items: NavTabItem[];
  label: string;
  link: ComponentType<{ href: string; className?: string; 'aria-current'?: 'page'; children: ReactNode }>;
}) {
  return (
    <nav aria-label={label}>
      <ul className="inline-flex flex-wrap gap-1 rounded-[var(--radius-pill)] border border-[var(--capsule-border)] bg-[var(--capsule)] p-1">
        {items.map((item) => (
          <li key={item.href}>
            <Link
              href={item.href}
              aria-current={item.active ? 'page' : undefined}
              className={cn(
                'inline-flex min-h-[var(--control-h)] items-center rounded-[var(--radius-pill)] px-4 text-sm',
                item.active
                  ? 'bg-[var(--accent-strong)] text-white'
                  : 'text-[var(--text-muted)] hover:text-[var(--text)]',
              )}
            >
              {item.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
