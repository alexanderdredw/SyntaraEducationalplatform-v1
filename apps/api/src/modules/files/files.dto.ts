import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** API-T-16 */
export class UploadUrlBody {
  @ApiProperty({ enum: ['cover', 'material'] }) kind: 'cover' | 'material';
  @ApiPropertyOptional({ format: 'uuid', description: 'Обязательно для материала (лимиты на тему)' })
  topicId?: string;
  @ApiProperty({ maxLength: 255 }) fileName: string;
  @ApiProperty() mime: string;
  @ApiProperty({ description: 'Размер в байтах' }) size: number;
}

export class UploadUrlResponse {
  @ApiProperty({ format: 'uuid' }) mediaId: string;
  @ApiProperty({ description: 'Подписанная ссылка на PUT' }) uploadUrl: string;
  @ApiProperty({ type: 'object', additionalProperties: { type: 'string' } }) headers: Record<string, string>;
}

/** API-T-17: статус проверки (SM-FILE). */
export class MediaStatusDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ enum: ['pending', 'clean', 'rejected'] }) scanStatus: 'pending' | 'clean' | 'rejected';
  @ApiProperty({ type: String, nullable: true }) url: string | null;
}

/** API-T-18 */
export class GalleryItemDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() name: string;
  @ApiProperty({ enum: ['pending', 'clean', 'rejected'] }) scanStatus: 'pending' | 'clean' | 'rejected';
  @ApiProperty({ type: String, nullable: true, description: 'Миниатюра — только после проверки' })
  url: string | null;
}
