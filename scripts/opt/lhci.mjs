#!/usr/bin/env node
// OPT-06 (О5, О4-8; SPEC REQ-NFR-PERF-01/02, REQ-NFR-PERF-06): Lighthouse CI по страницам гостя и уроку базового
// предмета — цели раздела 8 ТЗ (Performance ≥ 85, LCP ≤ 2,5 с, CLS ≤ 0,1, JS ≤ 500 КБ), пороги — lighthouserc.json.
// Нужны запущенные web и api с базой (seed demo). id урока берётся из API: в content/ он не постоянный.
// Запуск из корня: node scripts/opt/lhci.mjs [baseURL=http://localhost:3000]
import { spawnSync } from 'node:child_process';

const base = process.argv[2] ?? 'http://localhost:3000';
const get = async (path) => {
  const res = await fetch(`${base}${path}`, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}`);
  return res.json();
};

// Первый урок первого раздела каталога — как в scripts/opt/measure-pages.mjs.
const catalog = await get('/api/public/catalog');
const section = await get(`/api/public/sections/${(catalog.sections ?? catalog)[0].id}`);
const subject = await get(`/api/public/subjects/${section.subjects[0].id}`);
const lesson = `/ru/learn/topics/${subject.topics[0].id}`;

const urls = ['/ru', '/ru/subjects', '/ru/about', lesson].map((p) => `${base}${p}`);
const args = ['exec', 'lhci', 'autorun', ...urls.map((u) => `--collect.url=${u}`)];
const run = spawnSync('pnpm', args, { stdio: 'inherit', shell: process.platform === 'win32' });
process.exit(run.status ?? 1);
