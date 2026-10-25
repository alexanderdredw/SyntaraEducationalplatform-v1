import { z } from 'zod';

/** Перечисления раздела 5.2 SPEC. Порядок значений совпадает с CREATE TYPE. */
export const Locale = z.enum(['ru', 'kk', 'en']);
export type Locale = z.infer<typeof Locale>;

export const UserRole = z.enum(['student', 'teacher', 'support_agent', 'onboarding_agent']);
export type UserRole = z.infer<typeof UserRole>;

export const TopicStatus = z.enum(['draft', 'published']);
export const QuestionType = z.enum(['single_choice', 'true_false', 'text_input']);
export const Difficulty = z.enum(['easy', 'medium', 'hard']);
export const MembershipStatus = z.enum(['active', 'left']);
export const SubmissionStatus = z.enum(['submitted', 'in_review', 'graded']);
export const AttemptStatus = z.enum(['in_progress', 'finished', 'abandoned']);
export const TicketStatus = z.enum([
  'new',
  'in_progress',
  'waiting_user',
  'waiting_internal',
  'resolved',
  'closed',
  'reopened',
]);
export const SupportCategory = z.enum([
  'technical',
  'school_onboarding',
  'learning',
  'account_access',
  'data_privacy',
  'other',
]);
export const RequestStatus = z.enum(['new', 'in_progress', 'contacted', 'onboarded', 'rejected']);
export const MediaKind = z.enum(['cover', 'material', 'illustration', 'brand', 'avatar']);
export const ScanStatus = z.enum(['pending', 'clean', 'rejected']);
export const AiContext = z.enum(['topic_tutor', 'general_tutor']);
export const AiRole = z.enum(['user', 'assistant']);
export const AiMsgStatus = z.enum(['complete', 'partial', 'failed']);
/** 5.9 Battle (итерация 10.5). */
export const BattleSessionStatus = z.enum(['lobby', 'in_progress', 'finished', 'cancelled']);
export const BattlePhase = z.enum(['lobby', 'question', 'reveal', 'leaderboard', 'finished']);

export type TopicStatus = z.infer<typeof TopicStatus>;
export type QuestionType = z.infer<typeof QuestionType>;
export type Difficulty = z.infer<typeof Difficulty>;
export type MembershipStatus = z.infer<typeof MembershipStatus>;
export type SubmissionStatus = z.infer<typeof SubmissionStatus>;
export type AttemptStatus = z.infer<typeof AttemptStatus>;
export type TicketStatus = z.infer<typeof TicketStatus>;
export type SupportCategory = z.infer<typeof SupportCategory>;
export type RequestStatus = z.infer<typeof RequestStatus>;
export type MediaKind = z.infer<typeof MediaKind>;
export type ScanStatus = z.infer<typeof ScanStatus>;
export type AiContext = z.infer<typeof AiContext>;
export type AiRole = z.infer<typeof AiRole>;
export type AiMsgStatus = z.infer<typeof AiMsgStatus>;
export type BattleSessionStatus = z.infer<typeof BattleSessionStatus>;
export type BattlePhase = z.infer<typeof BattlePhase>;
