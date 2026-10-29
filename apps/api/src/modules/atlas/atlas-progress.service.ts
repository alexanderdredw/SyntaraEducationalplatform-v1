import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { SectionStudiedDto } from '@syntara/shared';
import { ApiException } from '../../common/api-exception';
import { and, eq } from 'drizzle-orm';
import { type Database, schema } from '@syntara/db';
import { DB } from '../../infra/tokens';
import { type AtlasScientistsProgressDto } from './atlas.dto';
import { AtlasService, notFound } from './atlas.service';

const { sectionProgress, topicMastery, atlasQuizSessions: sessions } = schema;

/**
 * «Изучено» учёных экрана «Учёные» (docs/SCIENTISTS_TZ.md, REQ-SCI-03, REQ-SCI-04, BR-SCI-01): отметки ученика по
 * разделам урока «Учёные-химики» (section_progress — только свои), лучший результат теста урока (topic_mastery) и
 * игры «Кто этот учёный?» (завершённые сессии). Учёные — разделы урока с событием на ленте (timeline.yaml). XP за
 * отметку не начисляется.
 */
@Injectable()
export class AtlasProgressService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly atlas: AtlasService,
  ) {}

  /** API-S-31: изученные учёные и лучшие результаты. */
  async scientists(studentId: string, subjectId: string): Promise<AtlasScientistsProgressDto> {
    const { topicId, codes } = await this.topic(studentId, subjectId);
    const [studied, mastery, games] = await Promise.all([
      this.db
        .select({ code: sectionProgress.sectionCode })
        .from(sectionProgress)
        .where(and(eq(sectionProgress.studentId, studentId), eq(sectionProgress.topicId, topicId))),
      this.db
        .select({ best: topicMastery.bestPercent })
        .from(topicMastery)
        .where(and(eq(topicMastery.studentId, studentId), eq(topicMastery.topicId, topicId))),
      this.db
        .select({ correct: sessions.correctCount, total: sessions.total })
        .from(sessions)
        .where(
          and(
            eq(sessions.studentId, studentId),
            eq(sessions.subjectId, subjectId),
            eq(sessions.kind, 'scientists'),
            eq(sessions.status, 'finished'),
          ),
        ),
    ]);
    const percents = games.map((g) => Math.round((100 * g.correct) / Math.max(1, g.total)));
    return {
      total: codes.length,
      studied: codes.filter((c) => studied.some((s) => s.code === c)),
      testBestPercent: mastery[0] ? Math.round(Number(mastery[0].best)) : null,
      gameBestPercent: percents.length ? Math.max(...percents) : null,
    };
  }

  /** API-S-32: отметить учёного изученным или снять отметку (повтор — без изменений). Неизвестный учёный → 404. */
  async mark(
    studentId: string,
    subjectId: string,
    code: string,
    body: unknown,
  ): Promise<AtlasScientistsProgressDto> {
    const { topicId, codes } = await this.topic(studentId, subjectId);
    if (!codes.includes(code)) throw notFound();
    const parsed = SectionStudiedDto.safeParse(body);
    if (!parsed.success)
      throw new ApiException(HttpStatus.BAD_REQUEST, 'VALIDATION_FAILED', 'Validation failed', {
        studied: 'required',
      });
    const { studied } = parsed.data;
    const key = { studentId, topicId, sectionCode: code };
    if (studied) await this.db.insert(sectionProgress).values(key).onConflictDoNothing();
    else
      await this.db
        .delete(sectionProgress)
        .where(
          and(
            eq(sectionProgress.studentId, studentId),
            eq(sectionProgress.topicId, topicId),
            eq(sectionProgress.sectionCode, code),
          ),
        );
    return this.scientists(studentId, subjectId);
  }

  /** Урок «Учёные-химики» видимого ученику предмета с атласом и коды учёных (по ленте); иначе 404. */
  private async topic(studentId: string, subjectId: string): Promise<{ topicId: string; codes: string[] }> {
    await this.atlas.assertAtlas(studentId, subjectId);
    const topic = AtlasService.scientists(await this.atlas.topics(subjectId));
    if (!topic) throw notFound();
    const codes = (topic.snapshot.timeline ?? []).map((ev) => ev.section.split('#').pop() ?? '');
    return { topicId: topic.id, codes: codes.filter(Boolean) };
  }
}
