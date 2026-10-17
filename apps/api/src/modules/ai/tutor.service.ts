import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { type Response } from 'express';
import {
  AI_MAX_HISTORY,
  type AiMsgStatus,
  type AssistantEvent,
  type ChatMessage,
  type Locale,
  serializeSse,
  StreamingSanitizer,
  type StudentConversationDto,
  type StudentMessageDto,
  type TopicSnapshot,
} from '@syntara/shared';
import { type Database, schema } from '@syntara/db';
import { ApiException } from '../../common/api-exception';
import { pickTranslation } from '../../common/locale';
import { AppConfigService } from '../../config/app-config.service';
import { DB } from '../../infra/tokens';
import { LessonService } from '../content/lesson.service';
import { VisibilityService } from '../content/visibility.service';
import { type LLMProvider, type Usage } from './llm-provider';
import { buildTutorPrompt, lessonFromSnapshot, type TutorLesson } from './tutor-prompt';
import { type ConversationDto } from './tutor.dto';

export const TUTOR_PROVIDER = Symbol('TUTOR_PROVIDER');

const { aiConversations: conversations, aiMessages: messages, learningEvents, topics } = schema;
const { quizzes, questions, questionTranslations: qt } = schema;

const notFound = () => new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Not found');

type Conversation = typeof conversations.$inferSelect;

/**
 * Учебный ИИ (8.4.5, API-S-11..13): диалоги ученика сохраняются (REQ-ST-AI-04), только свои (BR-ACL-03, чужой → 404);
 * диалог по теме — только по видимой теме (BR-VIS-01). Ответ — потоком SSE через LLMProvider (BR-AI-01) с санитизацией
 * ссылок и HTML (REQ-NFR-SEC-06); отмена клиентом → ответ сохраняется со status = partial (BR-AI-04, SM-AI-MESSAGE).
 * Пока поставщик — mock или недоступен — PH-19 «Учебный ИИ скоро будет доступен» (BR-AI-06): ответ failed.
 * Содержимое переписки в журнал не пишется (REQ-NFR-SEC-07).
 */
@Injectable()
export class TutorService {
  private readonly logger = new Logger(TutorService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(TUTOR_PROVIDER) private readonly provider: LLMProvider,
    private readonly visibility: VisibilityService,
    private readonly lessons: LessonService,
    private readonly config: AppConfigService,
  ) {}

  /**
   * API-S-11: диалог ученика по теме или общий. У ученика один действующий диалог на тему и один общий — повторный
   * вызов возвращает его, поэтому история видна после перезагрузки (AC-ST-06).
   */
  async open(studentId: string, dto: StudentConversationDto): Promise<{ id: string }> {
    const topicId = dto.context === 'topic_tutor' ? dto.topicId : null;
    if (topicId && !(await this.visibility.canStudentSeeTopic(studentId, topicId))) throw notFound();
    const explainLevel = await this.config.get<string>('ai.explain_level');
    return this.db.transaction(async (tx) => {
      // Два одновременных открытия не создадут двух диалогов.
      const key = `ai_conversation:${studentId}:${dto.context}:${topicId ?? ''}`;
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${key}))`);
      const [existing] = await tx
        .select({ id: conversations.id })
        .from(conversations)
        .where(
          and(
            eq(conversations.userId, studentId),
            eq(conversations.context, dto.context),
            topicId ? eq(conversations.topicId, topicId) : isNull(conversations.topicId),
            isNull(conversations.archivedAt),
          ),
        )
        .orderBy(desc(conversations.createdAt))
        .limit(1);
      if (existing) return existing;
      const [created] = await tx
        .insert(conversations)
        .values({ userId: studentId, context: dto.context, topicId, explainLevel })
        .returning({ id: conversations.id });
      return created!;
    });
  }

  /** API-S-13: история диалога (владение проверено guard'ом — BR-ACL-03). */
  async history(id: string, locale: Locale): Promise<ConversationDto> {
    const conversation = await this.conversation(id);
    const rows = await this.db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, id))
      .orderBy(asc(messages.createdAt), asc(messages.id));
    let topic: ConversationDto['topic'] = null;
    if (conversation.topicId) {
      const snapshot = await this.lessons.publishedSnapshot(conversation.topicId);
      const tr = snapshot ? (snapshot.translations[locale] ?? snapshot.translations.ru) : undefined;
      topic = { id: conversation.topicId, title: tr?.title ?? '' };
    }
    return {
      id,
      context: conversation.context,
      topic,
      messages: rows.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        status: m.status,
        quickAction: (m.quickAction as StudentMessageDto['quickAction']) ?? null,
        createdAt: m.createdAt.toISOString(),
      })),
    };
  }

  /**
   * API-S-12: вопрос ученика → ответ потоком SSE (`delta` … `done` / `error`), как API-PUB-06.
   * Вопрос сохраняется сразу вместе с событием `ai_question`; ответ — по завершении потока:
   * complete (done), partial (клиент закрыл соединение — «Ответ прерван»), failed (поставщик недоступен).
   */
  async ask(
    studentId: string,
    id: string,
    dto: StudentMessageDto,
    locale: Locale,
    res: Response,
    signal: AbortSignal,
  ): Promise<void> {
    const conversation = await this.conversation(id);
    // Тема могла стать невидимой (снята с публикации, ученик вышел из класса) — новые вопросы по ней не принимаются.
    const lesson = conversation.topicId ? await this.lesson(studentId, conversation.topicId, locale) : null;
    const history = await this.recentHistory(id);
    const prompt = buildTutorPrompt({
      lesson,
      history,
      message: dto.content,
      quickAction: dto.quickAction,
      locale,
      explainLevel: conversation.explainLevel,
    });

    await this.db.transaction(async (tx) => {
      const [question] = await tx
        .insert(messages)
        .values({
          conversationId: id,
          role: 'user',
          content: dto.content,
          quickAction: dto.quickAction ?? null,
        })
        .returning({ id: messages.id });
      let subjectId: string | null = null;
      if (conversation.topicId) {
        const [topic] = await tx
          .select({ subjectId: topics.subjectId })
          .from(topics)
          .where(eq(topics.id, conversation.topicId));
        subjectId = topic?.subjectId ?? null;
      }
      // Событие ai_question (5.6): XP не начисляет (BR-XP-01) и не входит в серию (BR-ST-02).
      await tx.insert(learningEvents).values({
        studentId,
        type: 'ai_question',
        subjectId,
        topicId: conversation.topicId,
        occurredAt: new Date(),
        idempotencyKey: `ai:${question!.id}`,
      });
    });

    const send = (e: AssistantEvent) => {
      if (!res.writableEnded && !signal.aborted) res.write(serializeSse(e));
    };
    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    let content = '';
    let usage: Usage = { tokensIn: null, tokensOut: null };
    let status: AiMsgStatus = 'complete';
    try {
      // BR-AI-06: пока поставщик — mock, учебного ИИ нет (PH-19).
      if (this.provider.name === 'mock') throw new Error('provider is mock');
      const atlas = await this.config.get<Record<string, string | null>>('atlas.urls');
      const sanitizer = new StreamingSanitizer(
        Object.values(atlas).filter((v): v is string => typeof v === 'string' && v.startsWith('http')),
      );
      for await (const chunk of this.provider.stream(prompt, signal, (u) => (usage = u))) {
        const safe = sanitizer.push(chunk);
        content += safe;
        if (safe) send({ event: 'delta', data: { text: safe } });
      }
      const rest = sanitizer.flush();
      content += rest;
      if (rest) send({ event: 'delta', data: { text: rest } });
      if (signal.aborted) status = 'partial';
      else send({ event: 'done', data: {} });
    } catch (err) {
      if (signal.aborted) {
        status = 'partial';
      } else {
        status = 'failed';
        if (this.provider.name !== 'mock') {
          this.logger.warn({ provider: this.provider.name, err: (err as Error).message }, 'tutor failed');
        }
        send({ event: 'error', data: { code: 'AI_UNAVAILABLE' } });
      }
    } finally {
      // Ответ сохраняется в любом исходе (SM-AI-MESSAGE): клиент мог уже закрыть соединение.
      await this.db.insert(messages).values({
        conversationId: id,
        role: 'assistant',
        content,
        status,
        tokensIn: usage.tokensIn,
        tokensOut: usage.tokensOut,
      });
      if (!res.writableEnded) res.end();
    }
  }

  private async conversation(id: string): Promise<Conversation> {
    const [row] = await this.db.select().from(conversations).where(eq(conversations.id, id));
    if (!row) throw notFound();
    return row;
  }

  /** Текст темы из опубликованного снимка (BR-AI-02) + тексты вопросов квиза без ответов (BR-AI-08, предложение). */
  private async lesson(studentId: string, topicId: string, locale: Locale): Promise<TutorLesson> {
    if (!(await this.visibility.canStudentSeeTopic(studentId, topicId))) throw notFound();
    const snapshot: TopicSnapshot | null = await this.lessons.publishedSnapshot(topicId);
    if (!snapshot) throw notFound();
    const base = lessonFromSnapshot(snapshot, locale, []);
    if (!base) throw notFound();
    return { ...base, quizQuestions: await this.quizQuestions(topicId, base.locale) };
  }

  private async quizQuestions(topicId: string, locale: Locale): Promise<string[]> {
    const rows = await this.db
      .select({ id: questions.id })
      .from(questions)
      .innerJoin(quizzes, eq(quizzes.id, questions.quizId))
      .where(and(eq(quizzes.topicId, topicId), isNull(questions.archivedAt)))
      .orderBy(asc(questions.position));
    if (rows.length === 0) return [];
    const texts = await this.db
      .select()
      .from(qt)
      .where(
        inArray(
          qt.questionId,
          rows.map((r) => r.id),
        ),
      );
    return rows.flatMap((r) => {
      const tr = pickTranslation(
        texts.filter((t) => t.questionId === r.id),
        locale,
      );
      return tr ? [tr.text] : [];
    });
  }

  /** Последние сообщения диалога для промпта (BR-AI-02): без пустых и неудавшихся ответов. */
  private async recentHistory(id: string): Promise<ChatMessage[]> {
    const rows = await this.db
      .select({ role: messages.role, content: messages.content, status: messages.status })
      .from(messages)
      .where(eq(messages.conversationId, id))
      .orderBy(desc(messages.createdAt), desc(messages.id))
      .limit(AI_MAX_HISTORY);
    return rows
      .reverse()
      .filter((m) => m.status !== 'failed' && m.content.trim() !== '')
      .map((m) => ({ role: m.role, content: m.content }));
  }
}
