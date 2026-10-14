import { HttpStatus, Injectable, type PipeTransform } from '@nestjs/common';
import { z } from 'zod';
import { ApiException } from './api-exception';

/** ID в пути: некорректный UUID — как несуществующий объект, 404 (API-GEN-08). */
@Injectable()
export class UuidParamPipe implements PipeTransform<string, string> {
  transform(value: string): string {
    if (!z.uuid().safeParse(value).success)
      throw new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Not found');
    return value.toLowerCase();
  }
}
