import { pgEnum } from 'drizzle-orm/pg-core';
import {
  AiContext,
  AiMsgStatus,
  AiRole,
  AttemptStatus,
  Difficulty,
  Locale,
  MediaKind,
  MembershipStatus,
  QuestionType,
  RequestStatus,
  ScanStatus,
  SubmissionStatus,
  SupportCategory,
  TicketStatus,
  TopicStatus,
  UserRole,
} from '@syntara/shared';

/** Zod 4 отдаёт options как массив; pgEnum требует непустой кортеж. */
const values = <T extends string>(e: { options: readonly T[] }) => e.options as unknown as [T, ...T[]];

/** Перечисления 5.2 — значения берутся из packages/shared, чтобы БД и DTO не расходились. */
export const localeEnum = pgEnum('locale', values(Locale));
export const userRoleEnum = pgEnum('user_role', values(UserRole));
export const topicStatusEnum = pgEnum('topic_status', values(TopicStatus));
export const questionTypeEnum = pgEnum('question_type', values(QuestionType));
export const difficultyEnum = pgEnum('difficulty', values(Difficulty));
export const membershipStatusEnum = pgEnum('membership_status', values(MembershipStatus));
export const submissionStatusEnum = pgEnum('submission_status', values(SubmissionStatus));
export const attemptStatusEnum = pgEnum('attempt_status', values(AttemptStatus));
export const ticketStatusEnum = pgEnum('ticket_status', values(TicketStatus));
export const supportCategoryEnum = pgEnum('support_category', values(SupportCategory));
export const requestStatusEnum = pgEnum('request_status', values(RequestStatus));
export const mediaKindEnum = pgEnum('media_kind', values(MediaKind));
export const scanStatusEnum = pgEnum('scan_status', values(ScanStatus));
export const aiContextEnum = pgEnum('ai_context', values(AiContext));
export const aiRoleEnum = pgEnum('ai_role', values(AiRole));
export const aiMsgStatusEnum = pgEnum('ai_msg_status', values(AiMsgStatus));
