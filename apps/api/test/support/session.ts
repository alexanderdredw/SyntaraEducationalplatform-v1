import { randomUUID } from 'node:crypto';
import type request from 'supertest';
import { type Response } from 'supertest';

export const DEV_PASSWORD = process.env.SEED_DEV_PASSWORD ?? 'syntara-dev-password';

export const ACCOUNTS = {
  teacher: 'teacher@syntara.local',
  support: 'support@syntara.local',
  onboarding: 'onboarding@syntara.local',
} as const;

export interface Session {
  cookie: string;
  csrf: string;
  userId: string;
}

type Http = () => request.Agent | ReturnType<typeof request>;

/** Значения cookie из Set-Cookie ответа. */
export function cookiesOf(res: Response): Record<string, { value: string; raw: string }> {
  const raw = res.headers['set-cookie'] as unknown as string[] | undefined;
  return Object.fromEntries(
    (raw ?? []).map((line) => {
      const [pair] = line.split(';');
      const [name, ...value] = pair!.split('=');
      return [name!.trim(), { value: value.join('='), raw: line }];
    }),
  );
}

/** Уникальный «клиентский IP» (X-Forwarded-For за доверенным прокси), чтобы лимиты разных тестов не пересекались. */
export const freshIp = () =>
  `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;

export async function login(http: Http, email: string, password = DEV_PASSWORD): Promise<Session> {
  const res = await (http() as ReturnType<typeof request>)
    .post('/api/auth/login')
    .set('X-Forwarded-For', freshIp())
    .send({ email, password })
    .expect(200);
  const cookies = cookiesOf(res);
  return {
    cookie: `sid=${cookies.sid!.value}; csrf=${cookies.csrf!.value}`,
    csrf: cookies.csrf!.value,
    userId: (res.body as { user: { id: string } }).user.id,
  };
}

export const newKey = () => randomUUID();
