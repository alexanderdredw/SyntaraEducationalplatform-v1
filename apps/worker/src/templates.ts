import {
  type ConfirmationEmailPayload,
  EMAIL_TEMPLATES,
  getMessage,
  type Locale,
  type Messages,
  type TicketReplyEmailPayload,
} from '@syntara/shared';
import ru from '@syntara/shared/i18n/ru.json';
import kk from '@syntara/shared/i18n/kk.json';
import en from '@syntara/shared/i18n/en.json';

const bundles: Record<Locale, Messages> = { ru, kk, en };

export interface RenderedEmail {
  subject: string;
  text: string;
}

function t(locale: Locale, key: string, values: Record<string, string> = {}): string {
  const template = getMessage(bundles[locale], key) ?? getMessage(bundles.ru, key) ?? key;
  return template.replace(/\{(\w+)\}/g, (_, name: string) => values[name] ?? '');
}

/**
 * Тексты писем — из i18n (AG-03), язык — язык формы или обращения.
 * Подтверждение содержит номер, тип и способ ответа, без текста обращения (BR-FRM-03).
 */
export function renderEmail(template: string, payload: unknown): RenderedEmail {
  switch (template) {
    case EMAIL_TEMPLATES.schoolRequestConfirmation: {
      const p = payload as ConfirmationEmailPayload;
      const values = { number: p.publicNumber, email: p.replyEmail };
      return {
        subject: t(p.locale, 'email.schoolRequest.subject', values),
        text: [
          t(p.locale, 'email.greeting'),
          t(p.locale, 'email.schoolRequest.body', values),
          t(p.locale, 'email.replyChannel', values),
          t(p.locale, 'email.signature'),
        ].join('\n\n'),
      };
    }
    case EMAIL_TEMPLATES.supportTicketConfirmation: {
      const p = payload as ConfirmationEmailPayload;
      const values = {
        number: p.publicNumber,
        email: p.replyEmail,
        category: p.category ? t(p.locale, `support.categories.${p.category}`) : '',
      };
      return {
        subject: t(p.locale, 'email.supportTicket.subject', values),
        text: [
          t(p.locale, 'email.greeting'),
          t(p.locale, 'email.supportTicket.body', values),
          t(p.locale, 'email.replyChannel', values),
          t(p.locale, 'email.signature'),
        ].join('\n\n'),
      };
    }
    case EMAIL_TEMPLATES.ticketReply: {
      const p = payload as TicketReplyEmailPayload;
      return {
        subject: t(p.locale, 'email.ticketReply.subject', { number: p.publicNumber }),
        text: [p.body, t(p.locale, 'email.ticketReply.footer'), t(p.locale, 'email.signature')].join('\n\n'),
      };
    }
    default:
      throw new Error(`Unknown email template "${template}"`);
  }
}
