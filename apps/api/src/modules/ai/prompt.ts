import {
  AI_MAX_HISTORY,
  type ChatMessage,
  getMessage,
  type Locale,
  type Messages,
  redactPersonalData,
} from '@syntara/shared';
import ru from '@syntara/shared/i18n/ru.json';
import kk from '@syntara/shared/i18n/kk.json';
import en from '@syntara/shared/i18n/en.json';
import { type Prompt } from './llm-provider';
import { QUICK_KEYS } from './mock-provider';

const BUNDLES: Record<Locale, Messages> = { ru, kk, en };

/** Страницы, справка по которым входит в базу знаний публичного помощника (REQ-GEN-SHELL-04 «?»). */
const HELP_PAGES = ['home', 'subjects', 'about', 'ai', 'schools', 'schoolRequest', 'support', 'legal'];

/**
 * Промпт публичного помощника (BR-AI-02): системная инструкция, база знаний (тексты платформы из i18n и PH-19),
 * уровень объяснения beginner (PH-21), последние 20 сообщений. Email и телефоны удаляются из истории
 * и вопроса; данных профиля в публичном промпте нет. История на сервере не сохраняется (BR-AI-05).
 */
export function buildPublicPrompt(message: string, history: ChatMessage[], locale: Locale): Prompt {
  const t = (key: string) => getMessage(BUNDLES[locale], key) ?? getMessage(BUNDLES.ru, key) ?? '';
  const knowledge = [
    ...QUICK_KEYS.map((k) => `Q: ${t(`ai.quick.${k}.question`)}\nA: ${t(`ai.quick.${k}.answer`)}`),
    ...HELP_PAGES.map((page) => t(`help.pages.${page}`)).filter(Boolean),
  ].join('\n\n');

  const system = [
    'You are Syntara, the help assistant of the Syntara Education Platform.',
    `Answer in the user's language (${locale}), briefly and simply (explanation level: beginner).`,
    'Answer only questions about the platform, using the knowledge base below.',
    `If the answer is not in the knowledge base, reply exactly: "${t('ai.chat.noAnswer')}" and link to /support.`,
    'Never claim that you sent a request, created a ticket or changed any data — you cannot do that.',
    'Links are allowed only to internal pages of the platform (for example /subjects, /support).',
    '',
    'Knowledge base:',
    knowledge,
  ].join('\n');

  const messages: ChatMessage[] = [...history, { role: 'user' as const, content: message }]
    .slice(-AI_MAX_HISTORY)
    .map((m) => ({ role: m.role, content: redactPersonalData(m.content) }));

  return { system, messages, locale };
}
