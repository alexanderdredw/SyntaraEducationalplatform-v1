import { HttpStatus, Injectable, PipeTransform } from '@nestjs/common';
import { type ZodType } from 'zod';
import { ApiException } from './api-exception';

/**
 * Валидация тела запроса схемами Zod из packages/shared (раздел 6.7).
 * `fieldErrors` содержит ключи i18n (`validation.*`), а не тексты — тексты выбирает клиент по языку.
 */
@Injectable()
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);
    if (result.success) return result.data;
    const fieldErrors: Record<string, string> = {};
    for (const issue of result.error.issues) {
      const field = issue.path.join('.') || '_';
      fieldErrors[field] ??= issue.message;
    }
    throw new ApiException(HttpStatus.BAD_REQUEST, 'VALIDATION_FAILED', 'Validation failed', fieldErrors);
  }
}
