import request from 'supertest';
import { CONFIG_KEYS } from '@syntara/shared';
import { resolveLocale } from '../src/common/locale';
import { startStack, type TestStack } from './support/stack';

describe('public API (integration)', () => {
  let stack: TestStack;
  const http = () => request(stack.app.getHttpServer());

  beforeAll(async () => {
    stack = await startStack('demo');
  });

  afterAll(() => stack?.stop());

  it('API-GEN-03 resolves the request locale from Accept-Language', () => {
    expect(resolveLocale('kk-KZ,kk;q=0.9,ru;q=0.8')).toBe('kk');
    expect(resolveLocale('de-DE,en;q=0.5')).toBe('en');
    expect(resolveLocale(undefined)).toBe('ru');
    expect(resolveLocale('fr')).toBe('ru');
  });

  it('API-PUB-01 lists PH-01 subjects with title, description, icon, status and href', async () => {
    const res = await http().get('/api/public/subjects').expect(200);
    expect(res.body.map((s: { code: string }) => s.code)).toEqual(['biology', 'chemistry', 'physics']);
    const [biology] = res.body;
    expect(biology).toMatchObject({
      title: 'Биология',
      description: 'Раздел: анатомия человека — и скоро больше',
      icon: expect.any(String),
      locale: 'ru',
    });
  });

  it('API-PUB-01, REQ-PUB-SUBJ-02 guests get login_required for subjects with lessons, soon otherwise; soon go last', async () => {
    const res = await http().get('/api/public/subjects').expect(200);
    const byCode = Object.fromEntries(res.body.map((s: { code: string }) => [s.code, s]));
    expect(byCode.biology.status).toBe('login_required');
    expect(byCode.biology.href).toMatch(/^\/auth\/login\?returnTo=%2Flearn%2Fsections%2F/);
    expect(byCode.chemistry).toMatchObject({ status: 'soon', href: null });
    const statuses = res.body.map((s: { status: string }) => s.status);
    expect(statuses.lastIndexOf('login_required')).toBeLessThan(statuses.indexOf('soon'));
  });

  it('API-GEN-03 returns translations for Accept-Language and reports the locale actually served', async () => {
    const kk = await http().get('/api/public/subjects').set('Accept-Language', 'kk').expect(200);
    expect(kk.body[0]).toMatchObject({ title: 'Биология', locale: 'kk' });
    const en = await http().get('/api/public/subjects').set('Accept-Language', 'en').expect(200);
    expect(en.body.map((s: { title: string }) => s.title)).toEqual(['Biology', 'Chemistry', 'Physics']);
  });

  it('API-PUB-07 returns only public values (positive case)', async () => {
    const res = await http().get('/api/public/config').expect(200);
    expect(res.body).toEqual({
      supportEmail: 'support@syntara-edu.me',
      atlasUrls: { mendeleev: null, anatomy: null },
      features: { offline: false, pricingVisible: false, enabledLocales: ['ru', 'kk', 'en'] },
    });
  });

  it('API-PUB-07 never exposes non-public configuration (negative case)', async () => {
    const res = await http().get('/api/public/config').expect(200);
    const body = JSON.stringify(res.body);
    for (const leak of ['retention_days', 'prodBlocked', 'needs_confirmation', 'Какой сосуд', 'mock']) {
      expect(body).not.toContain(leak);
    }
    expect(Object.keys(CONFIG_KEYS)).toContain('ai.mode');
  });

  it('API-PUB-01 public endpoints are read-only (POST is not routed)', async () => {
    const res = await http().post('/api/public/subjects').send({}).expect(404);
    expect(res.body.code).toBe('NOT_FOUND');
  });

  it('API-GEN-01 OpenAPI documents API-PUB-01 and API-PUB-07', async () => {
    const { buildOpenApi } = await import('../src/setup');
    const doc = buildOpenApi(stack.app);
    expect(doc.paths['/api/public/subjects']?.get).toBeDefined();
    expect(doc.paths['/api/public/config']?.get).toBeDefined();
  });
});
