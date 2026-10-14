import { type z } from 'zod';

/**
 * Тип тела/запроса по Zod-схеме из packages/shared. Нужен вместо одноимённого типа схемы в сигнатурах
 * контроллеров: иначе метаданные декораторов ссылаются на сам объект схемы, и генерация OpenAPI ломается.
 * Документация параметров — через @ApiBody/@ApiQuery.
 */
export type Dto<T extends z.ZodType> = z.output<T>;
