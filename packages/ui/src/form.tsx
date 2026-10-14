'use client';

import {
  cloneElement,
  forwardRef,
  isValidElement,
  useId,
  type InputHTMLAttributes,
  type ReactElement,
  type TextareaHTMLAttributes,
} from 'react';
import { Checkbox as CheckboxPrimitive, RadioGroup, Select as SelectPrimitive } from 'radix-ui';
import { Check, ChevronDown } from 'lucide-react';
import { cn } from './cn';

// Размер шрифта полей ≥ 16 px (REQ-GEN-SHELL-07) — text-base.
const fieldClass =
  'min-h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--field)] px-4 py-2 text-base text-[var(--text)] placeholder:text-[var(--text-muted)] aria-[invalid=true]:border-[var(--danger)]';

interface ControlA11yProps {
  id?: string;
  'aria-invalid'?: boolean;
  'aria-describedby'?: string;
  'aria-required'?: boolean;
}

/**
 * Field (3.2): label + поле + ошибка + подсказка. Связывает поле с подписью и сообщениями
 * через id / aria-describedby / aria-invalid. Тексты передаются из i18n.
 */
export function Field({
  id: explicitId,
  label,
  hint,
  error,
  required,
  children,
}: {
  /** Явный id поля — для ссылок из сводки ошибок; иначе генерируется. */
  id?: string;
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: ReactElement<ControlA11yProps>;
}) {
  const generatedId = useId();
  const id = explicitId ?? generatedId;
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [errorId, hintId].filter(Boolean).join(' ') || undefined;
  const control = isValidElement(children)
    ? cloneElement(children, {
        id,
        'aria-invalid': error ? true : undefined,
        'aria-describedby': describedBy,
        'aria-required': required || undefined,
      })
    : children;
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="text-sm text-[var(--text)]">
        {label}
        {required ? <span aria-hidden="true"> *</span> : null}
      </label>
      {control}
      {hint ? (
        <p id={hintId} className="text-xs text-[var(--text-muted)]">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="text-xs text-[var(--danger-text)]">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...props },
  ref,
) {
  return <input ref={ref} className={cn(fieldClass, className)} {...props} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, ...props }, ref) {
    return <textarea ref={ref} className={cn(fieldClass, 'min-h-32', className)} {...props} />;
  },
);

export interface SelectOption {
  value: string;
  label: string;
}

/** Select (3.2) на Radix: стрелки, Enter, Escape, поиск по первой букве. */
export function Select({
  options,
  value,
  onValueChange,
  placeholder,
  ...a11y
}: {
  options: SelectOption[];
  value?: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
} & ControlA11yProps) {
  return (
    <SelectPrimitive.Root value={value} onValueChange={onValueChange}>
      <SelectPrimitive.Trigger className={cn(fieldClass, 'flex items-center justify-between')} {...a11y}>
        <SelectPrimitive.Value placeholder={placeholder} />
        <SelectPrimitive.Icon>
          <ChevronDown aria-hidden="true" className="size-4 text-[var(--accent)]" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          position="popper"
          className="z-50 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-1 text-[var(--text)]"
        >
          <SelectPrimitive.Viewport>
            {options.map((o) => (
              <SelectPrimitive.Item
                key={o.value}
                value={o.value}
                className="flex min-h-11 cursor-pointer items-center rounded-lg px-3 outline-none data-[highlighted]:bg-[var(--field)]"
              >
                <SelectPrimitive.ItemText>{o.label}</SelectPrimitive.ItemText>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}

/** Checkbox (3.2) с подписью; Space переключает. */
export function Checkbox({
  label,
  checked,
  onCheckedChange,
  description,
}: {
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  description?: string;
}) {
  const id = useId();
  return (
    <div className="flex items-start gap-3">
      <CheckboxPrimitive.Root
        id={id}
        checked={checked}
        onCheckedChange={(v) => onCheckedChange(v === true)}
        aria-describedby={description ? `${id}-desc` : undefined}
        className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md border border-[var(--border)] bg-[var(--field)] data-[state=checked]:bg-[var(--accent)]"
      >
        <CheckboxPrimitive.Indicator>
          <Check aria-hidden="true" className="size-4 text-white" />
        </CheckboxPrimitive.Indicator>
      </CheckboxPrimitive.Root>
      <div>
        <label htmlFor={id} className="text-sm">
          {label}
        </label>
        {description ? (
          <p id={`${id}-desc`} className="text-xs text-[var(--text-muted)]">
            {description}
          </p>
        ) : null}
      </div>
    </div>
  );
}

export interface RadioOption {
  value: string;
  label: string;
}

/** Radio (3.2): группа радиокнопок; стрелки перемещают выбор (варианты квиза, пробный вопрос). */
export function Radio({
  options,
  value,
  onValueChange,
  label,
}: {
  options: RadioOption[];
  value?: string;
  onValueChange: (value: string) => void;
  label: string;
}) {
  const id = useId();
  return (
    <RadioGroup.Root
      value={value}
      onValueChange={onValueChange}
      aria-label={label}
      className="flex flex-col gap-2"
    >
      {options.map((o) => (
        <div key={o.value} className="flex items-center gap-3">
          <RadioGroup.Item
            id={`${id}-${o.value}`}
            value={o.value}
            className="flex size-6 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--field)]"
          >
            <RadioGroup.Indicator className="size-3 rounded-full bg-[var(--accent)]" />
          </RadioGroup.Item>
          <label htmlFor={`${id}-${o.value}`} className="text-sm">
            {o.label}
          </label>
        </div>
      ))}
    </RadioGroup.Root>
  );
}
