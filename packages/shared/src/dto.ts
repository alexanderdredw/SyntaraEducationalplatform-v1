import { z } from 'zod';
import { Locale, SupportCategory } from './enums';

/**
 * Схемы DTO раздела 6.7 SPEC. Сообщения ошибок — ключи i18n (`validation.*`), а не тексты.
 * Отличие от листинга SPEC: в Zod 4 `z.record(enum, …)` требует все ключи перечисления,
 * поэтому для «хотя бы один язык» используется `z.partialRecord` — смысл схемы сохранён.
 */
const email = z.string().trim().max(254, 'tooLong').pipe(z.email('email'));
const phone = z
  .string()
  .trim()
  .regex(/^\+?[0-9 ()-]{6,20}$/, 'invalidPhone')
  .optional()
  .or(z.literal(''));

const required = (max: number) => z.string().trim().min(1, 'required').max(max, 'tooLong');
const optionalText = (max: number) => z.string().trim().max(max, 'tooLong').optional();

export const SchoolRequestDto = z.object({
  schoolName: required(200),
  region: optionalText(120),
  city: optionalText(120),
  contactPerson: required(200),
  phone,
  email,
  message: optionalText(5000),
});
export type SchoolRequestDto = z.infer<typeof SchoolRequestDto>;

export const SupportTicketDto = z.object({
  category: SupportCategory,
  subject: required(200),
  name: optionalText(200),
  email,
  phone,
  description: required(10000),
  techContext: z
    .object({
      route: z.string(),
      appVersion: z.string(),
      locale: Locale,
      dataSaver: z.boolean(),
      userAgent: z.string().max(300),
    })
    .optional(),
});
export type SupportTicketDto = z.infer<typeof SupportTicketDto>;

const LangText = z.object({ text: required(1000), explanation: z.string().max(2000, 'tooLong').optional() });

export const QuestionDto = z
  .object({
    type: z.enum(['single_choice', 'true_false', 'text_input']),
    difficulty: z.enum(['easy', 'medium', 'hard']),
    translations: z
      .partialRecord(Locale, LangText)
      .refine((t) => Object.keys(t).length >= 1, 'atLeastOneLanguage'),
    options: z
      .array(
        z.object({
          translations: z.partialRecord(Locale, required(300)),
          isCorrect: z.boolean(),
        }),
      )
      .optional(),
    textAnswer: z.string().trim().max(300, 'tooLong').optional(),
  })
  .superRefine((q, ctx) => {
    if (q.type !== 'text_input') {
      const n = q.options?.length ?? 0;
      const correct = q.options?.filter((o) => o.isCorrect).length ?? 0;
      if (n < 2) ctx.addIssue({ code: 'custom', path: ['options'], message: 'min2' });
      if (correct !== 1) ctx.addIssue({ code: 'custom', path: ['options'], message: 'exactlyOneCorrect' });
    } else if (!q.textAnswer) {
      ctx.addIssue({ code: 'custom', path: ['textAnswer'], message: 'required' });
    }
  });
export type QuestionDto = z.infer<typeof QuestionDto>;
