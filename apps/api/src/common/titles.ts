import { and, eq, inArray } from 'drizzle-orm';
import { type Locale, type TopicSnapshot } from '@syntara/shared';
import { type Database, schema } from '@syntara/db';
import { pickTranslation } from './locale';

const ORDER = (locale: Locale): Locale[] => [locale, 'ru', 'en', 'kk'];

/**
 * Названия тем для ученика и учителя — из опубликованного снимка (REQ-TCH-PUB-05), на языке интерфейса с запасным
 * RU/EN/KK; неопубликованная тема — название черновика.
 */
export async function topicTitles(db: Database, ids: string[], locale: Locale): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  const unique = [...new Set(ids)];
  if (unique.length === 0) return result;
  const { topics, topicVersions, topicTranslations } = schema;
  const [published, drafts] = await Promise.all([
    db
      .select({ id: topics.id, snapshot: topicVersions.snapshot })
      .from(topics)
      .innerJoin(topicVersions, eq(topicVersions.id, topics.publishedVersionId))
      .where(inArray(topics.id, unique)),
    db.select().from(topicTranslations).where(inArray(topicTranslations.topicId, unique)),
  ]);
  for (const id of unique) {
    const snapshot = published.find((p) => p.id === id)?.snapshot as TopicSnapshot | undefined;
    const fromSnapshot = snapshot
      ? ORDER(locale)
          .map((l) => snapshot.translations[l])
          .find(Boolean)?.title
      : undefined;
    const draft = pickTranslation(
      drafts.filter((d) => d.topicId === id),
      locale,
    )?.title;
    result.set(id, fromSnapshot ?? draft ?? '');
  }
  return result;
}

/** Названия предметов на языке интерфейса (пользовательские названия не переводятся — берётся то, что есть). */
export async function subjectTitles(
  db: Database,
  ids: string[],
  locale: Locale,
): Promise<Map<string, string>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const { subjectTranslations: st } = schema;
  const rows = await db
    .select()
    .from(st)
    .where(and(inArray(st.subjectId, unique)));
  return new Map(
    unique.map((id) => [
      id,
      pickTranslation(
        rows.filter((r) => r.subjectId === id),
        locale,
      )?.title ?? '',
    ]),
  );
}
