import { type TopicSnapshot } from '@syntara/shared';
import { buildTutorPrompt, lessonFromSnapshot } from './tutor-prompt';

const snapshot: TopicSnapshot = {
  translations: {
    ru: {
      title: 'Фотосинтез',
      description: 'Как растения питаются',
      funFact: 'Факт',
      bodyMd: '## Текст урока',
    },
    kk: { title: 'Фотосинтез', description: 'Өсімдіктер қалай қоректенеді' },
  },
  sections: [
    { id: 's2', position: 2, translations: { ru: { title: 'Второй', body: 'Б' } } },
    { id: 's1', position: 1, translations: { ru: { title: 'Первый', body: 'А' }, kk: { title: 'Бірінші' } } },
  ],
};

describe('tutor prompt (BR-AI-02)', () => {
  it('BR-AI-02, REQ-ST-LES-07 lesson text in the student language; without a translation — RU', () => {
    const kk = lessonFromSnapshot(snapshot, 'kk', [])!;
    expect(kk).toMatchObject({ locale: 'kk', description: 'Өсімдіктер қалай қоректенеді' });
    expect(kk.sections).toEqual([{ title: 'Бірінші', body: null }]);
    const en = lessonFromSnapshot(snapshot, 'en', ['Что нужно растению?'])!;
    expect(en.locale).toBe('ru');
    expect(en.sections.map((s) => s.title)).toEqual(['Первый', 'Второй']);
    expect(en.bodyMd).toBe('## Текст урока');
  });

  it('BR-AI-02, PH-21 system: level, answer language, lesson, quiz questions; quick action hint; general tutor without a lesson', () => {
    const lesson = lessonFromSnapshot(snapshot, 'ru', ['Что нужно растению?'])!;
    const prompt = buildTutorPrompt({
      lesson,
      history: [],
      message: 'Проверь меня: задай 3 вопроса по теме',
      quickAction: 'check_me',
      locale: 'en',
      explainLevel: 'beginner',
    });
    expect(prompt.system).toContain('Always answer in English');
    expect(prompt.system).toContain('Explanation level: beginner');
    expect(prompt.system).toContain('# Фотосинтез');
    expect(prompt.system).toContain('### Первый\nА');
    expect(prompt.system).toContain('- Что нужно растению?');
    expect(prompt.system).toContain('ask 3 short questions');
    expect(prompt.messages).toEqual([{ role: 'user', content: 'Проверь меня: задай 3 вопроса по теме' }]);

    const general = buildTutorPrompt({
      lesson: null,
      history: [],
      message: 'Привет',
      locale: 'ru',
      explainLevel: 'beginner',
    });
    expect(general.system).not.toContain('Current lesson');
    expect(general.system).toContain('any school subject');
  });
});
