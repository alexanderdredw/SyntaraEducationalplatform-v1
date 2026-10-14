import { z } from 'zod';
import { Locale, UserRole } from './enums';

/**
 * Итерация 6: аккаунты, предпочтения, классы и коды (6.3–6.5, 7.7, PH-06, PH-07, PH-44).
 * Сообщения ошибок — ключи i18n `validation.*`.
 */

/** PH-06 `auth.password_min_length` (значение из seed; сервер дополнительно сверяет с app_config). */
export const PASSWORD_MIN_LENGTH = 8;

const email = z.string().trim().max(254, 'tooLong').pipe(z.email('email'));
const password = z.string().min(PASSWORD_MIN_LENGTH, 'passwordTooShort').max(200, 'tooLong');
const displayName = z.string().trim().min(1, 'required').max(100, 'tooLong');

/**
 * Логин ученика (PH-44): 3–32 символа — латиница, цифры, «.», «_», «-»; хранится в нижнем регистре.
 * TODO(OWNER): правила формата логина (PH-44 «требует уточнения»).
 */
export const LOGIN_PATTERN = /^[a-z0-9][a-z0-9._-]{2,31}$/;
const login = z.string().trim().toLowerCase().regex(LOGIN_PATTERN, 'invalidLogin');

/** API-AUTH-03: регистрация доступна только учителю (PH-17). */
export const RegisterTeacherDto = z.object({
  role: z.literal('teacher', 'required'),
  email,
  displayName,
  password,
});
export type RegisterTeacherDto = z.infer<typeof RegisterTeacherDto>;

/** PH-44: регистрация ученика только по действующему коду класса. */
export const RegisterStudentDto = z.object({
  code: z.string().max(32, 'tooLong'),
  displayName,
  login,
  password,
  email: email.optional().or(z.literal('')),
});
export type RegisterStudentDto = z.infer<typeof RegisterStudentDto>;

/** API-AUTH-04 */
export const ForgotPasswordDto = z.object({ email });
export type ForgotPasswordDto = z.infer<typeof ForgotPasswordDto>;
export const ResetPasswordDto = z.object({ token: z.string().min(16, 'invalidToken').max(200), password });
export type ResetPasswordDto = z.infer<typeof ResetPasswordDto>;

/** API-ME-02 */
export const Theme = z.enum(['light', 'dark', 'system']);
export const PreferencesPatchDto = z
  .object({ locale: Locale.optional(), theme: Theme.optional(), dataSaver: z.boolean().optional() })
  .refine((v) => Object.keys(v).length > 0, 'required');
export type PreferencesPatchDto = z.infer<typeof PreferencesPatchDto>;

/** API-ME-03 */
export const ActiveRoleDto = z.object({ role: UserRole });
export type ActiveRoleDto = z.infer<typeof ActiveRoleDto>;

/** API-ME-05 (PH-08) */
export const DataRequestDto = z.object({ type: z.enum(['export', 'delete']) });
export type DataRequestDto = z.infer<typeof DataRequestDto>;

/** API-T-05: название класса ≤ 50 (5.3). */
export const CreateClassDto = z.object({ name: z.string().trim().min(1, 'required').max(50, 'tooLong') });
export type CreateClassDto = z.infer<typeof CreateClassDto>;

/** API-PUB-08, API-S-01: код класса; формат проверяется при нормализации (BR-CLS-01). */
export const ClassCodeDto = z.object({ code: z.string().max(32, 'tooLong') });
export type ClassCodeDto = z.infer<typeof ClassCodeDto>;

/** PH-07 `class.code` */
export interface ClassCodeConfig {
  length: number;
  alphabet: string;
  ttl_days: number;
}

/** BR-CLS-01: ввод нормализуется — trim, верхний регистр, удаление пробелов. */
export function normalizeClassCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, '');
}

/** Код подходит по формату PH-07 (длина и алфавит). */
export function isWellFormedClassCode(code: string, config: ClassCodeConfig): boolean {
  return code.length === config.length && [...code].every((ch) => config.alphabet.includes(ch));
}
