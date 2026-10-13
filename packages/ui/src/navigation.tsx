'use client';

import { type ReactNode } from 'react';
import { Tabs as TabsPrimitive, ToggleGroup, Accordion as AccordionPrimitive } from 'radix-ui';
import { cn } from './cn';

export interface TabItem {
  value: string;
  label: string;
  content?: ReactNode;
}

/** Tabs (3.2): капсульные вкладки; ←/→ переключают (Radix). */
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
        className="inline-flex gap-1 rounded-[var(--radius-pill)] border border-[var(--border)] bg-[var(--surface)] p-1"
      >
        {items.map((item) => (
          <TabsPrimitive.Trigger
            key={item.value}
            value={item.value}
            className="min-h-11 rounded-[var(--radius-pill)] px-4 text-sm text-[var(--text-muted)] data-[state=active]:bg-[var(--text)] data-[state=active]:text-[var(--bg)]"
          >
            {item.label}
          </TabsPrimitive.Trigger>
        ))}
      </TabsPrimitive.List>
      {items.map((item) =>
        item.content === undefined ? null : (
          <TabsPrimitive.Content key={item.value} value={item.value} className="pt-4">
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
        'inline-flex gap-1 rounded-[var(--radius-pill)] border border-[var(--border)] bg-[var(--field)] p-1',
        className,
      )}
    >
      {options.map((o) => (
        <ToggleGroup.Item
          key={o.value}
          value={o.value}
          disabled={o.disabled}
          className="min-h-11 rounded-[var(--radius-pill)] px-3 text-sm text-[var(--text-muted)] disabled:opacity-50 data-[state=on]:bg-[var(--accent)] data-[state=on]:text-white"
        >
          {o.label}
          {o.hint ? <span className="ml-1 text-xs">{o.hint}</span> : null}
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

/** Accordion (3.2): по умолчанию все свёрнуты, можно раскрыть несколько (PH-36). */
export function Accordion({ items, multiple = true }: { items: AccordionItem[]; multiple?: boolean }) {
  const list = items.map((item) => (
    <AccordionPrimitive.Item key={item.value} value={item.value} className="border-b border-[var(--border)]">
      <AccordionPrimitive.Header>
        <AccordionPrimitive.Trigger className="flex min-h-11 w-full items-center justify-between py-3 text-left">
          {item.title}
        </AccordionPrimitive.Trigger>
      </AccordionPrimitive.Header>
      <AccordionPrimitive.Content className="pb-4 text-[var(--text-muted)]">
        {item.content}
      </AccordionPrimitive.Content>
    </AccordionPrimitive.Item>
  ));
  return multiple ? (
    <AccordionPrimitive.Root type="multiple">{list}</AccordionPrimitive.Root>
  ) : (
    <AccordionPrimitive.Root type="single" collapsible>
      {list}
    </AccordionPrimitive.Root>
  );
}
