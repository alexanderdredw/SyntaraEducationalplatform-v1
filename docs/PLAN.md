# Syntara Education Platform — технический план реализации

> Основание: `docs/SPEC.md` (разделы 0–15), `CLAUDE.md`. План детализирует раздел 12 SPEC и не добавляет функций сверх него.
> При расхождении плана и SPEC прав SPEC. Итерации выполняются строго по одной, следующая — только по команде владельца.
> Статус: **согласован владельцем** (2026-10-13). Решения по вопросам — в разделе Q; изменения SPEC — в разделе 16 SPEC.
>
> **Ход работ:** итерации 1–3 — выполнены (2026-10-13), итерации 4–6 — выполнены (2026-10-14); основа дизайна — выполнена (2026-10-15); итерации 7–8 — выполнены (2026-10-16); итоги — в конце разделов итераций. Итерация 8 принята; этап 8.6 «Базовая программа платформы» — принят (2026-10-17), доработки — выполнены. Итерация 9 «Учебный ИИ» — принята (2026-10-17). Итерация 10 «Задания, показатели, аналитика» — принята с доработками (2026-10-17), доработки выполнены. Дальше (решение владельца 2026-10-17): итерация 8.5 «Улучшение UI/UX» → итерация 11.

---

## 0. Сквозные правила выполнения

### 0.1 Что проверяется в конце каждой итерации (DoD 0.5)
1. `pnpm lint && pnpm typecheck && pnpm test` — зелёные; с итерации 3 — также `pnpm e2e` для затронутых сценариев.
2. Для каждого затронутого REQ — минимум один автотест; ID требования в названии теста: `it('REQ-ST-QZ-02 shows result right after answer', …)`.
3. Все видимые строки — в `packages/shared/i18n/ru.json`; те же ключи — в `kk.json` и `en.json` (тест сравнения ключей, REQ-NFR-I18N-01).
4. Новые эндпоинты — в OpenAPI (декораторы `@nestjs/swagger`) и покрыты тестом прав: положительный и отрицательный случай (404/401/403).
5. Клавиатурная доступность и axe-core (serious/critical = 0) для новых страниц.
6. Миграции применяются и откатываются на чистой базе (Testcontainers).
7. Отчёт по итерации: что сделано, какие REQ/BR/AC покрыты, результаты тестов, новые `TODO(OWNER)`.

### 0.2 Соглашения
- Коммиты: Conventional Commits с ID требований — `feat(quiz): REQ-ST-QZ-03 one correct option`.
- Тесты: unit — рядом с кодом (`*.spec.ts`), integration API — `apps/api/test/**` (Vitest + Testcontainers: Postgres 16, Redis 7, MinIO), e2e — `e2e/**` (Playwright + @axe-core/playwright).
- Ошибки API — единый фильтр NestJS в формате API-GEN-04; нарушение владения → 404 (API-GEN-08).
- Права — только серверные guards (`RolesGuard`, `OwnershipGuard`/сервисные проверки) + RLS как второй уровень. Middleware Next.js лишь перенаправляет.
- Значения заглушек — только через `config.get('<key>')` (таблица `app_config`), флаги — `feature_flags`. Неясное без PH — `TODO(OWNER): …` + флаг выключен.
- Демо-данные со скриншотов (раздел 15) — только в seed `visual`; в коде констант нет (AG-08).
- Тексты i18n: ключи по схеме `<area>.<screen>.<element>` (например `pub.home.hero.h1_line1`).

### 0.3 Соответствие эталонных изображений (из вставок SPEC)
| Файл | Эталон | Файл | Эталон |
|---|---|---|---|
| image1.jpg | T04 | image10.jpeg | U13 |
| image2.jpg | T05 | image11.jpg | U04 |
| image3.jpg | T06 | image12.jpg | U05 |
| image4.jpg | T07 | image13.jpg | U06 |
| image5.jpg | T08 | image14.jpg | U07 |
| image6.jpg | T09 | image15.jpg | U08 |
| image7.jpg | T10 | image16.jpg | U10 |
| image8.jpg | U01 | image17.jpg | U09 |
| image9.jpg | U02 | image18.jpg | U12 |

Отсутствуют: U03, U11, весь набор S01–S26 (`docs/media/public/` пуст) — см. Q-02.

---

## Итерация 1 — Каркас

**Цель:** `pnpm dev` поднимает web :3000, api :3001, worker и инфраструктуру; CI зелёный.

### Задачи
1. `git init`, базовая ветка `main`, `.gitignore` (уже есть), `.editorconfig`, `.nvmrc` (Node 22 LTS+), `packageManager: pnpm@<версия>` через corepack (решение Q-03).
2. Монорепозиторий: `pnpm-workspace.yaml`, `turbo.json` (pipelines `dev, build, lint, typecheck, test, e2e`), общий `tsconfig.base.json` (strict, `noUncheckedIndexedAccess`), ESLint flat-config + Prettier, `lint-staged`/husky.
3. **packages/shared**: Zod-схемы DTO раздела 6.7 (`Locale`, `SchoolRequestDto`, `SupportCategory`, `SupportTicketDto`, `QuestionDto`), enum’ы раздела 5.2, ключи конфигурации (типизированный список ключей раздела 11), i18n-каркас `i18n/{ru,kk,en}.json` + тест совпадения ключей. Решение Q-07: все три языка включены; каждый добавляемый RU-текст сразу получает подготовленный перевод в `kk.json` и `en.json` (EN-тексты из SPEC — дословно); список KK-ключей на проверку носителем — `i18n/needs_review.json`; тексты-заглушки, которых нет в SPEC, — `i18n/needs_confirmation.json`.
4. **packages/ui**: `tokens.css` (раздел 3.1, dark/light), подключение в Tailwind 4 (`@theme`), шрифт self-hosted (Inter, см. Q-14) с `font-display: swap` и кириллицей/казахскими глифами; базовые компоненты 3.2 на Radix: `Button` (6 вариантов), `Card`, `Pill`, `Tabs`, `SegmentedControl`, `Field`, `Select`, `Textarea`, `Checkbox`, `Radio`, `Modal`, `Accordion`, `ProgressBar`, `Badge`, `EmptyState`, `Toast`, `Skeleton`, `Sidebar`, `Header`, `Footer`, `FloatingHelp` (каркасы; наполнение — в итерациях 3+).
5. **apps/api** (NestJS 11): модули-заготовки `auth, users, classes, content, quiz, assignments, results, gamification, ai, support, public, files, audit`; глобальный префикс `/api`; `@nestjs/swagger` → `/api/docs` и `openapi.json`; фильтр ошибок API-GEN-04 + `requestId`; валидация через Zod-pipe; конфиг env через Zod (падение при отсутствии обязательных переменных, AG-10); `helmet` (заготовка заголовков REQ-NFR-SEC-01); логгер pino с редактированием тел запросов/паролей/токенов (REQ-NFR-SEC-07); `GET /api/health`.
6. **apps/worker**: BullMQ-заготовка, подключение к Redis, регистрация очередей `outbox, email, file-scan, recalc, cleanup` (пустые процессоры).
7. **apps/web** (Next.js 15 App Router, React 19): структура `app/[locale]/(public|auth|teacher|student|staff)`, next-intl, TanStack Query provider, генерация клиента API из OpenAPI (`openapi-typescript` + `openapi-fetch`), Serwist (только manifest, офлайн-кеш выключен).
8. **infra/**: `docker-compose.yml` — postgres:16, pgbouncer, redis:7, minio (+ создание бакета), clamav, olevba (минимальный Python-сервис, `infra/olevba/`), mailpit (локальный SMTP для разработки); `nginx.conf` (заготовка); `.env.example` со всеми переменными 2.3.
9. Наблюдаемость: Sentry SDK (web/api/worker, включается при наличии `SENTRY_DSN`), OpenTelemetry SDK (экспорт при `OTEL_EXPORTER_OTLP_ENDPOINT`), эндпоинт метрик Prometheus у api.
10. CI — GitHub Actions (решение Q-04): job’ы install → lint → typecheck → test (Testcontainers) → build; кеш pnpm/turbo.
11. Скрипт `pnpm dev`: `docker compose up -d` + `turbo dev`.

### Создаваемые файлы/модули
`package.json, pnpm-workspace.yaml, turbo.json, tsconfig.base.json, eslint.config.mjs, .prettierrc, .env.example, .github/workflows/ci.yml`; `packages/{shared,ui,db}/*` (db — пустой каркас); `apps/{web,api,worker}/*`; `infra/{docker-compose.yml,nginx.conf,olevba/}`; `e2e/playwright.config.ts`.

### Покрываемые требования
REQ-GEN-DS-01, раздел 3.2 (каркасы), API-GEN-01, API-GEN-04, REQ-NFR-I18N-01 (тест ключей), REQ-NFR-SEC-07 (редактирование логов, requestId), REQ-NFR-OBS-01 (подключение SDK), AG-10.

### Проверка
- `pnpm i && pnpm dev` → `GET :3001/api/health` = 200, `:3000/ru` отдаёт страницу-заглушку, worker подключён к Redis, MinIO-бакет создан.
- `pnpm lint && pnpm typecheck && pnpm test` зелёные; CI-прогон зелёный.
- Unit: Zod-схемы 6.7 (позитив/негатив, в т.ч. `QuestionDto` — min2, exactlyOneCorrect); i18n-ключи совпадают; фильтр ошибок отдаёт формат API-GEN-04; логгер не пишет поле `password`.
- Storybook не вводим (не в стеке); компоненты проверяются unit-тестами (Vitest + Testing Library) на клавиатуру/фокус.

### Итог (2026-10-13) — выполнено
- `pnpm dev` (локально): `/api/health` = `{status: ok, database: ok, redis: ok}` через PgBouncer, `/api/docs` = 200, `/ru` = 200, worker слушает 5 очередей, бакет `syntara-files` создан, olevba и ClamAV healthy.
- `pnpm lint && pnpm typecheck && pnpm test` — зелёные: 48 тестов (shared 20, ui 7, api 17 вкл. integration на Testcontainers, worker 2, web 2); `pnpm e2e` — 18/18 (Chromium 1440 и 320 px, axe).
- CI (`.github/workflows/ci.yml`) — не прогонялся: у репозитория нет удалённого GitHub-репозитория.
- Отклонения: MinIO — образ `cgr.dev/chainguard/minio` (официальные `minio/minio`, `minio/mc` больше не публикуются); Serwist не подключён — офлайн выключен (PH-13), PWA-manifest через `app/manifest.ts`; язык по `Accept-Language` не определяется (в SPEC нет), только URL → cookie `locale` → `ru`; Sentry в web — только серверная часть.

---

## Итерация 2 — База данных

**Цель:** миграции раздела 5 применяются и откатываются; seed `config`, `demo`, `visual` проходит.

### Задачи
1. **packages/db**: Drizzle-схема всех таблиц 5.3–5.7 по модулям (`schema/users.ts, content.ts, quiz.ts, results.ts, ai.ts, support.ts, system.ts`), enum’ы 5.2, `created_at/updated_at` везде, кроме связующих; UUIDv7 генерируется в приложении (`uuidv7`).
2. Миграции drizzle-kit + ручные SQL-фрагменты в миграциях для того, что Drizzle не выражает:
   - расширение `citext`; частичные уникальные индексы (`ux_membership_active`, `ux_csa_active`, `ux_one_correct`);
   - `UNIQUE (subject_id, position) DEFERRABLE INITIALLY DEFERRED`; отложенный FK `topics.published_version_id`;
   - все CHECK-ограничения (длины, `email IS NOT NULL OR is_child_safe`, `context <> 'topic_tutor' OR topic_id IS NOT NULL` и др.);
   - триггер `check_assignment_topic()` (тема принадлежит предмету, 5.5);
   - триггер `updated_at`;
   - роли БД 5.8 (`app_user`, `migrator`, `analytics_ro`), `REVOKE UPDATE, DELETE ON audit_log FROM app_user`;
   - RLS-политики для таблиц со `school_id` (`classes`, `user_roles`, `audit_log`) через `current_setting('app.school_id', true)` — SHOULD, второй уровень защиты.
   - Down-миграции для каждой миграции (DoD 6).
3. Проблема PK `user_roles` с nullable `school_id` — решение по Q-15 до начала итерации.
4. Seed (`pnpm db:seed --set=config|demo|visual`):
   - `seed/config.json` — все ключи раздела 11 (ключ без префикса PH, PH-ID → `note`, `needs_confirmation=true`, `prodBlocked` сохраняется в value-обёртке);
   - `demo` — справочники: уровни (`levels` по BR-XP-03 — до уровня, нужного бейджу `legend`), 12 бейджей BR-BDG-01 с переводами RU, шаблоны `response_templates` (тексты — Q-09), демо-вопрос PH-02 (`is_demo=true`), публичные предметы PH-01, служебные пользователи для разработки;
   - `visual` — данные раздела 15 (Alexandr, «Школа-гимназия №73», классы «9»/«5»/«7», темы, вопросы, результаты, события с датами под U08/T10).
5. Сервис конфигурации в api: `ConfigService.get(key)` с кешем в Redis и типами из `packages/shared`.
6. Команды: `pnpm db:migrate`, `pnpm db:rollback`, `pnpm db:seed --set=…`, `pnpm db:reset`.

### Покрываемые требования
Раздел 5 целиком (5.1–5.8), AG-09, раздел 11 (загрузка заглушек), раздел 15 (seed visual), DoD 6.

### Проверка
- Integration (Testcontainers): `migrate up` → `down` → `up` на чистой базе.
- Тесты ограничений: два правильных варианта → нарушение `ux_one_correct`; второй активный membership → нарушение; assignment с темой чужого предмета → ошибка триггера; `app_user` не может `UPDATE/DELETE audit_log`; пользователь без email и без `is_child_safe` не вставляется.
- RLS: запрос под `app_user` с чужим `app.school_id` не видит строк.
- Seed `config|demo|visual` выполняются на чистой базе и повторно (идемпотентно).

### Итог (2026-10-13) — выполнено
- Схема: 55 таблиц и 16 перечислений раздела 5 (`packages/db/src/schema/*`), миграции `0000_extensions_roles` (citext, роли 5.8), `0001_schema` (drizzle-kit), `0002_constraints_triggers_rls` (DEFERRABLE-уникальность тем, триггеры `updated_at` и `check_assignment_topic`, права ролей, RLS) + откаты `migrations/down/*.sql`.
- Команды: `pnpm db:migrate | db:rollback [--steps=N|--all] | db:reset | db:seed --set=config|demo|visual | db:studio`; `config.get('<key>')` в api (`AppConfigService`, кеш Redis 60 с).
- Тесты: db 26 (migrate → rollback → migrate, ограничения, роли, RLS, идемпотентность seed), api +3 (config). Всего 80 unit/integration + 18 e2e.
- Решения по ходу: `created_at/updated_at` есть у всех таблиц, кроме таблиц с составным PK (переводы, связи, `topic_mastery`, `idempotency_keys`, `ticket_reply_tokens`, `response_templates`); `app_config.note` — столбец для PH-ID (раздел 11 говорит «PH-ID хранится в поле note», в DDL 5.7 его нет); seed-строки имеют детерминированные UUID (v5) ради идемпотентности; RLS без контекста школы не ограничивает (контекст — `SET LOCAL app.school_id`).
- Расхождения эталонов, оставленные до итерации 11 (визуальные тесты): U13 — ученик в классе «7», T04/T10 — в классе «9» (seed: «9»); серия 1 (U01/U10) и 0 (U08) — хранится 1, на 28.09 расчёт даёт 0; T10 «24 дня назад» и U08 «последнее занятие 05.09» несовместимы (seed: 05.09 → 23 дня); XP 20 при 5 пройденных квизах противоречит BR-XP-01 (seed хранит 20); «1 из 41 тем» и «Вопрос 1 из 9» требуют 41 темы и 9 вопросов, текстов которых нет; средняя успеваемость 64 % ≠ формула BR-AN-02 (57 %, Q-24).

---

## Итерация 3 — Оболочка и публичные страницы

**Цель:** хедер, футер, мобильное меню, плавающие кнопки, 10 публичных страниц (без форм и ИИ), язык/тема/трафик, cookie-баннер. AC-PUB-01..03, AC-GEN-01..03.

### Задачи
1. **Оболочка** (`apps/web/components/shell/*`): `PublicHeader` (меню 6 пунктов, активная капсула, язык, трафик, тема, «Войти»; sticky, `scroll-margin-top`), `MobileMenu` (< 1024 px; Escape, закрытие по переходу, возврат фокуса), `Footer` (колонки 3.3 / REQ-GEN-SHELL-05; email из API-PUB-07), `FloatingHelp` («?» — краткая справка по странице; кнопка помощника → /ai), ссылка «К содержимому».
2. **Предпочтения**: локаль в URL `/{ru|kk|en}` (next-intl middleware), смена языка через `router.replace` без перезагрузки и без потери состояния формы; в переключателе доступны все три языка (PH-04 = ru, kk, en — решение Q-07), механизм «скоро» для языков вне PH-04 сохраняется; тема: inline-скрипт в `<head>` ставит `data-theme` до отрисовки (cookie `theme`, иначе `prefers-color-scheme`); `data_saver` (cookie, атрибут `data-data-saver`): отключение анимаций, `loading=lazy` вне первого экрана, `prefetch={false}`. Для авторизованных синхронизация с `user_preferences` — в итерации 6.
3. **Cookie-баннер** REQ-PUB-LEGAL-02: «Только необходимые» / «Принять все», cookie `consent` 12 мес.; аналитических скриптов сейчас нет — при отказе они не подключаются (флаг для будущего).
4. **API**: `public` модуль — API-PUB-01 (`GET /api/public/subjects`, статусы `open|login_required|soon` по PH-01 и данным каталога), API-PUB-07 (`GET /api/public/config` — только публичные ключи).
5. **Страницы** `app/[locale]/(public)`: `/` (секции в порядке REQ-PUB-HOME-01; блок пробного вопроса — разметка-заготовка, логика в итерации 5; «Почему Syntara» — `tablist`, `activeIndex`, стрелки ←/→, без автопрокрутки), `/subjects`, `/about` (11 блоков), `/ai` (статичная левая часть; чат — итерация 5), `/schools`, `/schools/request` и `/support` (каркас страницы; форма — итерация 4), `/terms`, `/privacy`, `/cookies` (шаблон REQ-PUB-LEGAL-01, плашка PH-14).
6. Заглушка «Раздел в разработке» (PH-24) — общий компонент.
7. Безопасность: CSP, HSTS, `X-Content-Type-Options`, `Referrer-Policy`, `frame-ancestors 'none'` в `next.config` и nginx (REQ-NFR-SEC-01); бюджет размера главной ≤ 500 КБ (REQ-NFR-PERF-01) в CI.
8. Все тексты — дословно из SPEC в `ru.json` (недостающие тексты — Q-05/Q-06).

### Покрываемые требования
REQ-GEN-SHELL-01, -04 (без лампочки), -05, -06, -07; REQ-GEN-PREF-01..05 (без серверного сохранения); REQ-PUB-HOME-01..03, -05..-09 (HOME-04 — разметка); REQ-PUB-SUBJ-01..03; REQ-PUB-ABOUT-01..02; REQ-PUB-AI-01 (левая часть); REQ-PUB-SCH-01..03; REQ-PUB-LEGAL-01..02; API-PUB-01, API-PUB-07; REQ-NFR-SEC-01; REQ-NFR-PERF-01 (бюджет).
AC: AC-GEN-01, AC-GEN-02 (часть для публичных страниц; урок — в итерации 8), AC-GEN-03, AC-PUB-01..03.

### Проверка
- Playwright: прямой заход на каждый из 10 маршрутов = переход из меню, активный пункт верный (AC-GEN-01); 320 px — нет горизонтального скролла, меню закрывается Escape, фокус на «Меню» (AC-GEN-03); порядок секций и синяя третья строка H1 (AC-PUB-01); «Почему Syntara» — клик/←/→, синхронность панели и индикатора, отсутствие автопрокрутки за 10 с (AC-PUB-02); «Только необходимые» — нет аналитических cookie, баннер не появляется после перезагрузки (AC-PUB-03); смена языка/темы сохраняет состояние, нет мигания темы (AC-GEN-02, частично).
- axe на всех 10 страницах в dark и light; тест заголовков безопасности.
- Integration: API-PUB-01 статусы, API-PUB-07 не отдаёт непубличные ключи.
- Визуальные снимки — при наличии S01–S26 (Q-02).

### Итог (2026-10-13) — выполнено
- Доработки по решениям после итерации 2: роль `app_maintenance` (миграция `0003`, SPEC 5.8), `app_config.note` в SPEC 5.7, ученик seed `visual` — в классе «7», демо-контент (11 тем «Анатомии человека», у «Сердечно-сосудистой системы» 9 вопросов, у остальных по 3; 28 тем «Общей биологии»; итого 41 тема у ученика), визуальные тесты итерации 11 будут маскировать динамические значения (SPEC 16).
- Оболочка: хедер (6 пунктов, активная капсула, язык, трафик, тема, «Войти»), мобильное меню (< 1024 px), футер, плавающие «?» и помощник, ссылка «К содержимому», cookie-баннер, заглушки PH-24 для `/auth/login`, `/auth/start`, `/join`, `/account/privacy`.
- Предпочтения: язык — клиентская навигация без перезагрузки с сохранением состояния в памяти вкладки; тема — cookie + `prefers-color-scheme` до отрисовки; экономия трафика — атрибут `data-data-saver`, без prefetch и декоративной графики.
- 10 страниц раздела 8.1 (формы — итерация 4, пробный вопрос и чат — итерация 5); API-PUB-01, API-PUB-07; CSP с nonce, HSTS и др. (REQ-NFR-SEC-01).
- Тексты: 261 ключ в ru/kk/en; заглушки — `i18n/needs_confirmation.json` (84 ключа), KK — `i18n/needs_review.json`; тексты-заглушки раздела 11 сверяются с `seed/config.json` тестом.
- Тесты: 98 unit/integration, 132 e2e (Chromium 1440 и 320 px, axe на 10 страницах в обеих темах).
- Решения по ходу: Q-22 — гость получает `login_required` (есть опубликованные темы) или `soon`, `open` — после входа ученика (итерация 6); иконки карточек предметов (dna, flask-conical, atom) — `TODO(OWNER)`; для контраста ≥ 4,5:1 добавлен токен `--accent-strong` (#1E63E4, в пределах диапазона 3.1), светлый `--accent` — #1765E8.

---

## Итерация 4 — Формы и поддержка

**Цель:** заявка школы и обращение в поддержку с idempotency и outbox, email-worker, служебные очереди `/staff`. AC-FRM-01..05, AC-SUP-01..02.

### Задачи
1. **Минимальный auth-core** для `/staff` (сессии `sid`, CSRF double-submit, `POST /api/auth/login|logout`, `GET /api/me`, `RolesGuard`) — переносится из итерации 6, т. к. очереди требуют входа (решение Q-01 — согласовано). Регистрация/сброс/классы остаются в итерации 6.
2. **Idempotency** (API-GEN-05): interceptor — `(scope, key)`, хеш тела, сохранённый ответ, 409 `IDEMPOTENCY_MISMATCH`, TTL 24 ч (очистка — worker `cleanup`).
3. **Rate limit** (API-GEN-06): `@nestjs/throttler` с Redis-хранилищем, 5/мин на IP для форм, 429 с `retryAfterSeconds`.
4. **API-PUB-04/05**: в одной транзакции — запись, `idempotency_keys`, `outbox_events('email.confirmation')` (BR-FRM-01); `public_number` `SR-YYMMDD-NNNN` / `T-YYMMDD-NNNN` (BR-FRM-02; генерация с повтором при коллизии, дата в PLATFORM_TZ).
5. **Worker**: `outbox` — опрос/`FOR UPDATE SKIP LOCKED`, публикация в `email_queue`; `email` — nodemailer, шаблоны писем (номер, тип, способ ответа, без текста обращения — BR-FRM-03), повтор с экспоненциальной задержкой; ошибка SMTP не трогает запись (BR-FRM-04); cron `resolved → closed` через 7 дней (BR-SUP-02).
6. **Web — формы** (`components/forms/*`): общий хук `useSubmitForm` по SM-FORM (валидация при отправке и blur затронутых полей, сводка ошибок + фокус на первое поле, «Отправляем...», ключ один на содержимое, новые ключ при изменении, таймаут 15 с, тексты network/server ошибок, `beforeunload`, без localStorage); `/schools/request` (REQ-PUB-REQ-01..02, согласие PH-15); `/support` (REQ-PUB-SUP-01..03, `techContext` автоматически, `?category=` предвыбор).
7. **Staff API** (API-SUP-01..07): очередь с фильтрами, поиском по номеру/email, курсорной пагинацией (API-GEN-07); карточка; assign; reply (через `response_templates`, предпросмотр текста и адреса); notes (`is_internal`); status — конечный автомат SM-TICKET в `packages/shared` (переходы проверяются на сервере, иначе 409 `INVALID_TRANSITION`); SM-REQUEST для заявок; всё в `ticket_status_history` + `audit_log` (BR-SUP-03).
8. **API-SUP-08** входящие письма: вебхук, токен из `ticket_reply_tokens` (выдаётся при отправке ответа, в Reply-To), resolved/closed → reopened (BR-SUP-01). Формат провайдера — Q-10; до ответа — нейтральный формат `{token, from, text}` под флагом.
9. **Web — `/staff/tickets`, `/staff/requests`** (`(staff)`): список с фильтрами, карточка, действия; внутренние заметки визуально отличаются; ИИ не используется (REQ-SUP-04).

### Покрываемые требования
API-PUB-04, -05, API-GEN-05, -06 (формы), -07; BR-FRM-01..04; SM-FORM; REQ-PUB-REQ-01..02; REQ-PUB-SUP-01..03; API-SUP-01..08; REQ-SUP-01..04; SM-TICKET; SM-REQUEST; BR-SUP-01..03; BR-ACL-04 (staff ↔ учебные роли); REQ-NFR-SEC-05 (статусы обращений); API-AUTH-01, -02, API-ME-01 (минимум).
AC: AC-FRM-01..05, AC-SUP-01..02.

### Проверка
- Playwright: пустые обязательные поля → ошибки, сводка, фокус, сетевого запроса нет (AC-FRM-01); валидная заявка → «Отправляем...», «Заявка получена», номер `SR-…`, email (AC-FRM-02); `page.route` с обрывом → текст сети, ввод сохранён (AC-FRM-04).
- Integration: одна запись + outbox в одной транзакции, откат при ошибке outbox (AC-FRM-02); повтор с тем же ключом → тот же ответ, одна запись; другое тело → 409 (AC-FRM-03); SMTP недоступен (mailpit остановлен) → 201, письмо в `email_queue` с ростом `attempts` (AC-FRM-05); назначение/ответ/решение — статусы, история, автор, заметка не в письме (AC-SUP-01); входящее письмо на resolved → reopened (AC-SUP-02); недопустимый переход → 409; teacher/student на `/api/staff/*` → 403/404, support_agent на `/api/staff/requests` → отказ.
- Unit: генератор public_number, SM-TICKET (все разрешённые/запрещённые переходы), шаблон письма не содержит описания.

### Итог (2026-10-14) — выполнено
- Перед итерацией: GitHub Actions обновлены (checkout v7, setup-node v7, pnpm/action-setup v6, upload-artifact v7), runner зафиксирован — `ubuntu-24.04`; TODO(OWNER) по иконкам предметов снят (решение владельца).
- Вход (Q-01): `POST /api/auth/login|logout`, `GET /api/me`; cookie `sid` (HttpOnly, Secure, SameSite=Lax, 14 дней, продление раз в сутки), в БД — HMAC-SHA256 токена; CSRF — double-submit (`csrf` + `X-CSRF-Token`) для изменяющих запросов с сессией; глобальные `SessionGuard` и `RolesGuard` (401/403). Страница `/auth/login` (минимальная версия REQ-GEN-AUTH-01): после входа — `returnTo` из белого списка или страница по роли. Для `/teacher/courses` и `/learn/subjects` — заглушки PH-24.
- Лимиты (API-GEN-06): `@nestjs/throttler` с хранилищем в Redis; формы — 5 в минуту на IP (общий счётчик обеих форм), вход — 10 за 15 минут на IP+email; 429 с `retryAfterSeconds` и `Retry-After`. `RATE_LIMITS_DISABLED` — только для e2e, в продуктиве запрещён схемой env.
- Idempotency (API-GEN-05): ключ, хеш тела и сохранённый ответ пишутся в одной транзакции с записью; параллельные дубли дают одну запись; другое тело — 409 `IDEMPOTENCY_MISMATCH`; очистка просроченных ключей — worker `cleanup`.
- Формы (API-PUB-04/05, BR-FRM-01..04): одна транзакция — запись, ключ, `email_queue`, `outbox_events`; номера `SR-/T-YYMMDD-NNNN` в PLATFORM_TZ с повтором при коллизии. Web — общий хук `useSubmitForm` по SM-FORM (React Hook Form + Zod), формы `/schools/request` и `/support` (`?category=`, techContext, подпись), значения переживают смену языка.
- Worker: outbox (`FOR UPDATE SKIP LOCKED`, раз в 2 с) → очередь `email` → nodemailer (локально — Mailpit), 10 попыток с экспоненциальной задержкой, затем `failed`; ответы сотрудника получают Reply-To `support+<токен>@…` (в БД — только хеш токена); автозакрытие resolved → closed через 7 дней (BR-SUP-02) с историей и аудитом.
- Служебные очереди: API-SUP-01..07 (фильтры, поиск по номеру/email, срок первого ответа по PH-22, курсорная пагинация, карточка с перепиской, заметками, историей и шаблонами, назначение, ответ, смена статуса по SM-TICKET/SM-REQUEST, аудит); web `/staff/tickets` и `/staff/requests` (список + карточка `?ticket=` / `?request=`). API-SUP-08 — нейтральный формат `{token, from, text}`, выключен флагом `support.inbound_email` (Q-10).
- Тексты: +148 ключей (ru/kk/en); тексты SPEC — дословно; недостающие (служебный интерфейс, письма, сообщения входа) — в `needs_confirmation.json` (+111), KK — в `needs_review.json`.
- Доступность: axe нашёл недостаточный контраст текста ошибок (`--danger` на фоне — 4,3:1) — добавлен токен `--danger-text` (тёмная #F0686C, светлая #D13438); в бейджах статусов: «успех» — тёмный текст на зелёном, «акцент» — фон `--accent-strong`.
- Тесты: 169 unit/integration (api 75, db 30, shared 36, web 11, worker 10, ui 7), 176 e2e (Chromium 1440 и 320 px). Миграций нет — схема не менялась (флаг входящих писем — данные seed).

---

## Итерация 5 — Пробный вопрос и публичный помощник

**Цель:** SM-DEMO, публичный чат по SSE, `LLMProvider` (mock + реальный), лимиты. AC-PUB-04..06.

### Задачи
1. **API-PUB-02/03**: выдача `is_demo` вопроса без `isCorrect` (BR-QZ-01), `?exclude=`, `version` (для защиты от смены вопроса); проверка ответа — `correct, correctOptionId, explanation`; без событий и баллов (BR-QZ-09).
2. **Web — блок пробного вопроса** на главной (REQ-PUB-HOME-04) по SM-DEMO: загрузка/ошибка/«Повторить загрузку», radio-группа, «Проверить ответ» disabled до выбора, «Верно»/«Пока неверно» с иконкой, подсветка, объяснение, «Попробовать ещё раз», «Другой вопрос» (скрыта при одном вопросе), «Перейти к предмету».
3. **`modules/ai`**: интерфейс `LLMProvider` (`stream(messages, signal)`), реализации `MockProvider` (PH-19) и реальная через Vercel AI SDK (`openai-compatible`/`anthropic` по `LLM_PROVIDER`, см. Q-11); сборщик промпта BR-AI-02 (без ПД; фильтр email/телефонов в истории); санитизация ответа и ссылок (BR-AI-07: только маршруты раздела 4 и URL атласов); SSE-хелпер `event: delta|done|error`, отмена по закрытию соединения.
4. **API-PUB-06**: `message ≤ 2000`, `history ≤ 20`, без сохранения на сервере (BR-AI-05); лимиты PH-20 (per_minute/per_day по IP) → 429 `retryAfterSeconds`; режим mock: быстрые вопросы → ответы `ai.public_quick_answers`, свой вопрос → `ai.unavailable_public` со ссылкой /support.
5. **Web — чат `/ai`** (REQ-PUB-AI-01..06): быстрые вопросы, Enter/Shift+Enter, счётчик > 1800, «Готовлю ответ...», «Остановить», «Ответ прерван», «Повторить» с сохранением текста, текст 429, «Очистить диалог», история в памяти вкладки; ИИ-модуль — динамический импорт (REQ-NFR-PERF-01); статусы через `aria-live`.

### Покрываемые требования
API-PUB-02, -03, -06; SM-DEMO; REQ-PUB-HOME-04; REQ-PUB-AI-01..06; BR-QZ-01, BR-QZ-09; BR-AI-01..03, -05..-07; PH-19, PH-20; API-GEN-06 (ИИ).
AC: AC-PUB-04..06.

### Проверка
- Playwright: перехват ответа API-PUB-02 — нет `isCorrect`/`is_correct`; кнопка неактивна до выбора (AC-PUB-04); неверный выбор → «Пока неверно», подсветка обоих, объяснение, в БД нет событий/XP (AC-PUB-05); mock: быстрый вопрос → ответ PH-19, свой → «Помощник пока недоступен…» + ссылка /support (AC-PUB-06); «Остановить» → «Ответ прерван».
- Integration: 11-й запрос за минуту → 429; промпт не содержит email/телефон из истории; ссылки на внешние домены вырезаны.
- Unit: санитайзер ссылок, сборщик промпта, SSE-сериализация.


### Итог (2026-10-14) — выполнено
- Решения владельца по итогам итерации 4 внесены отдельным коммитом: ответ по шаблону «Уточнение» → waiting_user, «Решение» → resolved (SPEC 9 SM-TICKET, 6.6 API-SUP-04); срок первого ответа — в рабочих часах PH-22 (пн–пт 09:00–18:00, UTC+5), фильтр «срок до» — точной обратной функцией по `created_at`; `--danger-text` подтверждён.
- API-PUB-02/03 (SM-DEMO, BR-QZ-01, BR-QZ-09): пробный вопрос опубликованной темы официального каталога без правильного ответа; `version` — хеш содержимого (другая версия → 409); `exclude` и признак `hasAnother` для «Другой вопрос» (скрыта при одном вопросе, PH-02); проверка ничего не пишет в БД.
- Модуль ai: интерфейс `LLMProvider`, `MockProvider` с ответами PH-19 (решение по Q-11: реальная модель позже, любой `LLM_PROVIDER` пока работает как mock); промпт BR-AI-02 (база знаний — PH-19 и справка по страницам, последние 20 сообщений, email/телефоны вырезаются); потоковая санитизация ссылок и HTML (BR-AI-07); SSE `delta/done/error`, отмена при закрытии соединения; на сервере ничего не сохраняется (BR-AI-05).
- Лимиты ИИ (API-GEN-06, PH-20): 10 в минуту и 50 в сутки на IP, значения читаются из `app_config`.
- Web: блок пробного вопроса на главной (radio-группа, «Верно»/«Пока неверно» с иконкой и пометками вариантов, объяснение, «Попробовать ещё раз», «Перейти к предмету» → /subjects); чат `/ai` (REQ-PUB-AI-01..06) — Markdown через react-markdown + rehype-sanitize, история в памяти вкладки (переживает смену языка), модуль чата — динамический импорт.
- Тексты: +39 ключей (ru/kk/en); недостающие — +11 в `needs_confirmation.json`; ответы PH-19 в i18n сверяются с seed тестом.
- `NEXT_DIST_DIR` — необязательный отдельный каталог сборки web (локальный e2e при запущенном `pnpm dev`).
- Тесты: 202 unit/integration (api 97, shared 47, db 30, web 11, worker 10, ui 7), 200 e2e. Миграций нет.

---

## Итерация 6 — Аккаунты и классы

**Цель:** вход, регистрация учителя, сессии, CSRF, классы, коды, `/join`, Leave, «Мои данные», оболочка кабинетов. AC-AUTH-01..04.

### Задачи
1. **Auth (расширение итерации 4)**: Argon2id (REQ-NFR-SEC-02); `auth_sessions` с хешем токена, продление до 14 дней (REQ-NFR-SEC-03); лимит входа 10/15 мин IP+email; `POST /api/auth/register` (только `role: 'teacher'`, пароль ≥ PH-06, письмо подтверждения — Q-12); `password/forgot|reset` (TTL PH-06); `consents` при регистрации.
2. **Me**: API-ME-01 (initials, roles, activeRole, preferences), API-ME-02 (синхронизация с cookie из итерации 3), API-ME-03 (переключение роли), API-ME-04 (уведомления, лимит PH-32 — список пуст, см. Q-20), API-ME-05 (заявка export/delete → обращение `data_privacy`, PH-08).
3. **Web**: `/auth/login` (returnTo — белый список префиксов, иначе `/`; по роли → `/teacher/courses` / `/learn/subjects`), `/auth/start` (Ученик/Учитель, BR-CLS-04), регистрация учителя, «Забыли пароль?», `/account/privacy`; middleware Next.js — перенаправление неавторизованных с сохранением цели.
4. **Оболочка кабинетов**: `CabinetHeader` (выбор роли, язык, трафик, тема, уведомления, профиль, «Выйти»; у ученика серия и XP из API-S-16 — эндпоинт в этой итерации, значения из `student_stats`), `Sidebar` ~70 px (значки без страницы → PH-24), «лампочка» между плавающими кнопками (содержимое — Q-21).
5. **Классы**: API-T-04/05 (создание `{name}`), API-T-06 (код по BR-CLS-01/PH-07: 6 символов, SHA-256 с солью, 30 дней, показывается один раз); минимальная страница `/teacher/classes` (список, создать, выпустить код).
6. **Join**: API-PUB-08 (только `valid`, лимит 10/15 мин), API-S-01 (после входа и подтверждения, без дубля), API-S-02, API-S-03 (SM-MEMBERSHIP, PH-40); `/join` (REQ-GEN-AUTH-03) и карточка класса на `/learn/subjects` (REQ-ST-CAT-01; сам каталог — итерация 8).
7. **Регистрация ученика по коду класса (PH-44, решение Q-16)**: `POST /api/auth/register-student { code, displayName, login, password, email? }` — повторная проверка кода, пользователь `student` (без email — `is_child_safe = true`), согласие в `consents`, активное членство — одной транзакцией; без действующего кода — отказ; лимит как у проверки кода. На `/join` после «Код подходит…» — форма «имя, логин, пароль, email (необязательно)»; вход по логину на `/auth/login`. Тексты — `needs_confirmation`. Тесты: регистрация с годным кодом → аккаунт + членство; с истёкшим/неверным → 404/422 без создания пользователя; дубль логина → 409.
8. **Аудит**: состав классов (REQ-NFR-SEC-05).
9. **Генерируемый тест прав** (REQ-NFR-SEC-04): реестр маршрутов из OpenAPI → для каждого `/api/teacher/*`, `/api/student/*` с чужим ID ожидается 404; без сессии — 401; staff на учебных — отказ. Расширяется в каждой следующей итерации.

### Покрываемые требования
API-AUTH-01..04, API-ME-01..05, API-GEN-02, API-GEN-06 (вход, коды), API-PUB-08, API-T-04..06, API-S-01..03, API-S-16; BR-CLS-01..04; SM-MEMBERSHIP; REQ-GEN-AUTH-01..04; REQ-GEN-SHELL-02, -03, -04 (лампочка); REQ-GEN-PREF-01, -03 (сохранение в `user_preferences`); REQ-ST-CAT-01; REQ-NFR-SEC-02..05; BR-ACL-02, BR-ACL-04.
AC: AC-AUTH-01..04.

### Проверка
- Playwright: гость с годным кодом → «Код подходит. Войдите, чтобы присоединиться», ответ без данных класса (AC-AUTH-01); двойное подтверждение → одна активная запись (AC-AUTH-02); выход из класса → карточка исчезает (AC-AUTH-04 UI).
- Integration: 11-я проверка кода → 429 `retryAfterSeconds` (AC-AUTH-03); после leave предметы класса недоступны через BR-VIS-01-сервис, результаты сохранены (AC-AUTH-04 API, окончательно — с каталогом в итерации 8); cookie флаги и CSRF (без заголовка → 403); пароль хранится как argon2id; код класса и токен сессии только хешами; returnTo `//evil.com` → `/`.
- Генерируемый тест SEC-04 для всех существующих маршрутов.


### Итог (2026-10-14) — выполнено
- Вход (API-AUTH-01) — по email или логину ученика (PH-44); подпись поля «Email или логин» — заглушка.
- Регистрация учителя (API-AUTH-03, PH-06, PH-17): аккаунт, роль, предпочтения (язык регистрации), согласие `terms_privacy` и письмо — одна транзакция, затем вход. Подтверждение email (Q-12) — TODO(OWNER): нужен признак в `users` (миграция).
- Восстановление пароля (API-AUTH-04) без новых маршрутов: `/auth/login?forgot=1` и `/auth/login?resetToken=…`; ответ «забыли пароль» одинаков для любого email; токен создаёт worker при отправке письма, в Redis — только хеш с TTL PH-06; после сброса все сессии пользователя завершаются.
- Профиль: API-ME-02 (предпочтения в `user_preferences`, web синхронизирует выбор языка, темы и трафика), API-ME-03 (активная роль — cookie, проверяется по ролям), API-ME-04 (пустой список, Q-20), API-ME-05 (запрос копии/удаления → обращение `data_privacy`, PH-08), API-S-16 (серия и XP).
- Классы (API-T-04..06, BR-CLS-01..04, SM-MEMBERSHIP): код 6 символов PH-07, срок 30 дней, хранится как SHA-256 с солью (HMAC с серверным секретом), показывается один раз; API-PUB-08 — только `valid`; вступление без дублей; выход сохраняет результаты; состав классов — в `audit_log`. Лимит 10 за 15 минут на IP — проверка кода, вступление, регистрация ученика.
- Регистрация ученика по коду (PH-44): логин 3–32 символа (TODO(OWNER) по формату), email необязателен (без email — child-safe); код проверяется повторно; аккаунт, согласие и членство — одна транзакция.
- Сервис видимости BR-VIS-01 (каталог и уроки будут использовать его с итерации 8): после выхода из класса предметы класса недоступны.
- Генерируемый тест прав REQ-NFR-SEC-04: все маршруты `/api/teacher/*` и `/api/student/*` из OpenAPI — гость 401, служебная роль 403, чужая учебная роль 403, чужой/несуществующий ID 404.
- Web: оболочка кабинетов (хедер с ролью, серией и XP, языком, трафиком, темой, уведомлениями, профилем и «Выйти»; боковая панель ~70 px; «лампочка» — PH-24; футер с «Кабинет»); `/auth/start` с регистрацией учителя; `/join` с регистрацией ученика по коду и подтверждением вступления; `/teacher/classes`; карточка класса на `/learn/subjects` с подтверждением выхода; `/account/privacy`; заглушки PH-24 для разделов следующих итераций.
- Найден и исправлен тест итерации 4, зависевший от времени суток (срок первого ответа после 18:00).
- Тексты: +113 ключей (ru/kk/en); заглушки — в `needs_confirmation.json`.
- Тесты: 229 unit/integration (api 122, shared 47, db 30, worker 12, web 11, ui 7), 220 e2e. Миграций нет.


### Исправление владельца (2026-10-14) — выполнено
- Самостоятельная регистрация ученика (PH-17 = true, BR-CLS-04, REQ-GEN-AUTH-02, API-AUTH-03S): экран `/auth/start?role=student` по эталону — «Syntara», «УЧЕНИК», «Вход или регистрация», вкладки «Регистрация» / «Вход»; поля «Имя», «Логин» (email в поле логина → подсказка), «Пароль» с показом, «Email» (необязательно), «Школа» (автодополнение API-PUB-09, «Нет в списке? Ввести вручную» → школа со статусом `unverified`), «Код класса (необязательно)»; «Создать аккаунт» → сразу кабинет; согласие со ссылками, «Аккаунт нужен только…», «Забыл пароль?», «Продолжить без входа →» (`/`: пробный вопрос и предметы). Верный код — сразу в классе, школа из класса; неверный — 400 без создания аккаунта. `/join` ведёт на ту же форму с заполненным кодом.
- Восстановление пароля без email (BR-CLS-05): учитель видит учеников класса (API-T-26, минимальная версия) и выдаёт временный пароль (API-T-27, показывается один раз, сессии ученика завершаются); ученик обязан сменить его при входе (API-AUTH-05), кабинет до смены недоступен.
- Подтверждение email учителя (API-AUTH-06): ссылка в письме регистрации, напоминание «Подтвердите email» с повторной отправкой в кабинете; вход до подтверждения разрешён.
- Миграция `0004_self_registration`: `users.email_verified_at`, `users.must_change_password` (накат/откат проверены); демо-школы в seed (TODO(OWNER): реальный список).
- SPEC обновлён: 5.3, 6.2–6.4, 7.7, 8.2, 10, 11 (Q-16 решён), 13 (AC-AUTH-05..08), журнал 16.
- Тексты: обращение к ученику на «ты», формулировки эталона на «вы» — в `needs_confirmation.json`; +58 ключей (ru/kk/en).
- Сравнение с эталоном: `docs/media/student-auth-compare.png` (поля ≥ 16 px по REQ-GEN-SHELL-07 — чуть крупнее эталона).
- Тесты: 240 unit/integration (api 132), 240 e2e (в т. ч. 4 сценария владельца). CI зелёный (`674338b`).

---

## Основа дизайна (перед итерацией 7)

**Когда:** после исправления итерации 6, до итерации 7 (решение владельца 2026-10-14). Логику и тексты не меняет; React Bits не подключается (они — в итерации 8.5).

### Задачи
1. Дизайн-токены в одном месте — `packages/ui/tokens.css` (REQ-GEN-DS-01): цвета, шрифт, размеры текста, отступы, радиусы, тени, длительности.
2. Кнопки, поля, карточки, вкладки, хедер, боковая панель и кабинеты — на токенах: одинаковые скругления, отступы и состояния hover / focus / disabled / ошибка.
3. Плавность 150–200 мс на кнопках, полях, карточках, ссылках, вкладках; отключается при `prefers-reduced-motion` и «Экономии трафика».
4. Фон с тонкими линиями на страницах входа, регистрации и `/join` — CSS/SVG без библиотек.
5. Скриншоты «до» и «после»: `docs/media/design/before/`, `docs/media/design/after/` (скрипт `e2e/scripts/design-shots.mjs`).

### Итог (2026-10-15)
- **Токены** (`packages/ui/tokens.css`, подключены в Tailwind через `@theme` в `apps/web/app/globals.css`): цвета 3.1 + `--border-strong` (hover), `--warning`, `--backdrop-line`; радиусы `--radius-card` 20 / `--radius-control` 16 / `--radius-field` 12 / `--radius-item` 8 / `--radius-pill`; отступы `--space-1…7` = 8…64 (сетка 3.1); высоты `--control-h` 44, `--field-h` 48, `--sidebar-w` 70; размеры текста публичных страниц и кабинетов (3.1); тени `--shadow-card/-popover/-fab/-accent`, кольца фокуса; `--duration-fast` 150 мс, `--duration-base` 200 мс, `--ease-standard`. Для светлой темы добавлены `--border-strong`, `--backdrop-line` и тени (Q-25, по-прежнему TODO(OWNER)).
- **Компоненты:** общий класс поля `fieldClass` (экспорт `@syntara/ui`) — им пользуются Field/Input/Textarea/Select, форма ученика и выбор школы; кнопки — hover и нажатие только у доступных, disabled — 50 % без тени; поле — hover светлее рамка, фокус синий контур со свечением, ошибка — рамка и свечение `--danger`; меню и всплывающие панели — `--radius-field` + `--shadow-popover`; боковая панель и капсулы хедера — hover-подложка. Убраны разнобойные `rounded-xl/2xl/lg/md/[24px]`, `shadow-lg/xl` и литерал `#f5b301`.
- **Заголовки:** кабинеты — `text-cabinet-title` (28 px), формы и правовые страницы — `text-page-title` (30→36 px).
- **Плавность:** правило в `@layer base` для ссылок, кнопок, полей, вкладок, пунктов меню — 150 мс; ProgressBar и индикатор «Почему Syntara» — 200 мс.
- **Фон с линиями:** `AuthBackdrop` (`components/shell/auth-backdrop.tsx`) — сетка 64 px с затуханием и пучки диагональных линий (маска SVG); подключён в `(auth)/auth/layout.tsx` (вход, регистрация, сброс пароля) и на `/join`. Декоративный: `aria-hidden`, `data-decorative` — скрыт в «Экономии трафика».
- **Вход** (`/auth/login`): форма на карточке, как экран ученика.
- **CI:** коммит `3c93a0b` падал на lint (`console.log` и форматирование в `design-shots.mjs`) — исправлено. Падения `c6f1096` и первого прогона этой задачи (шаг Test) — нестабильный тест worker `queues.spec.ts`: `QueueEvents` читал поток событий с «$» и терял «completed», если worker успевал раньше первого XREAD. Исправлено по причине: чтение с начала потока (`lastEventId: 0-0`) на отдельном соединении.
- **Тесты:** e2e `design-foundation.spec.ts` (REQ-GEN-DS-01, REQ-GEN-PREF-04): токены, радиус и высота поля, hover/ошибка поля, 150 мс и отключение при reduced motion и «Экономии трафика», фон на 4 страницах (aria-hidden, без горизонтальной прокрутки, axe, скрытие в data saver), нет фона вне входа, светлая тема + axe; unit `packages/ui` — токены и состояния Button/Field. Итого: unit — все пакеты зелёные, e2e — 258 passed.

---

## Итерация 7 — Кабинет учителя: контент

**Цель:** предметы, выдача классу, темы, Markdown, файлы и проверка, публикация, версии, квиз. AC-TCH-01..07.

### Задачи
1. **Предметы**: API-T-01 (`/teacher/courses` — минимальный список, PH-24), API-T-02/03 (минимум один язык с title, длины PH-23); `/teacher/subjects/new` (REQ-TCH-SUBJ-01..04; состояние вкладок RU/KK/EN в одной форме RHF, независимо от языка UI — REQ-GEN-PREF-05).
2. **Выдача и темы**: API-T-07 (идемпотентно), API-T-08 (revoke), API-T-09; `/teacher/subjects/:id` (REQ-TCH-ACC-01..02); аудит выдачи.
3. **Видимость**: `VisibilityService.canStudentSeeTopic` (BR-VIS-01..03) в `content`-модуле — единая точка для всех ученических эндпоинтов и выдачи файлов.
4. **Редактор темы**: API-T-10 (сохранение без смены статуса), `/teacher/topics/:id` в порядке REQ-TCH-TOP-01; Markdown-редактор с вкладкой «Просмотр» (react-markdown + rehype-sanitize; общий компонент `SafeMarkdown` для web); API-T-11 ИИ-черновик через `LLMProvider` (ничего не сохраняет; недоступно → «ИИ-черновик сейчас недоступен»; см. Q-13).
5. **Файлы**: API-T-16 (лимиты BR-FILE-01/02 до выдачи URL: тип, размер, ≤ 20 файлов/≤ 200 МБ на тему → 413/422), presigned PUT в S3, API-T-17 (повторная проверка лимитов и сигнатуры → `file-scan`); worker `file-scan`: ClamAV (clamd INSTREAM) + olevba для офисных форматов → `clean`/`rejected` + удаление объекта (SM-FILE, BR-FILE-03); API-T-18 галерея обложек (BR-FILE-05, PH-26); подписанные GET-ссылки 10 мин только для `clean` (BR-FILE-04). UI: обложка (URL или файл, миниатюры, синяя рамка), материалы со статусами «Проверяется / Готов / Отклонён».
6. **Публикация**: API-T-12 (snapshot в `topic_versions`, `published_version_id`, `version_no`+1, `changeNote ≤ 500`), API-T-13 (PH-27), API-T-14 (список версий, без восстановления — PH-25), API-T-15 (предпросмотр владельцем); SM-TOPIC; блок публикации REQ-TCH-PUB-01..05; аудит публикаций. Предпросмотр рендерит тот же компонент урока, что и ученик (заготовка компонента урока — здесь, полная страница — итерация 8).
7. **Квиз**: API-T-19..21 (`QuestionDto`, true_false — фиксированные «Верно»/«Неверно», архивирование, порядок); `/teacher/topics/:id/quiz` (REQ-TCH-QZ-01..04; 2–8 вариантов).
8. **Ранний ученический API для AC**: API-S-04 и API-S-06 (только серверная часть, без UI) — нужны для AC-TCH-02/03.

### Покрываемые требования
API-T-01..03, -07..-21, API-S-04, -06 (сервер); BR-VIS-01..03; BR-ACL-01; BR-FILE-01..05; SM-FILE; SM-TOPIC; BR-QZ-02; REQ-TCH-SUBJ-01..04; REQ-TCH-ACC-01..02; REQ-TCH-TOP-01..06; REQ-TCH-PUB-01..05; REQ-TCH-QZ-01..04; REQ-GEN-PREF-05; REQ-NFR-SEC-05 (выдача, публикация); REQ-NFR-SEC-06 (Markdown).
AC: AC-TCH-01..07.

### Проверка
- Playwright: создание предмета только с KK-названием, ввод на RU/EN не теряется при переключении (AC-TCH-01); ИИ-черновик заполняет RU и KK, в БД изменений нет (AC-TCH-04); форма вопроса с двумя правильными / одним вариантом → ошибка, запрос не создаёт вопрос (AC-TCH-07).
- Integration: тема-черновик в предмете с флагом каталога → ученик получает 404 (AC-TCH-02); выдача классу → ученик видит предмет и только опубликованные темы (AC-TCH-03); DOCX с макросом (фикстура) → `rejected`, объект удалён, ссылка ученику не выдаётся (AC-TCH-05); 21-й материал → 413/422 до выдачи URL (AC-TCH-06); изменения опубликованной темы не видны ученику до повторной публикации (REQ-TCH-PUB-05); XSS-нагрузки в Markdown обезврежены; чужой предмет/тема/вопрос → 404 (SEC-04 расширен).
- Тестовый EICAR-файл → `rejected`.

### Итог (2026-10-16)
- **API** (модули content, files, quiz): API-T-01..03, -07..-21; ранний ученический API-S-04, -06 (только сервер). Владение проверяет `OwnershipGuard` до разбора тела: чужой или несуществующий предмет, тема, вопрос, файл → 404 (BR-ACL-01, API-GEN-08). Видимость ученику — только через `VisibilityService` (BR-VIS-01..03); ученик видит снимок `published_version_id` (REQ-TCH-PUB-05); предпросмотр (API-T-15) и ученик рендерятся одним построителем урока. Выдача, отзыв, флаг каталога, публикация и снятие — в `audit_log` (REQ-NFR-SEC-05).
- **Файлы** (7.8, SM-FILE): лимиты BR-FILE-01/02 — до выдачи ссылки (413/422) и повторно после загрузки по фактическому размеру и сигнатуре; загрузка — напрямую в S3 по подписанной ссылке; событие `file.scan` через outbox → worker: структура ZIP (vbaProject.bin, vbaData.xml, Basic/), olevba, ClamAV (clamd INSTREAM); отклонённый объект удаляется; ученику и в миниатюрах — только clean, подписанные ссылки на 10 минут (BR-FILE-04). Проверено на настоящих ClamAV 1.5 и olevba: EICAR и DOCX с макросом → «Отклонён», чистые PDF/DOCX → «Готов».
- **ИИ-черновик** (API-T-11): при `ai.mode = mock` — 503 и «ИИ-черновик сейчас недоступен»; для тестов (решение Q-13) — флаг окружения `AI_DRAFT_FIXTURE`, запрещённый в продуктиве.
- **Web**: «Мои курсы» (PH-24), «Новый предмет» (T05), предмет с выдачей классам и темами (T04), редактор темы (T06–T07) в порядке REQ-TCH-TOP-01, блок публикации с предпросмотром «глазами ученика» и историей версий, квиз (T08). RU/KK/EN — в одной форме RHF (REQ-GEN-PREF-05). `SafeMarkdown` (react-markdown + rehype-sanitize, без сырого HTML). CSP: источник S3 для загрузки и файлов, https-картинки для внешних обложек. Чужие страницы → 404.
- **Тесты**: integration — content (23), files на MinIO (10), ИИ-черновик (2), генерируемый тест прав расширен на предметы, темы, вопросы; worker file-scan (8); web — SafeMarkdown/XSS (9), CSP; e2e teacher-content (8 сценариев × 2 ширины). Итого: unit/integration — все пакеты зелёные (api 167), e2e — 274 passed.
- **CI**: MinIO для e2e (ключ MinIO — не короче 3 символов; первая попытка упала именно на этом).
- **Скриншоты**: `docs/media/iteration7/` (скрипт `e2e/scripts/teacher-shots.mjs`).

### Доработки после приёмки (2026-10-16)
- ИИ-черновик заполняет и название на языке черновика (RU и KK); учитель может его поправить.
- «Интересный факт» — в API-S-06 и в «Посмотреть глазами ученика»: карточка после описания, перед текстом урока (на странице ученика в итерации 8 — так же); API-S-06 отдаёт и `materials` (только clean).
- Обложка по ссылке (BR-FILE-06): при сохранении сервер скачивает картинку в своё хранилище и проверяет как загруженную (тип, ≤ 5 МБ, сигнатура, затем ClamAV); ученику — только файл из хранилища. Защита от SSRF: http/https, порты 80/443, только публичные адреса после DNS, соединение на проверенный адрес, перенаправления проверяются заново, таймаут 10 с, лимит 5 МБ. Ошибка скачивания — у поля ссылки. Из CSP убраны внешние картинки.
- Незавершённые загрузки (BR-FILE-07): worker раз в сутки удаляет неподтверждённые записи «pending» старше 24 часов и их объект.
- `/teacher/subjects/:id/topics/new` ведёт на страницу предмета, TODO снят; `S3_PUBLIC_ENDPOINT` — в разделе 2.3 SPEC и `.env.example`. SPEC обновлён (журнал раздела 16).
- Тесты: SSRF и проверки картинки (15), обложка по ссылке на MinIO, очистка загрузок в worker, e2e — название от ИИ, карточка факта и порядок блоков, ошибка для внутренней ссылки.

---

## Итерация 8 — Интерфейс ученика: обучение

**Цель:** каталог, урок, квиз, события, mastery, XP, бейджи. AC-ST-01..05.

### Задачи
1. **Каталог**: API-S-04/05 UI — `/learn/subjects` (REQ-ST-CAT-02: 3 колонки, вся карточка кликабельна, пользовательские названия не переводятся), `/learn/sections/:id` (REQ-ST-CAT-03); главная ученика — «Продолжить учёбу →» (REQ-ST-HOME-01, PH-34).
2. **Урок** `/learn/topics/:id?tab=overview|quiz|ai` (REQ-ST-LES-01..05): ученик видит снимок `published_version_id`; хлебные крошки, «Тема N», «K вопросов», вкладки через `?tab` (shallow routing), аккордеон разделов (все свёрнуты, мульти — PH-36), Markdown для авторских тем, карточка «СЛЕДУЮЩАЯ» (по position, без блокировки — PH-35); API-S-17 `lesson_opened` с ключом `lesson:{topicId}:{date}`.
3. **Квиз**: API-S-07 (новая или продолжение `in_progress`, `topic_version_id`, без правильных ответов), API-S-08 (немедленная проверка, нормализация text_input — BR-QZ-03), API-S-09 (score BR-QZ-05, best → `topic_mastery`, mastered ≥ 80, событие `quiz_finished`); UI REQ-ST-QZ-01..02 (маркеры, сложность, A–D, «Далее», «Результат», XP и бейджи, «Пройти ещё раз»).
4. **Геймификация** (`gamification`): обработчик событий → `xp_ledger` (идемпотентность по `(student_id, source_event_id, reason)`), уровень/ранг BR-XP-03, серия BR-ST-02/03 в PLATFORM_TZ, движок правил бейджей BR-BDG-01 (12 правил из `rule jsonb`), `student_badges` один раз. Выполнение — синхронно в транзакции finish (для ответа `xpAwarded/badgesAwarded`) + worker `recalc` для пересчёта (см. Q-17).
5. **Worker**: `abandoned` попытки после 30 дней без активности (SM-ATTEMPT).
6. Хедер ученика — живые серия/XP.

### Покрываемые требования
API-S-04..09, -16, -17; REQ-ST-HOME-01; REQ-ST-CAT-02..03; REQ-ST-LES-01..05; REQ-ST-QZ-01..02; BR-QZ-01, -03..-08; BR-XP-01..03; BR-BDG-01..02; BR-ST-01..03; SM-ATTEMPT; BR-ACL-03; BR-CLS-03 (проверка через каталог).
AC: AC-ST-01..05, AC-GEN-02 (полностью), AC-AUTH-04 (полностью).

**Дополнительно (решение владельца 2026-10-14):** в блоке пробного вопроса ссылка «Перейти к предмету» для вошедшего ученика ведёт на страницу предмета ученика (для гостя остаётся `/subjects`).

### Проверка
- Playwright: переключение вкладок и языка — меняется `?tab`, тема и прогресс те же (AC-ST-01, AC-GEN-02); ответ → сразу результат, в предыдущих сетевых ответах нет правильного ответа (AC-ST-02); уход/возврат — продолжение с того же вопроса (AC-ST-03).
- Integration: finish с 85 % → +20 XP, mastered, бейджи «Первый шаг» и «Тема освоена» (AC-ST-04); повторная обработка того же события → без повторного начисления (AC-ST-05); черновая тема и тема класса после leave → 404.
- Unit: нормализация text_input, формула уровня, серия на границах суток UTC+5, каждое из 12 правил бейджей.

### Итог (2026-10-16)
- **API**: API-S-04 (каталог), API-S-05 (раздел), страница предмета ученика `GET /api/student/subjects/:id` (решение владельца 2026-10-14; в SPEC нет — вопрос), API-S-06 (+ `quizId`, `funFact`, `materials`), API-S-07..09, API-S-17, API-S-16 (+ «живая» серия и `continueTopicId`), API-PUB-02 (+ `subjectId`). Видимость — только `VisibilityService` (BR-VIS-01): общий каталог или предмет выдан действующему классу; темы — опубликованные, снимок версии. Невидимое → 404; чужая попытка → 404 до разбора тела (BR-ACL-03).
- **Квиз** (SM-ATTEMPT, 7.2): без правильных ответов до ответа (BR-QZ-01), проверка сразу (BR-QZ-04), нормализация вписанного ответа (BR-QZ-03), балл BR-QZ-05, лучший результат и освоение ≥ 80 (BR-QZ-06/07, PH-38), связь с версией (BR-QZ-08), продолжение незавершённой попытки; вопросы — текущие неархивированные (Q-17).
- **Геймификация**: XP через `xp_ledger` — повторная обработка не начисляет (BR-XP-01/02, AC-ST-05); уровень BR-XP-03; серия BR-ST-02/03 в PLATFORM_TZ; 12 правил бейджей BR-BDG-01, каждый один раз. Начисление — синхронно в транзакции finish и lesson_opened; очередь `recalc` осталась заготовкой (не понадобилась: серия в хедере считается по дате последней активности).
- **Worker**: брошенные попытки (30 дней без активности → abandoned), раз в сутки.
- **Web**: «Предметы платформы», раздел, страница предмета, урок (крошки, «Тема N», «K вопросов», вкладки `?tab` без перезагрузки, «Обзор» — тот же компонент, что «Посмотреть глазами ученика», с карточкой «Интересный факт»; материалы — только проверенные; «Следующая»), квиз (маркеры, сложность, A–D, результат сразу, «Далее», «Результат», XP и бейджи, «Пройти ещё раз»), «Продолжить учёбу →», «Перейти к предмету» для ученика, живые серия и XP в хедере. Вкладка «Syntara AI» — заглушка PH-19 до итерации 9.
- **Тесты**: integration learning (10), unit правил (19), worker; e2e learning — сквозной сценарий (учитель создаёт предмет → выдаёт классу → публикует тему с квизом → ученик класса находит её в каталоге, проходит квиз и получает XP; ученик другого класса — 404; гость — вход/401; снятие с публикации и отзыв доступа скрывают тему), AC-ST-01..03, AC-GEN-02, каталог и главная; axe и 320 px. Итого: api 193, worker 23, shared 66, e2e 284.
- **Скриншоты**: `docs/media/iteration8/` (скрипт `e2e/scripts/student-shots.mjs`).

### Доработки после приёмки (2026-10-16)
- Страница предмета ученика — в SPEC (API-S-18, REQ-ST-CAT-04); у каждой темы статус «Освоена» / «Начата» / «Не начата».
- `quizId`, `subjectId`, `correctAnswer`, `continueTopicId` — в SPEC (6.2, 6.5).
- Квиз с клавиатуры: стрелки только перемещают выбор, ответ — Enter, пробел или «Ответить»; клик мышью отвечает сразу. Проверено e2e с клавиатуры и axe (axe нашёл недостаточный контраст зелёного текста — добавлен токен `--success-text`).
- Результат квиза: целые проценты, «N из M правильно», «Тема освоена!» / «Тема освоена при 80 % — попробуй ещё раз».
- Шапки: на публичных страницах у вошедшего — «Кабинет» его роли; в хедере кабинета роль один раз (в выборе роли).
- Очередь `recalc` удалена; Q-17 решён — начисление синхронно (BR-XP-04).
- Тесты: e2e — 288 passed; api, worker, shared — зелёные.

---

## Этап 8.6 — Базовая программа платформы

**Когда:** после итерации 8, **перед** итерацией 8.5 (решение владельца 2026-10-16). Начат по команде владельца 2026-10-16.

**Цель:** у платформы базовая программа — школьные предметы каталога (биология, химия, физика, география, математика, алгебра, геометрия, информатика, история Казахстана, казахский / русский / английский языки). Базовые уроки заполнены текстом, картинками и квизом и доступны всем ученикам, «Обзор» — и гостю. Учителя дополнительно добавляют свои личные уроки (есть с итерации 7).

**Главное правило (решение владельца):** базовые уроки через сайт не меняет никто — ни учитель, ни администратор. Они создаются и меняются только файлами `content/` и командой импорта (выполняет разработчик по решению владельца). Роли «Методист» нет. Деления на классы (годы обучения) нет — 1.3 SPEC в силе.

### Задачи
1. **SPEC и PLAN** — решения владельца: матрица 1.2, маршруты 4, схема 5.4, API-PUB-10..13, BR-VIS-04, BR-ACL-05, BR-CNT-01..08, AC-CNT-01..07, PH-01, журнал 16.
2. **Миграция**: постоянные коды `code` у предметов, тем, разделов тем и вопросов (UNIQUE; у контента учителей — NULL); `topic_translations.needs_review`.
3. **Формат и импорт**: `content/<раздел>/<предмет>/<тема>/{ru.md, kk.md, en.md, quiz.yaml, media/}` — Markdown с YAML-заголовком; `pnpm content:check` (проверка, в CI) и `pnpm content:import` (`--dry-run`). Проверка всех файлов до записи; любая ошибка — ничего не меняется. Идемпотентность по кодам; изменённый файл — новая опубликованная версия; удалённая тема — снята с публикации; автор версий — системный пользователь «Импорт»; запуск — в журнале аудита.
4. **Картинки**: только `media/`, WEBP/PNG/JPG, ≤ 300 КБ, источник и лицензия (own, CC0, public-domain) в YAML; хранение в нашем хранилище, проверка типа и сигнатуры (BR-FILE-01).
5. **Языки**: RU обязателен; KK и EN — необязательны, пометка «На проверке» до вычитки; нет языка — RU с пометкой «Урок пока доступен на русском».
6. **Гость**: каталог и «Обзор» базовых уроков без входа (API-PUB-10..13, гостевой доступ к `/learn/...`); на «Квиз» и «Syntara AI» — «Войди или зарегистрируйся, чтобы пройти квиз». Личные уроки учителей гостю не видны.
7. **«Скоро»**: предмет без опубликованных тем — «Скоро», карточка не кликабельна (каталог ученика и гостя, /subjects); PH-01 — все базовые предметы каталога.
8. **Демо-наполнение**: seed-заглушки «Анатомии человека» и «Общей биологии» заменены импортом `content/`; «Анатомия человека» наполнена полностью (≥ 3 темы; «Сердечно-сосудистая система» — 5 разделов аккордеона, описание, интересный факт, 3–5 вопросов); остальные предметы — описание, статус «Скоро». Тексты — оригинальные; иллюстрации — собственные SVG-схемы (в PNG/WEBP).
9. **Защита**: тест — учитель и любая другая роль получают 404/401/403 при попытке изменить базовый предмет, тему, вопрос или файл.
10. **`docs/CONTENT_GUIDE.md`**: формат с полным примером, правила картинок, команды — для массовой подготовки уроков, в том числе с помощью ИИ.
11. **Проверка**: lint, typecheck, тесты, e2e (гость читает обзор и не видит квиз; ученик проходит квиз базового урока и получает XP; учитель не может изменить базовый урок; повторный импорт не дублирует; изменённый файл даёт новую версию; файл с ошибкой — ничего не меняется), зелёный CI, скриншоты `docs/media/iteration8.6/`.

### Не делаем (решения владельца)
- Роль «Методист» и аккаунты методистов.
- Разделы аккордеона в редакторе учителя — TODO(OWNER) на будущее.
- Кто готовит весь контент — решение владельца позже (TODO(OWNER)).

### Итог (2026-10-16) — выполнено, ждёт приёмки
- **SPEC:** матрица 1.2, маршруты 4, 5.4 (коды, `needs_review`), API-PUB-01 и API-PUB-10..13, API-S-04/05/06, BR-ACL-05, BR-VIS-04, BR-CNT-01..08 (7.11), REQ-PUB-SUBJ-02, REQ-ST-CAT-02, REQ-ST-LES-06/07, PH-01, AC-CNT-01..07, журнал 16.
- **БД:** миграция `0005_base_content` (откат проверен тестом).
- **Импорт:** `packages/db/src/content/` — разбор и проверка (`pnpm content:check`, шаг CI «Content check»), запись в одной транзакции по кодам (`pnpm content:import [--dry-run]`), картинки в S3 по sha256, системный пользователь «Импорт», журнал аудита; seed `demo` = справочники + импорт `content/`.
- **Контент:** 5 разделов, 13 базовых предметов (12 — «Скоро»); «Анатомия человека» — 3 темы («Сердечно-сосудистая система» — 5 разделов RU/KK, 6 в EN, факт, 5 вопросов, в т. ч. пробный PH-02; «Дыхательная система»; «Пищеварительная система»), RU/KK/EN, 6 собственных схем (`scripts/content-art/*.svg` → PNG 13–41 КБ).
- **API:** гость читает каталог и «Обзор» базовых уроков; «Скоро»; PH-01 — все базовые предметы; пометки языка; иллюстрации разделов.
- **Web:** гость на `/learn/subjects|sections|subjects/:id|topics/:id` в публичной оболочке; на «Квиз» и «Syntara AI» — «Войди или зарегистрируйся, чтобы пройти квиз» и «Войти»; карточки «Скоро» без ссылки; «На проверке», «Урок пока доступен на русском».
- **Документ:** `docs/CONTENT_GUIDE.md`.
- **Тесты:** db 44 (импорт: 6 integration, проверка формата: 8), api 199 (новые: base-content — гость, квиз ученика с XP, защита базового контента от учителя и других ролей), web 22, shared 66, worker 23, ui 8; e2e 297 (новый base-content.spec — гость, пометки языка, квиз с XP, учитель, импорт через CLI: повтор, изменение, ошибка). CI зелёный.
- **Скриншоты:** `docs/media/iteration8.6/` (скрипт `e2e/scripts/base-content-shots.mjs`).
- **Отступления от эталонов (seed `visual`):** U03 «11 систем организма», U04/U05 «9 вопросов», U08 «из 41 темы», U13 «Chemistry — Available» больше не воспроизводятся — базовые уроки теперь только из `content/` (3 темы, 5 вопросов, «Химия» — «Скоро»).

### Доработки после приёмки (2026-10-17) — выполнено
- **Главная (REQ-PUB-HOME-06):** не больше 6 карточек, открытые первыми (порядок API-PUB-01), под ними — «Все предметы →» на /subjects.
- **«Химия»** — в разделе «Естественные науки» (Химия · Физика · География); `content/_root/` и поддержка предметов вне разделов в формате убраны. Отступление от U13 — в журнале SPEC 16.
- **Порядок предметов:** миграция `0006_subject_position` (`subjects.position`, у предметов учителей NULL, CHECK; откат проверен тестом); `position` в `subject.yaml` обязателен и уникален в разделе; каталог ученика и гостя — по `position`, API-PUB-01 — открытые первыми, внутри группы порядок `content/`. У разделов `catalog_sections.position` уже был.
- **Гость на «Syntara AI»:** «Войди или зарегистрируйся, чтобы задать вопрос Syntara AI». «На проверке», «Урок пока доступен на русском», общая 404 для учителя на базовом предмете, вписанный ответ только для чисел — подтверждены владельцем.
- **Иллюстрации разделов:** 336 px на десктопе (токен `--illustration-w`), по ширине экрана на мобильном.
- **e2e:** перед axe ждём окончания переходов (axe мерил контраст вкладки посреди смены цвета — нестабильно на 320 px).
- **Тесты:** db 46, api 199, e2e 297 — зелёные.

---

## Итерация 9 — Учебный ИИ

**Цель:** диалоги, SSE, отмена, быстрые действия, `/learn/assistant`. AC-ST-06..07.

### Задачи
1. API-S-11 (создание диалога; `topic_tutor` требует видимости темы BR-VIS-01), API-S-12 (SSE, сохранение сообщения пользователя и ответа, SM-AI-MESSAGE: complete/partial/failed; отмена → `partial` + «Ответ прерван»), API-S-13 (история, только свои — BR-ACL-03); лимиты PH-20; событие `ai_question`.
2. Промпт BR-AI-02: системная инструкция + текст текущей темы (снимок версии) + уровень `beginner` + последние 20 сообщений, без ПД; быстрые действия PH-21 (`simpler`, `more_detail`, `check_me`); никаких инструментов с записью (BR-AI-03).
3. Санитизация вывода (rehype-sanitize на клиенте + серверная очистка ссылок).
4. UI: вкладка «Syntara AI» урока (REQ-ST-AI-01..02), `/learn/assistant` (REQ-ST-AI-03, `general_tutor`, модальное окно «Как это работает»); режим mock → «Учебный ИИ скоро будет доступен» (PH-19).

### Покрываемые требования
API-S-11..13; REQ-ST-AI-01..04; BR-AI-01..06; SM-AI-MESSAGE; PH-19..21; REQ-NFR-SEC-06 (ИИ).
AC: AC-ST-06..07.

### Проверка
- Playwright (провайдер-заглушка со стримом): «Остановить» → сообщение сохранено `partial`, «Ответ прерван» после перезагрузки (AC-ST-06).
- Integration: ответ модели со ссылкой и `<script>` → скрипт удалён, внешняя ссылка удалена, число строк в учебных таблицах не изменилось (AC-ST-07); чужой диалог → 404; диалог по невидимой теме → 404; промпт без ПД.

**Дополнительно (решение владельца 2026-10-17):** контекст ИИ для базовых уроков — описание, интересный факт и все разделы аккордеона опубликованной версии на языке ученика (нет языка — RU); mock по умолчанию + адаптер реальной модели (выбор и ключ — переменные окружения; модель — Q-11); ИИ не решает за ученика (в BR-AI не было — предложена формулировка BR-AI-08, TODO(OWNER)); ключ API не попадает в git и журналы.

### Итог (2026-10-17) — выполнено, ждёт приёмки
- **API** (модуль ai, `TutorModule`): API-S-11 (один действующий диалог на тему и один общий — история видна после перезагрузки; `topic_tutor` только по видимой теме), API-S-12 (SSE; вопрос и событие `ai_question` — сразу, без XP и вне серии; ответ — complete / partial при отмене / failed; mock → `AI_UNAVAILABLE` и PH-19), API-S-13 (история). Чужой диалог → 404 (guard владения `conversation`). Лимиты PH-20 — на ученика, не на IP. Санитизация ответа — как у публичного помощника.
- **Промпт** (BR-AI-02/09): системная инструкция, уровень beginner, текст темы из опубликованного снимка на языке ученика (RU, если перевода нет), тексты вопросов квиза **без** вариантов, ответов и объяснений, последние 20 сообщений; email/телефоны вырезаются, имени, логина и ID ученика нет. BR-AI-08 (предложение): не даёт готовых ответов на вопросы квиза темы, объясняет и подсказывает; «Проверь меня» — свои вопросы.
- **Реальная модель:** адаптер Vercel AI SDK (`ai` 7.0.126, `@ai-sdk/anthropic`, `@ai-sdk/openai-compatible`) за `LLMProvider`; `LLM_PROVIDER` / `LLM_API_KEY` / `LLM_MODEL` / `LLM_BASE_URL` (новая); при реальном поставщике ключ и модель обязательны. Найдено и закрыто: SDK по умолчанию печатает ошибку поставщика в консоль целиком (ответ может содержать ключ) — вывод отключён, ключ вырезается из текста ошибки; тест с локальным «поставщиком», возвращающим ключ. По умолчанию — mock.
- **Web:** вкладка «Syntara AI» урока (U06–U07) и `/learn/assistant` (U02) с модальным окном «Как это работает»; компоненты чата — в `packages/ui` (`ChatLog`, `ChatMessage`, `ChatAvatar`, `StatusDot`, `Textarea compact`), без одноразовых стилей; чат — динамический импорт.
- **Тесты:** api 219 (tutor — 12, адаптер — 4, env, промпт), ui 9, shared 68, db 46, web 22, worker 23; e2e 305 (tutor.spec — 8 сценариев × 2 ширины: поток, очистка ссылок, «Остановить» → «Ответ прерван» после перезагрузки, /learn/assistant, клавиатура, axe, 320 px). В e2e — детерминированный поток `AI_TUTOR_FIXTURE` (в продуктиве запрещён).
- **Скриншоты:** `docs/media/iteration9/` (скрипт `e2e/scripts/tutor-shots.mjs`, `--mock` — режим PH-19).

---

## Итерация 10 — Задания, показатели, аналитика

**Цель:** назначения, «Мои задания», `/learn/progress`, `/learn/achievements`, аналитика класса. AC-TCH-08..09, AC-ST-08..09.

### Задачи
1. **Задания учителя**: API-T-22 (BR-ASG-01, триггер из итерации 2), API-T-23 (счётчики BR-ASG-03), API-T-24 (пустая очередь, PH-29); `/teacher/assignments` (REQ-TCH-ASG-01..03; фильтр тем по предмету и сброс — BR-ASG-02; дата/время PH-31 в PLATFORM_TZ).
2. **Мои задания ученика**: API-S-10, `/learn/assignments` (REQ-ST-ASG-01: статусы, «Срок прошёл»); старт попытки с `assignment_id` (см. Q-18); при finish — upsert `submission` `graded` с лучшим `grade` (SM-SUBMISSION).
3. **Показатели**: API-S-14 (периоды BR-ST-04, compareRange, progress BR-ST-05, streak, nextStep BR-ST-06); `/learn/progress` (REQ-ST-PRG-01..04, модальные окна с правилами).
4. **Достижения**: API-S-15; `/learn/achievements` (REQ-ST-ACH-01..02, 4 колонки, «ЗАКРЫТО»).
5. **Аналитика класса**: API-T-25 (BR-AN-01..05, пороги PH-30), API-T-26 ростер (минимальный список учеников, PH-24); `/teacher/classes/:id/{roster,mastery,analytics}` (REQ-TCH-AN-01..04; «Карта освоения» — заглушка PH-24).
6. Аудит оценок (REQ-NFR-SEC-05).

### Покрываемые требования
API-T-22..26; API-S-10, -14, -15; BR-ASG-01..03; SM-SUBMISSION; BR-ST-01..06; BR-AN-01..05; REQ-TCH-ASG-01..03; REQ-TCH-AN-01..04; REQ-ST-PRG-01..04; REQ-ST-ACH-01..02; REQ-ST-ASG-01; REQ-NFR-SEC-04 (финальный набор маршрутов).
AC: AC-TCH-08..09, AC-ST-08..09.

### Проверка
- Playwright: учитель назначает → ученик видит в «Мои задания», проходит квиз → счётчики «Сдано/Оценено» у учителя обновлены (AC-TCH-08); смена периода «7 дней» → даты, сравнение, прогресс и серия пересчитаны (AC-ST-08).
- Integration: аналитика на фиксированных данных совпадает с формулами BR-AN-*, цвета по порогам, ученик без событий 7 дней в «Требуют внимания» (AC-TCH-09); ученик A с ID объектов ученика B → 404 на всех `/api/student/*` (AC-ST-09, генерируемый тест).
- Unit: расчёт периодов (today/7d/30d/90d/quarter/year, границы суток UTC+5), nextStep по приоритетам, цвета weakTopics.

**Дополнительно (решение владельца 2026-10-17):** показатели и аналитика учитывают и базовые уроки платформы, и личные уроки учителей; новые экраны — только из компонентов и токенов `packages/ui`, без React Bits.

### Итог (2026-10-17) — выполнено, ждёт приёмки
- **Перед итерацией — решения по итерации 9:** `docs/AI_PROVIDER.md` (смена поставщика только переменными окружения для openai-compatible / anthropic; свой формат — адаптер `LLMProvider` и три места подключения; хранение данных в РК — обязательный критерий); BR-AI-08 подтверждено; абзац U02 не выводится; лимиты на ученика и поведение mock — в SPEC.
- **API:** API-T-22 (класс свой; предмет базовый или свой, выданный классу; тема — опубликованная тема предмета; аудит), API-T-23, API-T-24 (пусто, PH-29), новая API-T-28 (что можно назначить классу), API-S-07 `assignmentId` (Q-18), сдача BR-ASG-03 / SM-SUBMISSION (лучшая оценка, аудит `submission.graded`), API-S-10, API-T-25 (BR-AN-01..05, PH-30), API-S-14 (BR-ST-01..06, PH-38), API-S-15. Схема не менялась.
- **Web:** `/teacher/assignments` (T09), `/teacher/classes/:id/{roster,mastery,analytics}` (T10, «Карта освоения» — PH-24) и ссылка из списка классов, `/learn/assignments`, `/learn/progress` (U08), `/learn/achievements` (U10); квиз из задания. В `packages/ui`: `NavTabs`, тон `Card` и `ProgressBar`, читаемый красный `Badge` (axe нашёл белый на красном).
- **Тесты:** shared 74 (правила периодов и цветов), api 227 (results.int — 8 сценариев: назначение и отказы, сдача и счётчики, чужое назначение → 404, аналитика на фиксированных данных, показатели, nextStep, достижения, OpenAPI; генерируемый тест прав покрывает новые маршруты), ui 9; e2e 313 (assignments-progress.spec — 4 сценария × 2 ширины; accounts.spec обновлён). CI зелёный.
- **Скриншоты:** `docs/media/iteration10/` (скрипт `e2e/scripts/assignments-shots.mjs`).

### Доработки после приёмки (2026-10-17) — выполнено
- **Четверти (Q-23):** даты 2026–2027 и учебный год 01.09–25.05 — в `app_config` (PH-38, seed), меняются без кода; на каникулах «Четверть» показывает последнюю начавшуюся. TODO(OWNER): сверить начало и конец с приказом Минпросвещения. Найдено при проверке в браузере и исправлено: у незакончившихся периодов (четверть, год) серия и прогресс считались на будущий конец периода — теперь на сегодня (тест).
- **BR-ASG-03:** квиз из урока, завершённый после выдачи задания, тоже засчитывается сдачей (лучший результат); попытки до выдачи — нет; после срока — «Сдано после срока» (`late` в API-S-10; SPEC сдачу после срока не запрещает).
- **«Карта освоения»** вместо заглушки PH-24: таблица «ученики × темы» базового или своего выданного предмета, цвет и подпись статуса с процентом, фильтр по предмету, горизонтальная прокрутка на мобильном с закреплённым столбцом учеников (новая API-T-29, `Table` в `packages/ui`).
- **«Мои показатели»:** подзаголовок и блок «Начни отсюда» с эталона U08 (в SPEC и `needs_confirmation.json`).
- Подтверждены: назначение только опубликованных тем и своего предмета, выданного классу; толкование BR-ST-05.
- **e2e:** axe ждёт `<title>` после клиентского перехода (нестабильная проверка document-title). Тесты: api 230, e2e 313. Скриншоты: `m-01…m-04` (карта освоения), `q-01`, `q-02` (четверть, учебный год), `l-01` (сдано после срока) — скрипт `e2e/scripts/acceptance10-shots.mjs`.

---

## Итерация 8.5 — Улучшение UI/UX

**Когда:** после итерации 10, перед итерацией 11 (решение владельца 2026-10-17: сначала весь функционал, дизайн — в конце; порядок: доработки 8.6 → 9 → 10 → 8.5 → 11). Новых функций не добавляет — только качество интерфейса.

**До 8.5:** React Bits не подключается; новые экраны итераций 9–10 строятся только из готовых компонентов и токенов `packages/ui`, без своих одноразовых стилей — чтобы дизайн в 8.5 менялся в одном месте.

### Задачи
1. Плавные переходы между страницами и состояниями: появление, раскрытие, смена вкладок.
2. Микроанимации кнопок, карточек, ссылок и полей: hover, focus, нажатие.
3. Плавное появление блоков при прокрутке.
4. Скелетоны при загрузке данных вместо пустых областей.
5. Компоненты React Bits (https://reactbits.dev) там, где уместно.
   Выбор — через страницу-витрину `/ru/dev/ui` (только в разработке): на ней кандидаты показаны рядом, подключаются только выбранные владельцем. Кандидаты (решение владельца 2026-10-17):
   - шапка: Pill Nav / Gooey Nav / Card Nav;
   - заголовок главной: Split Text / Blur Text / Rotating Text / Gradient Text / Shiny Text;
   - появление блоков: Animated Content / Fade Content / Scroll Reveal;
   - карточки: Spotlight Card / Tilted Card / Pixel Card / Magic Bento;
   - XP и результат: Count Up / Counter;
   - фон главной: Aurora / Particles / Squares / Dot Grid / Waves;
   - дополнительно: Click Spark (правильный ответ), Star Border (главная кнопка), Stepper (прогресс квиза);
   - а также: иконки карточек базовых предметов, анимация аккордеона и переходов.
6. Проверка визуальной целостности и отступов на всех экранах.

### Условия
- Все анимации отключаются при «Экономии трафика» (`data-data-saver`) и `prefers-reduced-motion` (REQ-GEN-PREF-04, REQ-NFR-A11Y-01).
- Доступность сохраняется: axe без нарушений serious/critical, клавиатура и видимый фокус.
- Бюджет главной — ≤ 500 КБ сжатых ресурсов при первой загрузке (REQ-NFR-PERF-01); тяжёлые компоненты — динамическим импортом.

### Проверка
- Playwright: при `prefers-reduced-motion: reduce` и при включённой «Экономии трафика» анимации и переходы отключены (нулевая длительность); axe на всех страницах в обеих темах.
- Бюджет главной в e2e не превышен; визуальные снимки ключевых экранов на 320, 768 и 1440 px без наложений и горизонтальной прокрутки.

---

## Итерация 11 — Качество и выпуск

**Цель:** все AC; REQ-NFR-*; отчёт `config:report`.

### Задачи
1. **Визуальные тесты** (AC-VIS-01): seed `visual`, Playwright на 1348×926 (U03 — 1363×936); сравнение с эталонами `docs/media/*` через pixelmatch с порогом (собственный матчер, т. к. эталоны — JPEG вне Playwright-снимков) + отчёт diff; итоговое сравнение — ручное.
2. **Доступность**: axe на всех маршрутах раздела 4 в обеих темах и на ширинах 320/390/768/1440; проверка `prefers-reduced-motion`, масштаба 200 %; чек-лист ручной проверки NVDA/VoiceOver.
3. **Совместимость** (REQ-NFR-COMP-01): Playwright projects Chromium, WebKit, Firefox, mobile Safari/Chrome эмуляция.
4. **Производительность**: Lighthouse CI (REQ-NFR-PERF-01/02), k6 сценарии чтения/сохранения/ИИ (REQ-NFR-PERF-03), нагрузка 2 000 × 2 сессий (REQ-NFR-PERF-04, PH-41).
5. **Безопасность**: полный прогон SEC-01..07, XSS-набор, проверка логов на отсутствие ПД, зависимостей (`pnpm audit`), секреты не попадают в клиентский бандл (поиск по `.next`).
6. **Эксплуатация**: worker `cleanup` по срокам PH-18 (REQ-NFR-DATA-02) с integration-тестом; pgBackRest + WAL, протокол восстановления (REQ-NFR-OPS-01); Grafana-дашборды и алерты (REQ-NFR-OBS-01); чек-лист размещения в РК (REQ-NFR-DATA-01, PH-16) и ПД (REQ-NFR-DATA-03, ручн.).
7. **`pnpm config:report`**: все ключи `needs_confirmation=true`; `prodBlocked` (PH-09, PH-14) валят продуктивную сборку.
8. Сводная матрица трассировки REQ/BR/AC → тесты (`docs/TRACEABILITY.md`, генерируется из названий тестов).

### Покрываемые требования
AC-VIS-01 и регресс всех AC; REQ-NFR-SEC-01..07, DATA-01..03, PERF-01..04, A11Y-01, I18N-01, COMP-01, OBS-01, OPS-01.

### Проверка
Все автотесты зелёные во всех браузерах; Lighthouse/k6 в бюджете; протокол восстановления из бэкапа; отчёт `config:report` передан владельцу.

---

## Q. Вопросы и неясности

### Решения владельца (2026-10-13)

| Вопрос | Решение |
|---|---|
| Q-01 | Согласовано: вход, сессии, CSRF и роли переносятся в итерацию 4. |
| Q-03 | Docker Desktop (WSL) установлен; pnpm — через corepack. |
| Q-04 | `git init`; CI — GitHub Actions. |
| Q-07 | Полные подготовленные переводы kk.json и en.json делает агент (это не машинный перевод во время работы, REQ-GEN-PREF-02 не нарушается). EN-тексты из SPEC (U13, U09) — как есть. Все KK-переводы — `needs_review` (проверит носитель). В переключателе включены все три языка (PH-04 = ru, kk, en). |
| Q-15 | Согласовано: `user_roles.id` + `UNIQUE NULLS NOT DISTINCT (user_id, role, school_id)`; SPEC 5.3 обновлён. |
| Q-16 | Ученик регистрируется только по действующему коду класса: на /join после проверки кода — имя, логин, пароль (email необязателен). Без кода — невозможно. Добавлено в SPEC как PH-44 («требует уточнения»); реализация — итерация 6. |
| Q-02, Q-05, Q-06, Q-08..Q-14, Q-17..Q-27 | Принимаются варианты по умолчанию, описанные ниже. Недостающие тексты — заглушки с пометкой `needs_confirmation`. |
| Итерация 3 (2026-10-14) | Принята. Тексты `needs_confirmation.json` и KK-переводы приняты, вычитка — позже. Q-22 подтверждён. Иконки предметов и цвета `--accent-strong` #1E63E4 / `--accent` #1765E8 приняты. Скриншотов S01–S26 нет — вёрстка по тексту SPEC. |
| Q-10 (2026-10-14) | Для разработки — Mailpit; входящие письма (API-SUP-08) выключены флагом `support.inbound_email`; реальный почтовый сервис — перед запуском. |
| Итерация 4 (2026-10-14) | Принята. `--danger-text` и цвета бейджей приняты; 111 текстов `needs_confirmation` приняты. Ответ по шаблону «Уточнение» → waiting_user, «Решение» → resolved (SPEC обновлён). Срок первого ответа — по рабочим часам PH-22. Подпись вебхука — после выбора почтового сервиса (TODO). Временная ссылка «Забыли пароль?» и `RATE_LIMITS_DISABLED` для e2e приняты. |
| Q-11 (2026-10-14) | Пока mock-провайдер с ответами PH-19; реальная модель — позже. |
| Итерация 6 (2026-10-14) | Принята с исправлением: ограничение «ученик только по коду класса» (PH-17, BR-CLS-04, Q-16) отменено — самостоятельная регистрация ученика по эталону `media/student-auth.png` (код класса и email необязательны, школа — из справочника или вручную «не проверена»), «Email или логин» в REQ-GEN-AUTH-01, формат логина принят, согласие родителя — TODO(OWNER), восстановление без email — временный пароль от учителя (роль «завуч» — TODO(OWNER)), подтверждение email учителя — миграция, вход до подтверждения, напоминание в кабинете; «Мои данные» без email и значки боковой панели приняты; тексты `needs_confirmation` пока остаются. К ученику — на «ты». |
| Итерация 5 (2026-10-14) | Принята. `hasAnother` в API-PUB-02 принят (SPEC обновлён). «Перейти к предмету» → /subjects для гостя; для вошедшего ученика — страница предмета (итерация 8). 11 текстов `needs_confirmation` приняты. Нестабильный тест worker: исправить по причине после следующего падения; если за 2 попытки не выйдет — пропускать только в CI с TODO до итерации 11. Добавлена итерация 8.5 «Улучшение UI/UX». |
| Итерация 7 (2026-10-16) | Принята с доработками (выполнены): без отдельного экрана «Новая тема»; `materials` и «Интересный факт» в API-S-06 и предпросмотре; ИИ-черновик заполняет название; обложка по ссылке скачивается сервером с защитой от SSRF; `S3_PUBLIC_ENDPOINT` в SPEC; очистка незавершённых загрузок раз в сутки; тексты `needs_confirmation` пока остаются. Итерацию 8 не начинать без команды. |
| Итерация 8 (2026-10-16) | Принята с доработками (выполнены): страница предмета со статусами тем и дополнения API — в SPEC; гость на /learn — вход и 401; квиз с клавиатуры (стрелки — выбор, Enter/пробел/«Ответить» — ответ); пробные вопросы в квизе темы; «Кабинет» в публичной шапке; роль в хедере один раз; результат квиза целыми процентами с «N из M правильно»; очередь recalc удалена — **Q-17 решён: начисление синхронно**. Добавлен этап 8.6 «Базовая программа платформы» перед 8.5. |
| Порядок этапов (2026-10-17) | Сначала весь функционал, дизайн — в конце: доработки 8.6 → итерация 9 → итерация 10 → итерация 8.5 (UI/UX, React Bits) → итерация 11. До 8.5 React Bits не подключается; экраны 9–10 — только из компонентов и токенов `packages/ui`. Кандидаты React Bits — в задачах 8.5, выбор через витрину `/ru/dev/ui`. |
| Этап 8.6 (2026-10-17) | Принят с доработками (выполнены): 6 карточек на главной и «Все предметы →»; «Химия» в «Естественных науках», `_root` убран; `subjects.position` из `content/`; текст приглашения на «Syntara AI»; ширина иллюстраций. Подтверждены: «На проверке», «Урок пока доступен на русском», общая 404 учителю, вписанный ответ только для чисел. |
| Этап 8.6 (2026-10-16) | Начат по команде. Базовые уроки — только файлы `content/` и импорт; «Методиста» нет; деления на классы нет; коды `code` миграцией; источник правды — файлы, идемпотентный импорт, новая версия при изменении, снятие с публикации при удалении, всё-или-ничего; Markdown + YAML, картинки WEBP/PNG/JPG ≤ 300 КБ; RU обязателен, KK/EN — «на проверке»; разделы аккордеона только у базовых уроков; автор — «Импорт», аудит; «Скоро» для пустых предметов, PH-01 — все базовые предметы; гость читает «Обзор»; демо — импорт, «Анатомия человека» полностью; аккаунты методистов не нужны. |

Ниже — исходная формулировка вопросов (для истории): проблема → вариант по умолчанию.

### Окружение и процесс
- **Q-01 [блокер, итерация 4]** Очереди `/staff` (итерация 4) требуют входа, а аутентификация по плану — в итерации 6. *Предлагаю:* перенести в итерацию 4 минимальное ядро (login/logout, сессии, CSRF, guards, `GET /api/me`); регистрацию, сброс пароля и классы оставить в итерации 6.
- **Q-03 [блокер, итерация 1]** На машине не установлены Docker и pnpm (Node 24 есть). `pnpm dev` и Testcontainers без Docker не работают. *Нужно:* установить Docker Desktop (WSL2); pnpm включу через `corepack enable`. ClamAV требует ~1–2 ГБ ОЗУ.
- **Q-04 [блокер, итерация 1]** Проект не является git-репозиторием; CI — GitHub Actions или GitLab CI? Есть ли удалённый репозиторий? *Предлагаю:* `git init` + GitHub Actions.
- **Q-02** Нет скриншотов S01–S26 (`docs/media/public/` пуст), а также U03 и U11. Нужны до итерации 3 для визуального соответствия публичной части; без них верстаю по тексту, визуальные тесты публичной части откладываются.

### Тексты и контент (AG-03 запрещает придумывать)
- **Q-05** Многие публичные блоки описаны только заголовками, без текста: «КОРОТКО» (REQ-PUB-HOME-03), карточки «Журнал/Дневник/Домашняя работа», 6 карточек и «Чем отличается» на /schools, описания блоков /about (миссия, проблема, «Что внутри» и т. д.), краткая справка «?» по страницам. *Предлагаю:* ключи i18n с `TODO(OWNER)` и видимым маркером в dev; нужны итоговые тексты (возможно, есть на S01–S26).
- **Q-06** Тексты правовых документов (13/13/7 разделов, PH-14) не предоставлены. *Предлагаю:* заголовки разделов «Раздел N» + плашка черновика, пока нет текстов.
- **Q-07 [блокер, итерация 1]** Переводы KK/EN. PH-04 включает только `ru`, машинный перевод запрещён, но DoD требует ключи в kk.json/en.json, а эталоны U09/U13 — на EN. *Предлагаю:* в kk/en.json те же ключи с пустыми значениями (fallback на ru), EN-тексты, явно данные в SPEC (U13, U09), — заполнить; KK/EN в меню — «скоро». Подтвердите или передайте переводы.
- **Q-08** Наполнение официального каталога (разделы «Natural sciences», «Exact sciences» и т. д., предмет «Анатомия человека» с 11 системами, 41 тема) в SPEC есть только как seed `visual`. Нет админки для официального контента. Откуда берётся рабочий каталог? *Предлагаю:* seed `demo` + отдельный импорт-скрипт; уточнить источник контента.
- **Q-09** Тексты шаблонов ответов поддержки (`response_templates`: подтверждение, уточнение, решение, задержка) и писем-подтверждений не даны. *Предлагаю:* TODO(OWNER), функция ответа по шаблону работает с ручным текстом.

### Интеграции
- **Q-10** API-SUP-08 (входящие письма): какой почтовый провайдер/формат вебхука (Mailgun, Postmark, SES, свой SMTP-ingest)? *Предлагаю:* адаптерный интерфейс + нейтральный формат под флагом.
- **Q-11** Реальный LLM-провайдер (`openai-compatible` или `anthropic`), модель, и где поставщик размещён с учётом REQ-NFR-DATA-01 (данные в РК)? База знаний публичного помощника кроме PH-19 не описана. *Предлагаю:* реализовать оба адаптера, по умолчанию `mock`; база знаний = тексты платформы из i18n + PH-19.
- **Q-13** AC-TCH-04 ожидает заполненный ИИ-черновик, но в режиме `ai.mode = mock` (PH-19) ИИ «недоступен». *Предлагаю:* в тестах — детерминированный тестовый провайдер, возвращающий черновик; в продуктивном mock — «ИИ-черновик сейчас недоступен».

### Аккаунты
- **Q-12** API-AUTH-03 упоминает письмо подтверждения email, но эндпоинта подтверждения нет и не сказано, может ли учитель работать до подтверждения. *Предлагаю:* `POST /api/auth/verify-email {token}` под флагом; до подтверждения вход разрешён, TODO(OWNER).
- **Q-16 [важно, итерация 6]** Как ученик получает аккаунт? Самостоятельная регистрация выключена (PH-17), «ученики создаются через класс учителя или школой», но в SPEC нет ни эндпоинта, ни экрана создания учеников учителем, ни способа входа child-safe аккаунта без email. Без этого `/join` невозможно пройти в продукте. *Предлагаю:* до решения — ученики только из seed / служебного CLI, функция создания — `TODO(OWNER)` под флагом.
- **Q-19** Как создаются служебные аккаунты (support_agent, onboarding_agent)? *Предлагаю:* CLI-команда `pnpm users:create --role=…`.

### Противоречия и пробелы в SPEC
- **Q-15 [блокер, итерация 2]** `user_roles`: `PRIMARY KEY (user_id, role, school_id)` при nullable `school_id` — в PostgreSQL столбцы PK обязаны быть NOT NULL, т. е. роль без школы станет невозможна. *Предлагаю:* сохранить смысл ограничения — суррогатный `id` PK + `UNIQUE NULLS NOT DISTINCT (user_id, role, school_id)` (PG 15+). Нужно согласие, т. к. это отличие от DDL.
- **Q-17** *(решён 2026-10-16: вопросы — текущие неархивированные; начисление XP и бейджей синхронно, очередь recalc удалена — SPEC BR-XP-04)* Версионирование квиза: `topic_versions.snapshot` — входят ли в снимок вопросы? Попытка привязана к версии (BR-QZ-08), а вопросы редактируются отдельно (API-T-20/21) и не версионируются. *Предлагаю:* ученик всегда получает текущие неархивированные вопросы опубликованной темы; snapshot — только контент темы.
- **Q-18** Старт попытки «с assignment_id» (REQ-ST-ASG-01, BR-ASG-03), но в API-S-07 параметр `assignmentId` отсутствует. *Предлагаю:* необязательное поле `{ assignmentId? }` в теле API-S-07 с проверкой членства.
- **Q-22** API-PUB-01 `status: 'open'` + «Открыть →» для гостя, но по матрице 1.2 каталог и темы гостю недоступны. Куда ведёт `href` у открытого предмета? *Предлагаю:* на `/auth/login?returnTo=/learn/...` — но тогда это совпадает с `login_required`; нужно уточнение.
- **Q-23** Период «Четверть»: `calendar.quarters` пуст (PH-38 `"quarters": []`). Поведение? *Предлагаю:* сегмент неактивен с подсказкой, TODO(OWNER) с датами четвертей. Также ключи в BR-ST-04 (`calendar.quarters`, `calendar.school_year`) не совпадают с PH-38 (`progress.quarters`, `progress.school_year`) — использую ключи PH-38.
- **Q-24** Эталон T10 (успеваемость 64 % при слабых темах 33/43/43/67/100 у одного ученика) не сходится с формулой BR-AN-02 (среднее ≈ 57 %). По AG-07 приоритет у текста: seed `visual` подберу так, чтобы формула давала значения, максимально близкие к эталону; расхождение в 64 % допускаю. Аналогично «2 из 17» на U10 → «из 12».
- **Q-20** Уведомления (API-ME-04, PH-32): ни одно событие в SPEC не создаёт уведомлений. *Предлагаю:* пустой список + «Уведомлений нет» (текст — TODO(OWNER)).
- **Q-21** Жёлтая «лампочка» в кабинетах (REQ-GEN-SHELL-04, ссылка на PH-32) — что она показывает? PH-32 — это только лимит уведомлений. *Предлагаю:* кнопка-точка входа с заглушкой PH-24.
- **Q-25** Токены светлой темы заданы частично (`--bg, --surface, --sidebar, --text`); `--field`, `--text-muted`, `--border` и др. для light не определены. *Предлагаю:* подобрать по эталону U12 и отметить `TODO(OWNER)` для дизайнера.
- **Q-14** Шрифт: Inter или Manrope? *Предлагаю:* Inter (полная кириллица и казахские глифы).
- **Q-26** RLS (SHOULD): у таблиц контента/результатов нет `school_id`, поэтому RLS по школе закроет только `classes`, `user_roles`, `audit_log`. Достаточно ли? *Предлагаю:* да, основная защита — guards и проверки в сервисах.
- **Q-27** Инфраструктура выпуска (итерация 11): серверы в РК, домен, провайдер S3 и SMTP для продуктива, куда отправлять Sentry/метрики. Нужны до итерации 11.

---

## Текущее состояние (на 2026-10-17, итерация 10)

### Порядок работ (решение владельца 2026-10-17)
Сначала весь функционал, дизайн — в конце: доработки 8.6 → **итерация 9** → итерация 10 → итерация 8.5 «Улучшение UI/UX» (React Bits) → итерация 11. До 8.5 React Bits не подключается; новые экраны 9–10 строятся только из готовых компонентов и токенов `packages/ui`, без одноразовых стилей.

### Выполнено и принято
| Итерация | Статус | Последний коммит |
|---|---|---|
| 1 — Каркас | принята владельцем | `8b1a2c2` |
| 2 — База данных | принята владельцем | `b29675d` |
| 3 — Оболочка и публичные страницы | принята владельцем | `0260c28` |
| 4 — Формы и поддержка | принята владельцем; доработки — `db128cf` | `f278a6b` |
| 5 — Пробный вопрос и публичный помощник | принята владельцем | `c31444c` |
| 6 — Аккаунты и классы | принята владельцем с исправлением; исправление выполнено | `674338b` |
| Основа дизайна (перед 7) | принята владельцем (2026-10-16) | `6d3d6e6` |
| 7 — Кабинет учителя: контент | принята владельцем с доработками (2026-10-16) | `f4f6478` |
| 8 — Интерфейс ученика: обучение | принята владельцем с доработками (2026-10-16) | `cb59302` |
| 8.6 — Базовая программа платформы | принят владельцем (2026-10-17); доработки выполнены | `b0d852c` |
| 9 — Учебный ИИ | принята владельцем (2026-10-17) | `80dd7ba` |
| 10 — Задания, показатели, аналитика | принята владельцем с доработками (2026-10-17); доработки выполнены | см. git log |

Итоги каждой итерации — в подразделах «Итог» выше. Код — в `main` на GitHub (`alexanderdredw/SyntaraEducationalplatform-v1`), CI — GitHub Actions (runner `ubuntu-24.04`).

### В работе — приведение интерфейса к эталонам (docs/UX_AI_TZ.md, 2026-10-19)
- [x] Шаг 1–2: скрипт съёмки `e2e/scripts/ux-audit-shots.mjs`, аудит `docs/UX_AUDIT.md` (коммит `0f612c2`).
- [x] Шаг 3–4, часть A: токены, хедер и боковая панель, футер, вкладки, аккордеон, урок, квиз, чат ИИ, каталог, показатели, достижения, кабинет учителя T04–T10; склейки «после» — `docs/media/ux-audit/*-compare-after.png`.
- [ ] Шаг 5, часть B: `docs/UX_TZ.md` UX-01…UX-09 (UX-01 хедер — сделан вместе с частью A).
- [ ] Шаг 6: lint, typecheck, тесты, e2e, CI, отчёт.
Как продолжить после обрыва: стек — `pnpm infra:up`, `pnpm db:seed --set=visual`, api с `AI_TUTOR_FIXTURE=true`, web с `S3_ENDPOINT` из .env; съёмка — `node e2e/scripts/ux-audit-shots.mjs after` (из папки e2e); открытые пункты — `docs/UX_AUDIT.md`, раздел «Итог после исправлений».

Итерация 10 принята, доработки выполнены; итерация 8.5 — только по команде владельца. Части итерации 10:
- [x] Решения по итерации 9: `docs/AI_PROVIDER.md`, BR-AI-08, абзац U02, лимиты PH-20, mock — SPEC.
- [x] Часть 1 — API: задания, сдачи, показатели, достижения, аналитика; integration-тесты.
- [x] Часть 2 — web: экраны учителя и ученика; e2e.
- [x] Часть 3 — проверка в браузере, скриншоты `docs/media/iteration10/`, отчёт, зелёный CI.
- [x] Доработки после приёмки — четверти, BR-ASG-03, «Карта освоения», тексты U08.

### Ждём решений владельца
0. Итерация 10: TODO(OWNER) — сверить начало (1 сентября) и конец (25 мая) учебного года 2026–2027 с приказом Минпросвещения РК; тексты `needs_confirmation` (шаги «С чего начать», окна правил, тексты U08, «Карта освоения») пока остаются.
1. TODO(OWNER) в коде: реальный список школ; согласие родителя; роль «завуч»; отдельный срок ссылки подтверждения email; подпись вебхука входящих писем (Q-10); токены светлой темы (Q-25); иконки базовых предметов и картинки бейджей (8.5); кто готовит контент базовой программы; поставщик ИИ (Q-11, `docs/AI_PROVIDER.md`).
2. Тексты-заглушки в `needs_confirmation.json` — пока остаются.
3. «Продолжить без входа →» ведёт на главную `/` — подтвердить или указать другую цель.

### Следующий шаг
По команде владельца — итерация 8.5 «Улучшение UI/UX» (React Bits, витрина `/ru/dev/ui`), затем итерация 11.

### Следующий шаг
Приёмка итерации 9; итерация 10 «Задания, показатели, аналитика» — только по команде владельца. Новые уроки базовой программы: `docs/CONTENT_GUIDE.md` → `pnpm content:check` → `pnpm content:import`.

Как продолжить: открыть Claude Code в папке проекта и дать команду «Прочитай CLAUDE.md, docs/SPEC.md и docs/PLAN.md (раздел «Текущее состояние»). Выполни следующую итерацию.» Для локального запуска: Docker Desktop → `pnpm dev` → `pnpm db:migrate` → `pnpm db:seed --set=demo` → http://localhost:3000. Письма — в Mailpit: http://localhost:8025. Локальный e2e при запущенном `pnpm dev`: сборка web с `NEXT_DIST_DIR=.next-e2e` и серверы на других портах. Загрузка файлов из браузера: web нужен `S3_ENDPOINT` (CSP), api для e2e — `AI_DRAFT_FIXTURE=true`; проверка файлов — запущенные worker, ClamAV и olevba (`pnpm infra:up`).
