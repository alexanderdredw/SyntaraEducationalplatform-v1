import 'server-only';
import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { apiStatus, getMe } from './api/server';

/**
 * Страница кабинета для объекта по ID: чужой, невидимый или несуществующий объект → 404 (BR-ACL-01, BR-VIS-01,
 * API-GEN-08).
 * Права проверяет api; при его недоступности страница отрисуется и покажет ошибку загрузки.
 */
export async function requireOwned(apiPath: string): Promise<void> {
  const status = await apiStatus(apiPath, (await cookies()).toString());
  if (status === 404 || status === 400) notFound();
}

/**
 * Страница обучения: ученику — проверка через API-S-*, гостю — через публичные API-PUB-10..13 (BR-VIS-04).
 * Возвращает true, если смотрит гость.
 */
export async function requireLearnVisible(studentPath: string, publicPath: string): Promise<boolean> {
  const cookieHeader = (await cookies()).toString();
  const guest = !(await getMe(cookieHeader));
  await requireOwned(guest ? publicPath : studentPath);
  return guest;
}
