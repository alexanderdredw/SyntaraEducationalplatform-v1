import { z } from 'zod';
import { Locale, RequestStatus, SupportCategory, TicketStatus } from './enums';

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
      // REQ-TCH-QZ-02: 2–8 вариантов; «Верно/Неверно» — ровно два фиксированных (BR-QZ-02, PH-28).
      if (q.type === 'single_choice' && n > 8)
        ctx.addIssue({ code: 'custom', path: ['options'], message: 'max8' });
      if (q.type === 'true_false' && n > 2)
        ctx.addIssue({ code: 'custom', path: ['options'], message: 'trueFalseTwo' });
      // Текст варианта «Выбор варианта» — хотя бы на одном языке (тексты «Верно/Неверно» задаёт сервер).
      if (q.type === 'single_choice')
        q.options?.forEach((o, i) => {
          if (Object.keys(o.translations).length === 0)
            ctx.addIssue({ code: 'custom', path: ['options', i, 'translations'], message: 'required' });
        });
      if (correct !== 1) ctx.addIssue({ code: 'custom', path: ['options'], message: 'exactlyOneCorrect' });
    } else if (!q.textAnswer) {
      ctx.addIssue({ code: 'custom', path: ['textAnswer'], message: 'required' });
    }
  });
export type QuestionDto = z.infer<typeof QuestionDto>;

/** API-AUTH-01. Поле email принимает и логин (PH-44). Пароль не триммится и не проверяется по длине при входе (правила PH-06 — при регистрации). */
/** BR-AUTH-01: форма входа роли — «Я ученик» / «Я учитель». */
export const LOGIN_ENTRIES = ['student', 'teacher'] as const;
export type LoginEntry = (typeof LOGIN_ENTRIES)[number];

export const LoginDto = z.object({
  /** Email или логин ученика (PH-44: вход по логину для аккаунтов без email). */
  email: z.string().trim().min(1, 'required').max(254, 'tooLong'),
  password: z.string().min(1, 'required').max(200, 'tooLong'),
  /**
   * BR-AUTH-01: роль формы входа; аккаунт без этой роли не входит (403 wrongRoleForLogin). Без роли — служебный
   * вход сотрудников (как раньше).
   */
  role: z.enum(LOGIN_ENTRIES).optional(),
});
export type LoginDto = z.infer<typeof LoginDto>;

/** API-SUP-03 */
export const AssignDto = z.object({ assigneeId: z.uuid('required') });
export type AssignDto = z.infer<typeof AssignDto>;

/** API-SUP-04: текст ответа (из шаблона response_templates или ручной) и код шаблона. */
export const TicketReplyDto = z.object({
  body: required(10000),
  templateCode: z.string().trim().max(50, 'tooLong').optional(),
});
export type TicketReplyDto = z.infer<typeof TicketReplyDto>;

/** API-SUP-05 */
export const TicketNoteDto = z.object({ body: required(10000) });
export type TicketNoteDto = z.infer<typeof TicketNoteDto>;

/** API-SUP-06 */
export const TicketStatusChangeDto = z.object({ to: TicketStatus });
export type TicketStatusChangeDto = z.infer<typeof TicketStatusChangeDto>;

/** API-SUP-07 (смена статуса заявки по SM-REQUEST) */
export const RequestStatusChangeDto = z.object({ to: RequestStatus });
export type RequestStatusChangeDto = z.infer<typeof RequestStatusChangeDto>;

/**
 * API-SUP-08: нейтральный формат входящего письма (Q-10). Адаптер конкретного почтового провайдера
 * переводит его вебхук в этот формат.
 */
export const InboundEmailDto = z.object({
  token: z.string().trim().min(16, 'required').max(200, 'tooLong'),
  from: email,
  text: required(10000),
});
export type InboundEmailDto = z.infer<typeof InboundEmailDto>;

/** API-GEN-07: курсорная пагинация, limit ≤ 100. */
const listLimit = z.coerce.number().int().min(1).max(100).default(20);
const cursor = z.string().max(200).optional();
const search = z.string().trim().max(254).optional();

/** API-SUP-01: фильтры очереди обращений. assigneeId = 'none' — без ответственного. */
export const TicketListQuery = z.object({
  status: TicketStatus.optional(),
  assigneeId: z.union([z.uuid(), z.literal('none')]).optional(),
  category: SupportCategory.optional(),
  dueBefore: z.iso.datetime({ offset: true }).optional(),
  q: search,
  cursor,
  limit: listLimit,
});
export type TicketListQuery = z.infer<typeof TicketListQuery>;

/** API-SUP-07: фильтры очереди школьных заявок. */
export const RequestListQuery = z.object({
  status: RequestStatus.optional(),
  assigneeId: z.union([z.uuid(), z.literal('none')]).optional(),
  q: search,
  cursor,
  limit: listLimit,
});
export type RequestListQuery = z.infer<typeof RequestListQuery>;
