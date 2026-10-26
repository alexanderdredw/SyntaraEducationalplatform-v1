/**
 * Ключи запросов TanStack Query, общие для браузера и предзагрузки на сервере (OPT-05, О4-2): данные,
 * полученные сервером под этим ключом, браузер берёт из HTML и не запрашивает повторно.
 */
export const lessonQueryKey = (topicId: string, guest: boolean, locale: string) =>
  ['student', 'lesson', topicId, guest, locale] as const;
