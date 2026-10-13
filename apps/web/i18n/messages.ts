import { type Locale, type Messages } from '@syntara/shared';
import ru from '@syntara/shared/i18n/ru.json';
import kk from '@syntara/shared/i18n/kk.json';
import en from '@syntara/shared/i18n/en.json';

/** Тексты интерфейса — только из packages/shared/i18n (AG-03). */
export const MESSAGES: Record<Locale, Messages> = { ru, kk, en };
