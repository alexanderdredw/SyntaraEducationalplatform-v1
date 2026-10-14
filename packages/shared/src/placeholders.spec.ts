import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import ru from '../i18n/ru.json';

/**
 * Тексты-заглушки раздела 11 показываются через i18n (AG-03: тексты — только в файлах локализации),
 * поэтому RU-текст в ru.json обязан дословно совпадать со значением в seed/config.json.
 */
const config = Object.fromEntries(
  (
    JSON.parse(readFileSync(join(__dirname, '../../db/seed/config.json'), 'utf8')) as {
      entries: Array<{ key: string; value: unknown }>;
    }
  ).entries.map((e) => [e.key, e.value]),
);

describe('i18n ↔ раздел 11', () => {
  it('PH-01 home.subjects_subtitle', () => {
    expect(ru.home.subjects.subtitle).toBe(config['home.subjects_subtitle']);
  });

  it('PH-03 home.benefits — five panels of «Почему Syntara» in order', () => {
    const p = ru.home.why.panels;
    expect([p.languages, p.tutor, p.devices, p.access, p.progress]).toEqual(config['home.benefits']);
  });

  it('PH-10 atlas.urls label_when_null', () => {
    expect(ru.about.origins.soon).toBe((config['atlas.urls'] as { label_when_null: string }).label_when_null);
  });

  it('PH-11 about.metric_access and PH-13 about.metric_pwa', () => {
    const m = ru.about.metrics;
    expect(`${m.accessValue} — ${m.accessLabel}`).toBe(config['about.metric_access']);
    expect(`${m.pwaValue} — ${m.pwaLabel}`).toBe(config['about.metric_pwa']);
  });

  it('PH-12 schools.trial', () => {
    expect(ru.schools.trial.details).toBe(config['schools.trial']);
  });

  it('PH-15 forms.consent_text', () => {
    expect(ru.forms.consent).toBe(config['forms.consent_text']);
  });

  it('PH-19 ai.public_quick_answers: four quick questions and answers', () => {
    const q = ru.ai.quick;
    expect(
      Object.fromEntries(
        [q.platform, q.start, q.language, q.registration].map((x) => [x.question, x.answer]),
      ),
    ).toEqual(config['ai.public_quick_answers']);
  });

  it('PH-19 ai.unavailable_public', () => {
    expect(ru.ai.chat.unavailable).toBe(config['ai.unavailable_public']);
    expect(ru.ai.chat.unavailable).toContain(ru.ai.chat.supportLink);
  });

  it('PH-14 legal.draft_banner', () => {
    expect(ru.legal.draftBanner).toBe((config['legal.draft_banner'] as { value: string }).value);
  });
});
