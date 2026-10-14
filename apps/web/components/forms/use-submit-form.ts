'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocale } from 'next-intl';
import {
  type DefaultValues,
  type FieldPath,
  type FieldValues,
  type Path,
  type UseFormReturn,
  useForm,
} from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { type z } from 'zod';
import { apiRequest } from '@/lib/api/browser';
import { usePreservedState } from '../preferences/preserved-state';

/** Состояния SM-FORM (8.1.9). validating — синхронная проверка внутри handleSubmit. */
export type FormStatus = 'idle' | 'submitting' | 'success' | 'network_error' | 'server_error';

export interface FormSuccess {
  publicNumber: string;
  email: string;
}

interface Options<S extends z.ZodObject> {
  /** Ключ состояния формы в памяти вкладки (переживает смену языка, AC-GEN-02). */
  id: string;
  schema: S;
  defaults: z.input<S>;
  endpoint: string;
  /** Поля в порядке на экране: сводка ошибок и фокус — по этому порядку. */
  fieldOrder: ReadonlyArray<FieldPath<z.input<S>>>;
  /** Дополнение тела запроса при отправке (например, techContext). */
  extend?: (values: z.output<S>) => Record<string, unknown>;
}

const newKey = () => crypto.randomUUID();

/**
 * Общий автомат отправки публичных форм (SM-FORM):
 * - проверка при отправке и при уходе с уже изменённого поля; верные поля не очищаются;
 * - ошибки у полей + сводка сверху + фокус на первое ошибочное поле; запрос не отправляется;
 * - «Отправляем...», кнопка неактивна; Idempotency-Key один на содержимое формы, новый — после изменения;
 * - успех только после 201: номер и email, форма очищается;
 * - нет сети → текст сети, ввод и ключ сохранены; ошибка сервера или таймаут 15 с → текст сервера, ключ тот же;
 * - beforeunload при заполненной неотправленной форме; черновик не пишется в localStorage.
 */
export function useSubmitForm<S extends z.ZodObject>(options: Options<S>) {
  type Input = z.input<S> & FieldValues;
  type Output = z.output<S>;
  const { id, schema, defaults, endpoint, fieldOrder, extend } = options;
  const locale = useLocale();

  const [preserved, setPreserved] = usePreservedState<Input>(`form:${id}:values`, defaults as Input);
  const [idem, setIdem] = usePreservedState<{ key: string; snapshot: string } | null>(`form:${id}:key`, null);
  const [status, setStatus] = useState<FormStatus>('idle');
  const [success, setSuccess] = useState<FormSuccess | null>(null);
  const [showSummary, setShowSummary] = useState(false);
  const summaryRef = useRef<HTMLDivElement>(null);

  const form: UseFormReturn<Input, unknown, Output> = useForm<Input, unknown, Output>({
    resolver: zodResolver(schema as never) as never,
    defaultValues: preserved as DefaultValues<Input>,
    mode: 'onSubmit',
    reValidateMode: 'onBlur',
    shouldFocusError: false,
  });

  // Значения переживают смену языка (клиентская навигация пересоздаёт поддерево [locale]).
  useEffect(() => {
    const sub = form.watch((values) => setPreserved(values as Input));
    return () => sub.unsubscribe();
  }, [form, setPreserved]);

  // Уход со страницы с заполненной неотправленной формой.
  const dirty = form.formState.isDirty || JSON.stringify(preserved) !== JSON.stringify(defaults);
  useEffect(() => {
    if (!dirty || status === 'success') return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, status]);

  const focusFirstError = useCallback(() => {
    const errors = form.formState.errors;
    const first = fieldOrder.find(
      (name) => form.getFieldState(name as Path<Input>).invalid || name in errors,
    );
    if (first) form.setFocus(first as Path<Input>);
  }, [fieldOrder, form]);

  const onInvalid = useCallback(() => {
    setShowSummary(true);
    setStatus('idle');
    // Фокус — после отрисовки ошибок.
    requestAnimationFrame(focusFirstError);
  }, [focusFirstError]);

  const onValid = useCallback(
    async (values: Output) => {
      setShowSummary(false);
      const body = { ...(values as Record<string, unknown>), ...(extend?.(values) ?? {}) };
      const snapshot = JSON.stringify(form.getValues());
      const key = idem && idem.snapshot === snapshot ? idem.key : newKey();
      setIdem({ key, snapshot });
      setStatus('submitting');

      const result = await apiRequest<FormSuccess>(endpoint, {
        method: 'POST',
        body,
        locale,
        headers: { 'Idempotency-Key': key },
      });

      if (result.kind === 'ok' && result.status === 201) {
        // Сначала очистка (она вызывает подписчиков watch), затем — состояние успеха.
        form.reset(defaults as Input);
        setPreserved(defaults as Input);
        setIdem(null);
        setSuccess(result.data);
        setStatus('success');
        return;
      }
      if (result.kind === 'network') return setStatus('network_error');
      if (result.kind === 'http' && result.status === 400 && result.error?.fieldErrors) {
        const known = fieldOrder.filter((name) => result.error.fieldErrors?.[name as string]);
        if (known.length > 0) {
          for (const name of known) {
            form.setError(name as Path<Input>, {
              type: 'server',
              message: result.error.fieldErrors[name as string],
            });
          }
          setStatus('idle');
          setShowSummary(true);
          requestAnimationFrame(() => form.setFocus(known[0] as Path<Input>));
          return;
        }
      }
      setStatus('server_error');
    },
    [defaults, endpoint, extend, fieldOrder, form, idem, locale, setIdem, setPreserved],
  );

  const onSubmit = form.handleSubmit(onValid, onInvalid);

  /** Проверка при уходе с поля — только у полей, которые пользователь уже менял (или после попытки отправки). */
  const blurValidate = useCallback(
    (name: FieldPath<Input>) => {
      const state = form.getFieldState(name as Path<Input>);
      if (state.isDirty || form.formState.isSubmitted) void form.trigger(name as Path<Input>);
    },
    [form],
  );

  // Любое изменение после успеха возвращает форму в обычное состояние.
  useEffect(() => {
    const sub = form.watch(() => {
      setStatus((s) => (s === 'success' || s === 'network_error' || s === 'server_error' ? 'idle' : s));
    });
    return () => sub.unsubscribe();
  }, [form]);

  return {
    form,
    status,
    success,
    showSummary: showSummary && Object.keys(form.formState.errors).length > 0,
    summaryRef,
    onSubmit,
    blurValidate,
  };
}
