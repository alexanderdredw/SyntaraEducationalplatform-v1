import {
  type CanActivate,
  type ExecutionContext,
  HttpStatus,
  Inject,
  Injectable,
  SetMetadata,
  UseGuards,
  applyDecorators,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ApiNotFoundResponse } from '@nestjs/swagger';
import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { type Database, schema } from '@syntara/db';
import { ApiException } from '../../common/api-exception';
import { DB } from '../../infra/tokens';
import { type AuthRequest } from '../auth/auth.types';

export type OwnedEntity = 'subject' | 'topic' | 'question' | 'media' | 'attempt' | 'conversation';

const OWNS_KEY = 'content:owns';

/**
 * BR-ACL-01, BR-ACL-03, API-GEN-08: учитель работает только со своими предметами и всем, что к ним относится;
 * ученик — только со своими попытками и диалогами с учебным ИИ.
 * Проверка выполняется guard'ом — до разбора тела запроса, поэтому чужой или несуществующий ID всегда даёт
 * 404 (не 400 и не 403), и существование чужого объекта не раскрывается (REQ-NFR-SEC-04).
 */
export const Owns = (entity: OwnedEntity, param = 'id') =>
  applyDecorators(
    SetMetadata(OWNS_KEY, { entity, param }),
    UseGuards(OwnershipGuard),
    ApiNotFoundResponse({ description: 'Объект не найден или принадлежит другому учителю' }),
  );

const notFound = () => new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Not found');

@Injectable()
export class OwnershipGuard implements CanActivate {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const meta = this.reflector.get<{ entity: OwnedEntity; param: string } | undefined>(
      OWNS_KEY,
      context.getHandler(),
    );
    if (!meta) return true;
    const req = context.switchToHttp().getRequest<AuthRequest>();
    const raw = req.params[meta.param];
    const id = typeof raw === 'string' ? raw : undefined;
    // Некорректный UUID — как несуществующий объект (UuidParamPipe выполняется позже guard'а).
    if (!req.user || !id || !z.uuid().safeParse(id).success) throw notFound();
    if (!(await this.owns(meta.entity, id.toLowerCase(), req.user.id))) throw notFound();
    return true;
  }

  private async owns(entity: OwnedEntity, id: string, userId: string): Promise<boolean> {
    const { subjects, topics, quizzes, questions, mediaFiles, quizAttempts, aiConversations } = schema;
    const ownSubject = and(eq(subjects.ownerId, userId), isNull(subjects.archivedAt));
    let rows: unknown[];
    switch (entity) {
      case 'subject':
        rows = await this.db
          .select({ id: subjects.id })
          .from(subjects)
          .where(and(eq(subjects.id, id), ownSubject));
        break;
      case 'topic':
        rows = await this.db
          .select({ id: topics.id })
          .from(topics)
          .innerJoin(subjects, eq(subjects.id, topics.subjectId))
          .where(and(eq(topics.id, id), isNull(topics.archivedAt), ownSubject));
        break;
      case 'question':
        rows = await this.db
          .select({ id: questions.id })
          .from(questions)
          .innerJoin(quizzes, eq(quizzes.id, questions.quizId))
          .innerJoin(topics, eq(topics.id, quizzes.topicId))
          .innerJoin(subjects, eq(subjects.id, topics.subjectId))
          .where(
            and(eq(questions.id, id), isNull(questions.archivedAt), isNull(topics.archivedAt), ownSubject),
          );
        break;
      // Попытка квиза — только своя (BR-ACL-03).
      case 'attempt':
        rows = await this.db
          .select({ id: quizAttempts.id })
          .from(quizAttempts)
          .where(and(eq(quizAttempts.id, id), eq(quizAttempts.studentId, userId)));
        break;
      // Диалог с учебным ИИ — только свой (BR-ACL-03).
      case 'conversation':
        rows = await this.db
          .select({ id: aiConversations.id })
          .from(aiConversations)
          .where(
            and(
              eq(aiConversations.id, id),
              eq(aiConversations.userId, userId),
              isNull(aiConversations.archivedAt),
            ),
          );
        break;
      case 'media':
        rows = await this.db
          .select({ id: mediaFiles.id })
          .from(mediaFiles)
          .where(and(eq(mediaFiles.id, id), eq(mediaFiles.ownerId, userId)));
        break;
    }
    return rows.length > 0;
  }
}
