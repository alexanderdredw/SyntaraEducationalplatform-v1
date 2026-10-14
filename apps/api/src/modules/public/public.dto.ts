import { ApiProperty } from '@nestjs/swagger';
import { LOCALES, type Locale } from '@syntara/shared';

export const PUBLIC_SUBJECT_STATUSES = ['open', 'login_required', 'soon'] as const;
export type PublicSubjectStatus = (typeof PUBLIC_SUBJECT_STATUSES)[number];

/** Элемент API-PUB-01. `locale` — фактически отданный язык (API-GEN-03). */
export class PublicSubjectDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ description: 'Код раздела каталога (PH-01)' }) code: string;
  @ApiProperty() title: string;
  @ApiProperty({ nullable: true, type: String }) description: string | null;
  @ApiProperty({ description: 'Имя иконки Lucide' }) icon: string;
  @ApiProperty({ enum: PUBLIC_SUBJECT_STATUSES }) status: PublicSubjectStatus;
  @ApiProperty({ nullable: true, type: String, description: 'Внутренний относительный путь' })
  href: string | null;
  @ApiProperty({ enum: LOCALES }) locale: Locale;
}

class AtlasUrlsDto {
  @ApiProperty({ nullable: true, type: String }) mendeleev: string | null;
  @ApiProperty({ nullable: true, type: String }) anatomy: string | null;
}

class PublicFeaturesDto {
  @ApiProperty({ description: 'PH-13 features.offline' }) offline: boolean;
  @ApiProperty({ description: 'PH-11 pricing.visible' }) pricingVisible: boolean;
  @ApiProperty({ enum: LOCALES, isArray: true, description: 'PH-04 i18n.enabled_locales' })
  enabledLocales: Locale[];
}

/** API-PUB-07: только публичные значения app_config. Тексты заглушек — в i18n, не здесь. */
export class PublicConfigDto {
  @ApiProperty({ description: 'PH-09 support.email' }) supportEmail: string;
  @ApiProperty({ type: AtlasUrlsDto, description: 'PH-10 atlas.urls' }) atlasUrls: AtlasUrlsDto;
  @ApiProperty({ type: PublicFeaturesDto }) features: PublicFeaturesDto;
}

class DemoOptionDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() text: string;
}

/** API-PUB-02: без isCorrect (BR-QZ-01). `hasAnother` — есть ли другие пробные вопросы (кнопка «Другой вопрос», PH-02). */
export class DemoQuestionDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ description: 'Версия содержимого вопроса' }) version: string;
  @ApiProperty() text: string;
  @ApiProperty({ type: DemoOptionDto, isArray: true }) options: DemoOptionDto[];
  @ApiProperty() hasAnother: boolean;
  @ApiProperty({ enum: LOCALES }) locale: Locale;
}

export class DemoAnswerBody {
  @ApiProperty({ format: 'uuid' }) questionId: string;
  @ApiProperty() version: string;
  @ApiProperty({ format: 'uuid' }) optionId: string;
}

/** API-PUB-03 */
export class DemoAnswerResponse {
  @ApiProperty() correct: boolean;
  @ApiProperty({ format: 'uuid' }) correctOptionId: string;
  @ApiProperty({ type: String, nullable: true }) explanation: string | null;
  @ApiProperty({ enum: LOCALES }) locale: Locale;
}
