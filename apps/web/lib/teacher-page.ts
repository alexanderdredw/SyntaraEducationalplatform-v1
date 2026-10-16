import 'server-only';
import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { apiStatus } from './api/server';

/**
 * Страница кабинета для объекта по ID: чужой или несуществующий объект → 404 (BR-ACL-01, API-GEN-08).
 * Права проверяет api; при его недоступности страница отрисуется и покажет ошибку загрузки.
 */
export async function requireOwned(apiPath: string): Promise<void> {
  const status = await apiStatus(apiPath, (await cookies()).toString());
  if (status === 404 || status === 400) notFound();
}
