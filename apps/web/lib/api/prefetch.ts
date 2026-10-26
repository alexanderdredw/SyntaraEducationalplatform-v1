import 'server-only';
import { cookies } from 'next/headers';
import { dehydrate, type DehydratedState, QueryClient, type QueryKey } from '@tanstack/react-query';
import { getMe } from './server';

const API_URL = process.env.API_INTERNAL_URL ?? 'http://localhost:3001';
const TIMEOUT_MS = 5000;

/**
 * Первые данные страницы — на сервере (OPT-05, О4-2): тот же GET, что делает браузер (`apiRequest`: cookie
 * пользователя, Accept-Language), и тот же ключ TanStack Query. Данные уходят в HTML через `HydrationBoundary`,
 * поэтому браузер не ждёт JS и второй запрос, а контент не сдвигает страницу (LCP, CLS). Права проверяет api
 * (AG-04): ответ не 2xx или недоступный api — запрос просто не попадает в состояние, и браузер загрузит
 * данные сам, как раньше.
 */
export interface Prefetch {
  key: QueryKey;
  path: string;
}

export async function prefetchState(locale: string, entries: Prefetch[]): Promise<DehydratedState> {
  const cookieHeader = (await cookies()).toString();
  const client = new QueryClient();
  await Promise.all(
    entries.map(async ({ key, path }) => {
      try {
        const res = await fetch(`${API_URL}${path}`, {
          headers: { cookie: cookieHeader, Accept: 'application/json', 'Accept-Language': locale },
          signal: AbortSignal.timeout(TIMEOUT_MS),
          cache: 'no-store',
        });
        if (!res.ok) return;
        const text = await res.text();
        client.setQueryData(key, text ? (JSON.parse(text) as unknown) : null);
      } catch (err) {
        console.error(`[web] prefetch GET ${path} failed: ${(err as Error).message}`);
      }
    }),
  );
  return dehydrate(client);
}

/**
 * Гость ли на странице обучения — по тому же правилу, что `(student)/layout.tsx` и `LearnViewerProvider`:
 * базовые страницы обучения без роли ученика открываются как у гостя (BR-VIS-04, REQ-NAV-04).
 */
export async function learnGuest(): Promise<boolean> {
  const me = await getMe((await cookies()).toString());
  return !me?.roles.includes('student');
}
