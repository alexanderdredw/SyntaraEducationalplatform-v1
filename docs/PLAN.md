# Syntara Education Platform — технический план реализации

> Основание: `docs/SPEC.md` (разделы 0–15), `CLAUDE.md`. План детализирует раздел 12 SPEC и не добавляет функций сверх него.
> При расхождении плана и SPEC прав SPEC. Итерации выполняются строго по одной, следующая — только по команде владельца.
> Статус: **согласован владельцем** (2026-10-13). Решения по вопросам — в разделе Q; изменения SPEC — в разделе 16 SPEC.
>
> **Ход работ:** итерация 1 — выполнена (2026-10-13), см. отчёт в конце раздела «Итерация 1». Итерация 2 — ждёт команды.

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

### Проверка
- Playwright: переключение вкладок и языка — меняется `?tab`, тема и прогресс те же (AC-ST-01, AC-GEN-02); ответ → сразу результат, в предыдущих сетевых ответах нет правильного ответа (AC-ST-02); уход/возврат — продолжение с того же вопроса (AC-ST-03).
- Integration: finish с 85 % → +20 XP, mastered, бейджи «Первый шаг» и «Тема освоена» (AC-ST-04); повторная обработка того же события → без повторного начисления (AC-ST-05); черновая тема и тема класса после leave → 404.
- Unit: нормализация text_input, формула уровня, серия на границах суток UTC+5, каждое из 12 правил бейджей.

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
- **Q-17** Версионирование квиза: `topic_versions.snapshot` — входят ли в снимок вопросы? Попытка привязана к версии (BR-QZ-08), а вопросы редактируются отдельно (API-T-20/21) и не версионируются. *Предлагаю:* ученик всегда получает текущие неархивированные вопросы опубликованной темы; snapshot — только контент темы.
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
