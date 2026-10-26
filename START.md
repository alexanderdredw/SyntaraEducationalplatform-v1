# Как начать работу с Claude Code

1. Откройте терминал в этой папке (`syntara`) и запустите `claude`.
2. Первая команда:

   Прочитай CLAUDE.md и docs/SPEC.md целиком. Выполни итерацию 1 из раздела 12 и проверь её по Definition of Done из раздела 0.5. В конце дай отчёт.

3. Следующие команды — по одной итерации:

   Выполни итерацию 2 из раздела 12 docs/SPEC.md. В конце дай отчёт.

4. Если есть скриншоты публичной части S01–S26 — положите их в docs/media/public/ до итерации 3.

## Очистка места на диске (docs/OPTIMIZATION_TZ.md, OPT-01)

- `pnpm clean` — удаляет генерируемые папки: сборки Next (`apps/web/.next`, `.next-e2e`, другие `.next-*`), кеши Turborepo (`.turbo`),
  `dist`, `*.tsbuildinfo`, `test-results`, `playwright-report`, `coverage`, отчёты Lighthouse CI (`.lighthouseci`, `lighthouse-report`). Исходники, `content/`, `docs/`, `.env` и тома Docker не затрагиваются.
  Всё восстанавливается само: `pnpm dev`, `pnpm build`, `pnpm e2e` (первый запуск после очистки дольше на 1–2 минуты).
  Кеши webpack в `.next-e2e` и кеш `.turbo` растут без ограничения (≈ 0,5 ГБ за неделю активной работы) — запускайте `pnpm clean` раз в неделю.
- `pnpm clean:deep` — то же плюс все `node_modules`, затем `pnpm install`. Места почти не освобождает (файлы — жёсткие ссылки на хранилище pnpm),
  нужен, если установка сломалась. Освободить само хранилище pnpm (общее для всех проектов): `pnpm store prune`.

## Проверки скорости и размера (docs/OPTIMIZATION_TZ.md, раздел 9; SPEC REQ-NFR-PERF-05/06, REQ-NFR-OPS-02)

Все они идут в CI; локально — так:
- `pnpm deps:check` — неиспользуемые и неуказанные зависимости (knip, исключения с пояснениями — `knip.jsonc`). Запускайте после добавления или удаления пакета.
- `node scripts/opt/check-repo-files.mjs` — в git нет сборок, кешей и файлов больше 1 МБ (кроме эталонов).
- `node scripts/opt/analyze-bundle.mjs apps/web/.next --budget 500` — после `pnpm build`: JS первой загрузки каждой страницы ≤ 500 КБ.
- Lighthouse CI: запущенные production-сборки web и api (`pnpm build`, `pnpm --filter @syntara/api start`, `pnpm --filter @syntara/web start`), затем
  `node scripts/opt/lhci.mjs` (пороги — `lighthouserc.json`; если Chrome не найден — `CHROME_PATH` на Chromium из Playwright).
- Подробные замеры всех 18 страниц: `node scripts/opt/measure-web.mjs` (сеть Slow 4G / Fast 3G) и `node scripts/opt/lighthouse.mjs` (api — с `RATE_LIMITS_DISABLED=true`).
