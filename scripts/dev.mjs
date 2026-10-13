// `pnpm dev`: поднимает инфраструктуру (docker compose) и запускает web, api, worker через turbo.
import { spawnSync, spawn } from 'node:child_process';
import { existsSync, copyFileSync } from 'node:fs';

if (!existsSync('.env')) {
  copyFileSync('.env.example', '.env');
  console.warn('[dev] .env не найден — создан из .env.example');
}

const infra = spawnSync('pnpm', ['infra:up'], { stdio: 'inherit', shell: true });
if (infra.status !== 0) {
  console.error('[dev] docker compose не поднялся — проверьте, что Docker Desktop запущен');
  process.exit(infra.status ?? 1);
}

const migrate = spawnSync('pnpm', ['db:migrate'], { stdio: 'inherit', shell: true });
if (migrate.status !== 0) process.exit(migrate.status ?? 1);

const turbo = spawn('pnpm', ['exec', 'turbo', 'run', 'dev', '--filter=./apps/*'], {
  stdio: 'inherit',
  shell: true,
});
turbo.on('exit', (code) => process.exit(code ?? 0));
