# 0. Инструкция для ИИ-агента

## 0.1 Назначение документа

Этот документ — спецификация Syntara Education Platform для реализации ИИ-агентом (Claude Code, Cursor, Copilot и аналоги). Он эквивалентен ТЗ «Syntara_ТЗ_краткое.docx» ред. 5.1 по функциональности, архитектуре и требованиям, но изложен как машинно-однозначный контракт: идентификаторы требований, схемы данных, API, правила в псевдокоде, конечные автоматы и проверяемые критерии.

## 0.2 Правила работы агента

| **ID** | **Правило** |
|---|-----------------------------|
| AG-01 | Реализуй только то, что описано в документе. Не добавляй страницы, поля, кнопки, тарифы, бейджи и правила, которых здесь нет. |
| AG-02 | Если поведение не описано — используй значение из раздела 11 (конфигурация заглушек). Если и там нет — оставь `TODO(OWNER): <вопрос>` в коде и выключи функцию флагом; не придумывай значение. |
| AG-03 | Все видимые тексты бери из этого документа дословно (в кавычках «…»). Тексты хранятся в файлах локализации, не в коде компонентов. |
| AG-04 | Права доступа проверяются только на сервере. Скрытие кнопки в интерфейсе не считается защитой. |
| AG-05 | Работай итерациями плана из раздела 12. После каждой итерации прогоняй тесты и проверки DoD этой итерации. |
| AG-06 | Каждое требование имеет ID. Указывай ID в названии теста и в описании коммита: `feat(quiz): REQ-ST-QZ-03 one correct option`. |
| AG-07 | Скриншоты-эталоны (S01–S26, T04–T10, U01–U13) — источник визуального соответствия. При расхождении скриншота и текста приоритет у текста. |
| AG-08 | Демонстрационные данные со скриншотов (имена, классы, числа, даты) не хранить как константы. Они допустимы только в seed-данных для визуальных тестов. |
| AG-09 | Не меняй схему БД без миграции. Не удаляй ограничения целостности из раздела 5. |
| AG-10 | Секреты (ключи ИИ, SMTP, S3) — только в переменных окружения сервера. Никогда не передавай их в клиент. |

## 0.3 Уровни обязательности

| **Слово** | **Значение** |
|------|-----------------------------|
| MUST / ДОЛЖЕН | Обязательно; невыполнение — дефект, блокирующий приёмку |
| MUST NOT / НЕ ДОЛЖЕН | Запрещено |
| SHOULD / СЛЕДУЕТ | Рекомендуется; отклонение допустимо с комментарием в коде |
| PLACEHOLDER | Временное значение из раздела 11; хранится в конфигурации, помечено `needs_confirmation=true` |

## 0.4 Схема идентификаторов

| **Префикс** | **Область** |
|------|-----------------------------|
| REQ-GEN-* | Общие требования (оболочка, дизайн, языки, формы, безопасность) |
| REQ-PUB-* | Гостевой режим (публичные страницы) |
| REQ-TCH-* | Кабинет учителя |
| REQ-ST-* | Интерфейс ученика |
| REQ-SUP-* | Служебная поддержка |
| REQ-NFR-* | Нефункциональные требования |
| BR-* | Бизнес-правила (раздел 7) |
| SM-* | Конечные автоматы (раздел 9) |
| API-* | Операции API (раздел 6) |
| AC-* | Критерии приёмки (раздел 13) |
| PH-* | Заглушки (раздел 11), соответствуют ЗГ-* исходного ТЗ |

## 0.5 Определение готовности (Definition of Done) для любой задачи

1.  Код проходит `pnpm lint`, `pnpm typecheck`, `pnpm test`.
2.  Для каждого затронутого REQ есть минимум один автоматический тест.
3.  Все видимые строки — в `packages/shared/i18n/ru.json` (и ключи в kk.json, en.json).
4.  Новые эндпоинты описаны в OpenAPI и покрыты тестом прав доступа (положительный и отрицательный случай).
5.  Интерактивные элементы доступны с клавиатуры; axe-core без нарушений уровня serious/critical.
6.  Миграции БД применяются и откатываются на чистой базе.

# 1. Контекст продукта

## 1.1 Что строим

Syntara Education Platform — адаптивная веб-платформа для школ Республики Казахстан на языках KK, RU, EN. Три режима в одном приложении с общей моделью данных:

| **Режим** | **Роль** | **Объём** |
|-------|------|-----------------------------|
| Гостевой | guest (без входа) | 10 публичных страниц, пробный вопрос, публичный помощник, заявка школы, обращение в поддержку, правовые документы; каталог и «Обзор» базовых уроков платформы (BR-VIS-04) |
| Кабинет учителя | teacher | Предметы, выдача классу, темы, материалы, публикация, вопросы квиза, задания, аналитика класса; Battle — живые викторины для класса (7.12) |
| Интерфейс ученика | student | Каталог, урок, квиз, учебный ИИ, показатели, достижения, класс; участие в Battle по коду (7.12) |
| Служебная поддержка | support_agent, onboarding_agent | Очереди обращений и школьных заявок |

## 1.2 Матрица доступа (REQ-GEN-ACL)

| **Ресурс / действие** | **guest** | **student** | **teacher** | **support_agent** | **onboarding_agent** |
|-------------|---|---|---|---|---|
| Публичные страницы, помощник, пробный вопрос, формы, правовые | R | R | R | R | R |
| Подключение к классу по коду | → login | W | — | — | — |
| Каталог, тема, квиз (только опубликованное, BR-VIS-01) | — | R | R (предпросмотр) | — | — |
| Каталог и «Обзор» базовых уроков платформы (BR-VIS-04) | R | R | R | R | R |
| Квиз, Syntara AI, XP и прогресс по базовым урокам | → login | R/W (свои) | — | — | — |
| Базовые предметы, темы, вопросы, картинки (BR-ACL-05) | — | — | — | — | — |
| Учебный ИИ, личные показатели, достижения | — | R/W (свои) | — | — | — |
| Предметы, темы, вопросы, материалы | — | — | R/W (свои) | — | — |
| Выдача предмета классу, задания, аналитика | — | — | R/W (свои классы) | — | — |
| Battle-тесты, игровые сессии (ведущий), итоги и история своих игр (7.12) | — | — | R/W (свои) | — | — |
| Участие в Battle по коду: лобби, ответы, свои итоги и история (BR-BTL-02) | → login | R/W (свои; только сессии своего класса) | — | — | — |
| Очередь обращений | — | — | — | R/W | — |
| Очередь школьных заявок | — | — | — | — | R/W |

R — чтение, W — изменение, «→ login» — перенаправление на вход с сохранением цели. Базовые уроки платформы через сайт и API не изменяет никто: они создаются и меняются только файлами `content/` и командой импорта (BR-CNT-01, решение владельца 2026-10-16). Служебные роли MUST NOT иметь доступ к учебным данным. Роли teacher/student MUST NOT иметь доступ к очередям поддержки.

## 1.3 Вне объёма (MUST NOT реализовывать)

Кабинеты школы и родителя; программа по классам (годам обучения); новые атласы; оплата и тарифы; офлайн-обучение. Для непоказанных экранов (история версий, уведомления, меню роли, профиль, «Ростер», «Карта освоения», «Мои курсы», «Мои задания», проверка работы) реализуется минимальная версия из раздела 11; точки входа (кнопки и ссылки) сохраняются всегда.

## 1.4 Команда на старте

| **Роль** | **Технологии** |
|------|-----------------------------|
| Фронтенд-разработчик (1–2) | Next.js, React, TypeScript, Tailwind, Radix UI |
| Бэкенд-разработчик (1–2) | NestJS, PostgreSQL, Drizzle, Redis, BullMQ |
| DevOps (частичная занятость) | Docker, Nginx, CI/CD, мониторинг, резервное копирование |
| QA-инженер (1) | Playwright, axe-core, k6 |
| Дизайнер (частичная занятость) | Figma, токены дизайна 3.1 |

## 1.5 Эталонные изображения

| **Набор** | **Файлы** | **Размер** | **Назначение** |
|------|-------------|------|-------------|
| S01–S26 | Передаются отдельно | — | Публичная часть |
| T04–T10 | 04_teacher_class_access.jpg … 10_teacher_class_results.jpg | 1348 × 926 | Кабинет учителя |
| U01–U13 | 01_opening_syntara_platform.jpg … student subjects .jpeg | 1348 × 926 (U03 — 1363 × 936) | Интерфейс ученика |

Изображения T и U вставлены в разделы 8.3 и 8.4. Визуальные тесты сравнивают экран на эталонном размере с соответствующим файлом.

# 2. Стек и структура репозитория

## 2.1 Стек (фиксированный)

| **Слой** | **Технология** |
|------|-----------------------------|
| Язык | TypeScript 5 (strict) везде |
| Монорепозиторий | pnpm workspaces + Turborepo |
| Web | Next.js 15+ (App Router), React 19, Tailwind CSS 4, Radix UI, Lucide, next-intl, React Hook Form + Zod, TanStack Query, react-markdown + rehype-sanitize, Serwist (manifest; офлайн-кеш выключен) |
| API | Node.js 22 LTS+, NestJS 11, Drizzle ORM + drizzle-kit, Zod, @nestjs/swagger, argon2, @nestjs/throttler (Redis), AWS SDK v3 (S3), Vercel AI SDK за интерфейсом LLMProvider, SSE |
| Worker | BullMQ, nodemailer, clamd-клиент, olevba (контейнер на Python) |
| Данные | PostgreSQL 16+, PgBouncer, Redis 7 / Valkey, S3-совместимое хранилище (MinIO локально) |
| Наблюдаемость | OpenTelemetry, Prometheus, Grafana, Loki, Sentry |
| Тесты | Vitest, Testcontainers, Playwright, @axe-core/playwright, k6 |
| Инфраструктура | Docker, Docker Compose на 2+ серверах (при росте — Kubernetes), Nginx, Let's Encrypt, CI (GitHub Actions или GitLab CI) |
| Принципы | Модульный монолит (api) + отдельный worker; события и письма — через transactional outbox; пароли — Argon2id (допустим bcrypt); права — guards NestJS + RLS |

![Архитектура системы и основные компоненты](media/arch.png)

## 2.2 Структура репозитория

```text
syntara/
├─ apps/
│  ├─ web/                 # Next.js: публичные страницы, кабинеты, служебная поддержка
│  │  ├─ app/[locale]/(public)/...   # /, /subjects, /about, /ai, /schools, /support, правовые
│  │  ├─ app/[locale]/(auth)/...     # /auth/login, /auth/start, /join
│  │  ├─ app/[locale]/(teacher)/...  # /teacher/...
│  │  ├─ app/[locale]/(student)/...  # /learn/...
│  │  ├─ app/[locale]/(staff)/...    # /staff/tickets, /staff/requests
│  │  └─ components/        # компоненты страниц
│  ├─ api/                 # NestJS
│  │  └─ src/modules/{auth,users,classes,content,quiz,assignments,results,gamification,ai,support,public,files,audit,battle}
│  └─ worker/              # BullMQ-процессоры: outbox, email, file-scan, cleanup, battle (таймеры игр, 7.12)
├─ packages/
│  ├─ shared/              # Zod-схемы, типы DTO, enum, i18n (ru.json, kk.json, en.json), config keys
│  ├─ ui/                  # дизайн-система (токены, Button, Card, Tabs, Field, Modal ...)
│  └─ db/                  # Drizzle schema, миграции, seed (demo, visual), импорт базовой программы
├─ content/                # базовая программа платформы: файлы уроков (BR-CNT-02, docs/CONTENT_GUIDE.md)
├─ infra/                  # docker-compose.yml, nginx.conf, grafana dashboards
└─ e2e/                    # Playwright: сценарии, визуальные эталоны, axe
```

## 2.3 Переменные окружения

| **Переменная** | **Пример** | **Где** |
|---------|----------|----|
| DATABASE_URL | postgres://syntara:***@pgbouncer:6432/syntara | api, worker |
| REDIS_URL | redis://redis:6379 | api, worker |
| S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY, S3_SECRET_KEY | http://minio:9000, syntara-files | api, worker |
| S3_PUBLIC_ENDPOINT | https://files.syntara-edu.me — адрес хранилища для браузера: подписанные ссылки на загрузку и чтение, CSP web; пусто — как S3_ENDPOINT | api, web |
| SESSION_SECRET | 64 случайных байта | api |
| APP_BASE_URL | https://syntara-edu.me | web, api |
| API_INTERNAL_URL | http://api:3001 | web (SSR) |
| LLM_PROVIDER | mock / openai-compatible / anthropic | api |
| LLM_API_KEY, LLM_MODEL | — (обязательны, если LLM_PROVIDER ≠ mock; ключ — секрет, в журналы не попадает) | api |
| LLM_BASE_URL | адрес API поставщика: обязателен для openai-compatible (…/v1), для anthropic — необязателен | api |
| SMTP_URL, MAIL_FROM | smtp://..., noreply@syntara-edu.me | worker |
| SUPPORT_EMAIL | PH-09 | api, web (через API config) |
| CLAMD_HOST, OLEVBA_URL | clamav:3310, http://olevba:8080 | worker |
| PLATFORM_TZ | Asia/Almaty (UTC+5) — PH-42 | api, worker |
| SENTRY_DSN, OTEL_EXPORTER_OTLP_ENDPOINT | — | все |

## 2.4 Команды

```bash
pnpm i                      # установка
pnpm dev                    # web :3000, api :3001, worker; инфраструктура через docker compose
pnpm db:migrate             # применить миграции
pnpm db:seed --set=demo     # демо-данные (эталоны скриншотов) и импорт базовой программы из content/
pnpm content:check          # проверка файлов content/ без записи в БД (в CI)
pnpm content:import         # импорт content/ в БД (BR-CNT-*); --dry-run — только проверка и план изменений
pnpm test                   # unit + integration (Vitest + Testcontainers)
pnpm e2e                    # Playwright: сценарии, визуальные и axe-проверки
pnpm lint && pnpm typecheck
```

# 3. Дизайн-система

## 3.1 Токены (REQ-GEN-DS-01)

Токены MUST быть объявлены как CSS-переменные в `packages/ui/tokens.css` и подключены в Tailwind. Значения — стартовые; критерий — совпадение с эталонами.

```css
:root, [data-theme="dark"] {
  --bg: #070707;            /* фон страницы, диапазон #050505–#090909 */
  --surface: #141518;       /* карточки, диапазон #101010–#1B1D22 */
  --surface-teacher: #0D0D0D;
  --field: #1C1F25;         /* поля ввода, #181818–#20242B */
  --text: #F1F2F4;
  --text-muted: #9A9EA7;    /* #92969F–#A5A8B1 */
  --accent: #2F7DF0;        /* #1E63E4–#4A9CFA; кабинет: #1765E8 */
  --accent-teacher: #1765E8;
  --border: #292B30;
  --success: #22A45D;       /* правильный ответ */
  --danger: #E5484D;        /* низкий результат, «требуют внимания» */
  --ai-gradient: linear-gradient(90deg, #8B5CF6, #EC4899);
  --radius-card: 20px;      /* 16–24 */
  --radius-pill: 999px;
}
[data-theme="light"] {
  --bg: #FAFAFC; --surface: #FFFFFF; --sidebar: #F2F2F4; --text: #181818;
}
```

| **Параметр** | **Значение** |
|---------|-----------------------------|
| Сетка отступов | 8, 12, 16, 24, 32, 48, 64 px |
| Ширина контента | секции 1120–1240; хедер 1440–1600; формы 560–640; «Школам» 640–760; правовые 780–900; кабинет: формы ~664, задания и аналитика ~760; урок ~982 |
| Шрифт | Inter или Manrope, self-hosted, `font-display: swap`; полная кириллица и казахские буквы (Ә Ғ Қ Ң Ө Ұ Ү Һ І) |
| Размеры (публичные) | H1 главной 72–112; заголовки секций 28–64; текст 16–20; подписи 12–14 |
| Размеры (кабинеты) | заголовок 28; блок 18; текст 14; пояснение 12 |
| Иконки | Lucide, линейные, цвет `--accent` |
| Спецсостояния | «Опубликовать» — светлая кнопка; ИИ-кнопка — `--ai-gradient`; правильный ответ — рамка `--success`; низкий результат — `--danger`; фокус поля — синий контур со свечением |

## 3.2 Базовые компоненты (packages/ui)

`Button` (variant: primary-blue, primary-white, secondary, text, publish, ai), `Card`, `Pill`, `Tabs` (капсульные), `SegmentedControl` (RU/KK/EN, тип, сложность, период), `Field` (label + input + error + hint), `Select`, `Textarea`, `Checkbox`, `Radio`, `Modal`, `Accordion`, `ProgressBar`, `Badge`, `EmptyState`, `Toast`, `Skeleton`, `Sidebar`, `Header`, `Footer`, `FloatingHelp`. Все компоненты MUST поддерживать клавиатуру и видимый фокус (Radix UI).

## 3.3 Оболочка (REQ-GEN-SHELL)

| **ID** | **Требование** |
|---|-----------------------------|
| REQ-GEN-SHELL-01 | Публичный хедер: логотип Syntara; меню «Главная», «Предметы», «О проекте», «Syntara AI», «Школам», «Помощь» (активный пункт — светлая капсула); справа язык, «Экономия трафика выключена», переключатель темы, кнопка «Войти» (у вошедшего пользователя — «Кабинет»: главная страница его активной роли). Хедер закреплён сверху; якоря учитывают его высоту (`scroll-margin-top`). |
| REQ-GEN-SHELL-02 | Хедер кабинетов: вместо меню — выбор роли («Учитель»/«Ученик»), язык, трафик, тема, уведомления, профиль (буква аватара + имя из аккаунта; роль показывается один раз — в выборе роли), «Выйти». У ученика дополнительно индикаторы серии (пламя) и XP из `GET /me/stats`. |
| REQ-GEN-SHELL-03 | Боковая панель кабинетов ~70 px со значками; активный — синяя подложка и полоса слева. Значки без страницы ведут на заглушку «Раздел в разработке» (PH-24). |
| REQ-GEN-SHELL-04 | Плавающие кнопки справа внизу: «?» — краткая справка по странице и ссылки поддержки; синяя кнопка диалога — публичный помощник. В кабинетах между ними жёлтая «лампочка» (PH-32). Кнопки не перекрывают поля ввода, cookie-баннер и чат. |
| REQ-GEN-SHELL-05 | Футер (синий градиент): колонка бренда — «Учись в своём темпе — на казахском и русском», email поддержки (PH-09), «KK · RU · EN»; ПРОДУКТ — Главная, Предметы, О проекте, Syntara AI; ШКОЛАМ — Школам, Оставить заявку, Помощь, Войти, Подключиться к классу (в кабинетах последние две → «Кабинет»); ПРАВОВОЕ — три документа. Низ: «© 2026 Syntara Education Platform. Образовательный продукт.» |
| REQ-GEN-SHELL-06 | Мобильная версия (< 1024 px): логотип, «Войти», кнопка «Меню». В меню: 6 разделов, язык, тема, трафик. Закрытие кнопкой, Escape, переходом; фокус возвращается на кнопку «Меню». |
| REQ-GEN-SHELL-07 | 320–430 px: без горизонтальной прокрутки; одна колонка; зоны нажатия ≥ 44×44 px; размер шрифта полей ≥ 16 px; экранная клавиатура не перекрывает поле и кнопку отправки. Есть ссылка «К содержимому». |

## 3.4 Язык, тема, трафик (REQ-GEN-PREF)

| **ID** | **Требование** |
|---|-----------------------------|
| REQ-GEN-PREF-01 | Локаль в URL-префиксе `/{ru|kk|en}/...`. Смена языка MUST NOT перезагружать страницу и терять введённые данные, выбранную тему урока и вкладку. Выбор сохраняется в cookie `locale` и в `user_preferences`. |
| REQ-GEN-PREF-02 | Язык без готового перевода показывается в меню недоступным с подписью «скоро» (PH-04). Контент без перевода показывается на доступном языке; машинный перевод MUST NOT использоваться. Заранее подготовленные переводы текстов интерфейса в `kk.json` и `en.json` машинным переводом во время работы не являются и допустимы; KK-переводы помечаются `needs_review` до проверки носителем языка (решение владельца, ред. 2026-10-13). |
| REQ-GEN-PREF-03 | Тема: при первом визите — `prefers-color-scheme`; ручной выбор сохраняется (cookie `theme` + `user_preferences`). Атрибут `data-theme` на `<html>` выставляется до отрисовки (без мигания). |
| REQ-GEN-PREF-04 | Экономия трафика (`data_saver`): отключает анимации, автозагрузку изображений вне первого экрана и prefetch. Подпись кнопки: «Экономия трафика выключена» / «Экономия трафика включена». |
| REQ-GEN-PREF-05 | Глобальный язык интерфейса и вкладки RU/KK/EN в редакторах — независимые состояния. |


# 4. Маршруты

Все маршруты имеют префикс локали `/{locale}`. Доступ проверяется middleware Next.js (перенаправление) и, обязательно, API (данные).

| **Маршрут** | **Страница** | **Доступ** | **Эталон** | **Раздел** |
|-----------|---------|-----|----|----|
| / | Главная (гость) / главная ученика | все | S01–S07, U01 | 8.1.1, 8.4.1 |
| /subjects | Предметы | все | S08 | 8.1.2 |
| /about | О проекте | все | S09–S14 | 8.1.3 |
| /ai | Syntara AI — помощник по платформе | все | S15 | 8.1.4 |
| /schools | Школам | все | S16–S17 | 8.1.5 |
| /schools/request | Заявка школы | все | S18 | 8.1.6 |
| /support | Поддержка | все | S19 | 8.1.7 |
| /terms, /privacy, /cookies | Правовые документы (PH-43) | все | S20–S26 | 8.1.8 |
| /auth/login | Вход | guest | — | 8.2.1 |
| /auth/start | Выбор роли и регистрация | guest | — | 8.2.1 |
| /join | Подключение к классу | guest → login, student | — | 8.2.2 |
| /account/privacy | Мои данные | авторизованные | — | 8.2.3 |
| /teacher/courses | Мои курсы | teacher | — | 8.3 |
| /teacher/subjects/new | Новый предмет | teacher | T05 | 8.3.1 |
| /teacher/subjects/:id | Предмет: доступ классу и темы | teacher (владелец) | T04 | 8.3.2 |
| /teacher/subjects/:id/topics/new, /teacher/topics/:id | Редактор темы (`/topics/new` — переход на страницу предмета: тема создаётся кнопкой «+ Добавить тему», REQ-TCH-ACC-02) | teacher (владелец) | T06–T07 | 8.3.3 |
| /teacher/topics/:id/quiz | Квиз темы | teacher (владелец) | T08 | 8.3.5 |
| /teacher/assignments | Задания | teacher | T09 | 8.3.6 |
| /teacher/classes, /teacher/classes/:id/{roster,mastery,analytics} | Классы и аналитика | teacher (владелец класса) | T10 | 8.3.7 |
| /learn/subjects | Каталог и класс | student; гость — каталог базовых уроков (BR-VIS-04) | U13 | 8.4.2 |
| /learn/sections/:id | Раздел каталога | student; гость (BR-VIS-04) | U03 | 8.4.2 |
| /learn/subjects/:id | Предмет: темы и их статусы | student; гость — базовый предмет, без статусов (BR-VIS-04) | — | 8.4.2 |
| /learn/topics/:id?tab=overview|quiz|ai | Урок | student; гость — «Обзор» базового урока, на «Квиз» и «Syntara AI» — приглашение войти (REQ-ST-LES-06) | U04–U07, U09, U11, U12 | 8.4.3–8.4.5 |
| /learn/assistant | Учебный помощник | student | U02 | 8.4.5 |
| /learn/progress | Мои показатели | student | U08 | 8.4.6 |
| /learn/achievements | Достижения | student | U10 | 8.4.7 |
| /learn/assignments | Мои задания (PH-33) | student | — | 8.4.8 |
| /teacher/battles | Мои Battle: вкладки «Тесты» и «История игр» (`?tab=history&classId=`) | teacher | — | 8.6.1 |
| /teacher/battles/:id | Редактор Battle-теста | teacher (владелец) | — | 8.6.1 |
| /teacher/battle-sessions/:sid | Игра ведущего: лобби, вопрос, раскрытие, рейтинг, итог | teacher (ведущий сессии) | — | 8.6.1 |
| /teacher/battle-sessions/:sid/results | Результаты игры | teacher (ведущий сессии) | — | 8.6.1 |
| /learn/battles | Вход в Battle по коду и «Мои Battle» | student | — | 8.6.2 |
| /learn/battles/:sid | Игра ученика: лобби, вопрос, раскрытие, рейтинг, итог | student (участник) | — | 8.6.2 |
| /learn/battles/:sid/results | Итоги игры ученика | student (участник) | — | 8.6.2 |
| /staff/tickets, /staff/requests | Служебные очереди | support_agent / onboarding_agent | — | 8.5 |

Правила: внешние ссылки атласов — из конфигурации (PH-10). `returnTo` — только относительный внутренний путь, проверенный по белому списку префиксов; иначе `/`. Прямой заход по URL отдаёт ту же страницу, что и навигация (SSR).

# 5. База данных

## 5.1 Соглашения

- PostgreSQL 16+. Все PK — `uuid` (UUIDv7, генерация в приложении). Время — `timestamptz` (UTC).
- Каждая таблица, кроме связующих, имеет `created_at timestamptz NOT NULL DEFAULT now()` и `updated_at timestamptz NOT NULL DEFAULT now()` (в DDL ниже опущены).
- Переводы — таблицы `*_translations` с PK `(entity_id, locale)`.
- Учебные сущности не удаляются физически: `archived_at timestamptz NULL`.
- Миграции — drizzle-kit; ручные изменения схемы запрещены (AG-09).
- Row-Level Security SHOULD быть включена для таблиц со `school_id` как второй уровень защиты.

![Схема БД: пользователи, классы и учебный контент](media/er1a.png)

![Схема БД: квизы и задания](media/er1b.png)

![Схема БД: результаты, геймификация, ИИ, поддержка и служебные таблицы](media/er2.png)

## 5.2 Перечисления

```sql
CREATE TYPE locale            AS ENUM ('ru','kk','en');
CREATE TYPE user_role         AS ENUM ('student','teacher','support_agent','onboarding_agent');
CREATE TYPE topic_status      AS ENUM ('draft','published');
CREATE TYPE question_type     AS ENUM ('single_choice','true_false','text_input');
CREATE TYPE difficulty        AS ENUM ('easy','medium','hard');
CREATE TYPE membership_status AS ENUM ('active','left');
CREATE TYPE submission_status AS ENUM ('submitted','in_review','graded');
CREATE TYPE attempt_status    AS ENUM ('in_progress','finished','abandoned');
CREATE TYPE ticket_status     AS ENUM ('new','in_progress','waiting_user','waiting_internal','resolved','closed','reopened');
CREATE TYPE support_category  AS ENUM ('technical','school_onboarding','learning','account_access','data_privacy','other');
CREATE TYPE request_status    AS ENUM ('new','in_progress','contacted','onboarded','rejected');
CREATE TYPE media_kind        AS ENUM ('cover','material','illustration','brand');
CREATE TYPE scan_status       AS ENUM ('pending','clean','rejected');
CREATE TYPE ai_context        AS ENUM ('topic_tutor','general_tutor');
CREATE TYPE ai_role           AS ENUM ('user','assistant');
CREATE TYPE ai_msg_status     AS ENUM ('complete','partial','failed');
CREATE TYPE battle_session_status AS ENUM ('lobby','in_progress','finished','cancelled');   -- 5.9
CREATE TYPE battle_phase          AS ENUM ('lobby','question','reveal','leaderboard','finished');
```

## 5.3 Пользователи, доступ, классы

```sql
CREATE TABLE schools (id uuid PRIMARY KEY, name text NOT NULL CHECK (length(name) <= 200),
  region text, city text, status text NOT NULL DEFAULT 'active');   -- 'unverified' — школа, введённая учеником вручную

CREATE TABLE users (id uuid PRIMARY KEY, email citext UNIQUE, display_name text NOT NULL,
  login citext UNIQUE,                  -- логин ученика (PH-44: 3–32 символа a-z 0-9 . _ -)
  password_hash text, is_child_safe boolean NOT NULL DEFAULT false, status text NOT NULL DEFAULT 'active',
  last_login_at timestamptz,
  email_verified_at timestamptz,        -- подтверждение email (API-AUTH-06; вход до подтверждения разрешён)
  must_change_password boolean NOT NULL DEFAULT false,  -- временный пароль от учителя (API-T-27)
  CHECK (email IS NOT NULL OR is_child_safe));

-- Решение владельца (ред. 2026-10-13): столбцы PK в PostgreSQL не могут быть NULL, поэтому вместо
-- PRIMARY KEY (user_id, role, school_id) — суррогатный id и уникальность с NULLS NOT DISTINCT (PG 15+).
CREATE TABLE user_roles (id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users, role user_role NOT NULL,
  school_id uuid REFERENCES schools, UNIQUE NULLS NOT DISTINCT (user_id, role, school_id));

CREATE TABLE user_preferences (user_id uuid PRIMARY KEY REFERENCES users,
  locale locale NOT NULL DEFAULT 'ru', theme text NOT NULL DEFAULT 'system', data_saver boolean NOT NULL DEFAULT false);

CREATE TABLE auth_sessions (id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users,
  token_hash bytea NOT NULL UNIQUE, expires_at timestamptz NOT NULL, revoked_at timestamptz, user_agent text);

CREATE TABLE consents (id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users, consent_type text NOT NULL,
  granted boolean NOT NULL, granted_by uuid REFERENCES users, granted_at timestamptz NOT NULL, revoked_at timestamptz);

CREATE TABLE data_subject_requests (id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users,
  type text NOT NULL CHECK (type IN ('export','rectify','delete','revoke_consent')),
  status text NOT NULL DEFAULT 'new', completed_at timestamptz);

CREATE TABLE classes (id uuid PRIMARY KEY, school_id uuid REFERENCES schools, teacher_id uuid NOT NULL REFERENCES users,
  name text NOT NULL CHECK (length(name) <= 50), archived_at timestamptz);

CREATE TABLE class_memberships (id uuid PRIMARY KEY, class_id uuid NOT NULL REFERENCES classes,
  student_id uuid NOT NULL REFERENCES users, status membership_status NOT NULL DEFAULT 'active',
  joined_at timestamptz NOT NULL DEFAULT now(), left_at timestamptz);
CREATE UNIQUE INDEX ux_membership_active ON class_memberships (class_id, student_id) WHERE status = 'active';
CREATE INDEX ix_membership_student ON class_memberships (student_id) WHERE status = 'active';

CREATE TABLE class_invite_codes (id uuid PRIMARY KEY, class_id uuid NOT NULL REFERENCES classes,
  code_hash bytea NOT NULL UNIQUE, expires_at timestamptz NOT NULL, is_active boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL REFERENCES users);
```

## 5.4 Учебный контент

```sql
CREATE TABLE catalog_sections (id uuid PRIMARY KEY, code text UNIQUE NOT NULL, position int NOT NULL);
CREATE TABLE catalog_section_translations (section_id uuid REFERENCES catalog_sections, locale locale,
  title text NOT NULL, description text, PRIMARY KEY (section_id, locale));

CREATE TABLE subjects (id uuid PRIMARY KEY, owner_id uuid REFERENCES users, section_id uuid REFERENCES catalog_sections,
  is_official boolean NOT NULL DEFAULT false, in_public_catalog boolean NOT NULL DEFAULT false, archived_at timestamptz,
  CHECK (is_official OR owner_id IS NOT NULL));
CREATE TABLE subject_translations (subject_id uuid REFERENCES subjects, locale locale,
  title text NOT NULL CHECK (length(title) <= 150), description text CHECK (length(description) <= 1000),
  PRIMARY KEY (subject_id, locale));

CREATE TABLE class_subject_access (id uuid PRIMARY KEY, class_id uuid NOT NULL REFERENCES classes,
  subject_id uuid NOT NULL REFERENCES subjects, granted_by uuid NOT NULL REFERENCES users,
  granted_at timestamptz NOT NULL DEFAULT now(), revoked_at timestamptz);
CREATE UNIQUE INDEX ux_csa_active ON class_subject_access (class_id, subject_id) WHERE revoked_at IS NULL;

CREATE TABLE media_files (id uuid PRIMARY KEY, owner_id uuid REFERENCES users, kind media_kind NOT NULL,
  original_name text NOT NULL, mime text NOT NULL, size_bytes bigint NOT NULL, sha256 bytea,
  storage_key text NOT NULL UNIQUE, scan_status scan_status NOT NULL DEFAULT 'pending');

CREATE TABLE topics (id uuid PRIMARY KEY, subject_id uuid NOT NULL REFERENCES subjects, position int NOT NULL,
  status topic_status NOT NULL DEFAULT 'draft', cover_media_id uuid REFERENCES media_files, cover_url text,
  published_at timestamptz, published_version_id uuid, archived_at timestamptz,
  UNIQUE (subject_id, position) DEFERRABLE INITIALLY DEFERRED);
CREATE TABLE topic_translations (topic_id uuid REFERENCES topics, locale locale,
  title text NOT NULL CHECK (length(title) <= 150), description text CHECK (length(description) <= 1000),
  fun_fact text CHECK (length(fun_fact) <= 500), body_md text CHECK (length(body_md) <= 50000), summary text,
  PRIMARY KEY (topic_id, locale));

CREATE TABLE topic_sections (id uuid PRIMARY KEY, topic_id uuid NOT NULL REFERENCES topics, position int NOT NULL,
  illustration_media_id uuid REFERENCES media_files);
CREATE TABLE topic_section_translations (section_id uuid REFERENCES topic_sections, locale locale,
  title text NOT NULL, body text, PRIMARY KEY (section_id, locale));

CREATE TABLE topic_versions (id uuid PRIMARY KEY, topic_id uuid NOT NULL REFERENCES topics, version_no int NOT NULL,
  snapshot jsonb NOT NULL, change_note text CHECK (length(change_note) <= 500), created_by uuid NOT NULL REFERENCES users,
  UNIQUE (topic_id, version_no));
ALTER TABLE topics ADD FOREIGN KEY (published_version_id) REFERENCES topic_versions;

CREATE TABLE topic_materials (topic_id uuid REFERENCES topics, media_id uuid REFERENCES media_files,
  position int NOT NULL, PRIMARY KEY (topic_id, media_id));
CREATE INDEX ix_topics_subject ON topics (subject_id, position);

-- Базовая программа (этап 8.6, решение владельца 2026-10-16): постоянные коды строк, созданных импортом content/
-- (BR-CNT-04). У контента учителей code = NULL. Базовый контент — subjects.is_official = true (owner_id NULL).
ALTER TABLE subjects ADD COLUMN code text UNIQUE, ADD CONSTRAINT subjects_code_official CHECK (code IS NULL OR is_official);
ALTER TABLE topics ADD COLUMN code text UNIQUE;
ALTER TABLE topic_sections ADD COLUMN code text UNIQUE;
ALTER TABLE questions ADD COLUMN code text UNIQUE;
-- Перевод подготовлен ИИ и ждёт вычитки человеком (BR-CNT-05); ученик видит пометку «На проверке».
ALTER TABLE topic_translations ADD COLUMN needs_review boolean NOT NULL DEFAULT false;
-- Порядок базовых предметов в каталоге — position из subject.yaml (решение владельца 2026-10-17); у предметов учителей NULL.
ALTER TABLE subjects ADD COLUMN position int,
  ADD CONSTRAINT subjects_position_official CHECK (position IS NULL OR (is_official AND position >= 1));
```

## 5.5 Квизы и задания

```sql
CREATE TABLE quizzes (id uuid PRIMARY KEY, topic_id uuid NOT NULL UNIQUE REFERENCES topics);

CREATE TABLE questions (id uuid PRIMARY KEY, quiz_id uuid NOT NULL REFERENCES quizzes, type question_type NOT NULL,
  difficulty difficulty NOT NULL, position int NOT NULL, is_demo boolean NOT NULL DEFAULT false,
  text_answer text,                     -- только для type = text_input
  archived_at timestamptz);
CREATE TABLE question_translations (question_id uuid REFERENCES questions, locale locale,
  text text NOT NULL CHECK (length(text) <= 1000), explanation text CHECK (length(explanation) <= 2000),
  PRIMARY KEY (question_id, locale));

CREATE TABLE answer_options (id uuid PRIMARY KEY, question_id uuid NOT NULL REFERENCES questions,
  position int NOT NULL, is_correct boolean NOT NULL DEFAULT false);
CREATE UNIQUE INDEX ux_one_correct ON answer_options (question_id) WHERE is_correct;
CREATE TABLE answer_option_translations (option_id uuid REFERENCES answer_options, locale locale,
  text text NOT NULL CHECK (length(text) <= 300), PRIMARY KEY (option_id, locale));

CREATE TABLE assignments (id uuid PRIMARY KEY, class_id uuid NOT NULL REFERENCES classes,
  subject_id uuid NOT NULL REFERENCES subjects, topic_id uuid NOT NULL REFERENCES topics,
  due_at timestamptz NOT NULL, created_by uuid NOT NULL REFERENCES users);
CREATE INDEX ix_assignments_class ON assignments (class_id, due_at);

CREATE TABLE submissions (id uuid PRIMARY KEY, assignment_id uuid NOT NULL REFERENCES assignments,
  student_id uuid NOT NULL REFERENCES users, status submission_status NOT NULL,
  grade numeric(5,2), submitted_at timestamptz, graded_at timestamptz, graded_by uuid REFERENCES users,
  UNIQUE (assignment_id, student_id));
CREATE INDEX ix_submissions_status ON submissions (assignment_id, status);
```

Правило «тема принадлежит предмету» для `assignments` проверяется в сервисе и триггером `check_assignment_topic()`.

## 5.6 Результаты и геймификация

```sql
CREATE TABLE quiz_attempts (id uuid PRIMARY KEY, student_id uuid NOT NULL REFERENCES users,
  quiz_id uuid NOT NULL REFERENCES quizzes, topic_version_id uuid REFERENCES topic_versions,
  assignment_id uuid REFERENCES assignments, status attempt_status NOT NULL DEFAULT 'in_progress',
  score_percent numeric(5,2), started_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz);
CREATE INDEX ix_attempts_student ON quiz_attempts (student_id, finished_at);
CREATE INDEX ix_attempts_quiz ON quiz_attempts (quiz_id);

CREATE TABLE attempt_answers (attempt_id uuid REFERENCES quiz_attempts, question_id uuid REFERENCES questions,
  option_id uuid REFERENCES answer_options, text_answer text, is_correct boolean NOT NULL,
  answered_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (attempt_id, question_id));

CREATE TABLE learning_events (id uuid PRIMARY KEY, student_id uuid NOT NULL REFERENCES users,
  type text NOT NULL CHECK (type IN ('lesson_opened','quiz_finished','topic_mastered','ai_question')),
  subject_id uuid REFERENCES subjects, topic_id uuid REFERENCES topics, occurred_at timestamptz NOT NULL,
  idempotency_key text NOT NULL, UNIQUE (student_id, idempotency_key));
CREATE INDEX ix_events_student_time ON learning_events (student_id, occurred_at);

CREATE TABLE topic_mastery (student_id uuid REFERENCES users, topic_id uuid REFERENCES topics,
  best_percent numeric(5,2) NOT NULL, attempts_count int NOT NULL, mastered_at timestamptz,
  PRIMARY KEY (student_id, topic_id));
CREATE INDEX ix_mastery_topic ON topic_mastery (topic_id);

CREATE TABLE student_stats (student_id uuid PRIMARY KEY REFERENCES users, xp_total int NOT NULL DEFAULT 0,
  level int NOT NULL DEFAULT 1, streak_current int NOT NULL DEFAULT 0, streak_best int NOT NULL DEFAULT 0,
  last_activity_date date);

CREATE TABLE levels (level int PRIMARY KEY, xp_threshold int NOT NULL UNIQUE);
CREATE TABLE level_translations (level int REFERENCES levels, locale locale, title text NOT NULL,
  PRIMARY KEY (level, locale));

CREATE TABLE badges (id uuid PRIMARY KEY, code text UNIQUE NOT NULL, image_media_id uuid REFERENCES media_files,
  rule jsonb NOT NULL, position int NOT NULL, is_active boolean NOT NULL DEFAULT true);
CREATE TABLE badge_translations (badge_id uuid REFERENCES badges, locale locale, title text NOT NULL,
  condition_text text NOT NULL, PRIMARY KEY (badge_id, locale));
CREATE TABLE student_badges (student_id uuid REFERENCES users, badge_id uuid REFERENCES badges,
  awarded_at timestamptz NOT NULL DEFAULT now(), source_event_id uuid REFERENCES learning_events,
  PRIMARY KEY (student_id, badge_id));

CREATE TABLE xp_ledger (id uuid PRIMARY KEY, student_id uuid NOT NULL REFERENCES users, amount int NOT NULL,
  reason text NOT NULL, source_event_id uuid NOT NULL REFERENCES learning_events,
  UNIQUE (student_id, source_event_id, reason));
```

## 5.7 ИИ, поддержка, служебные таблицы

```sql
CREATE TABLE ai_conversations (id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users, context ai_context NOT NULL,
  topic_id uuid REFERENCES topics, explain_level text NOT NULL DEFAULT 'beginner', archived_at timestamptz,
  CHECK (context <> 'topic_tutor' OR topic_id IS NOT NULL));
CREATE TABLE ai_messages (id uuid PRIMARY KEY, conversation_id uuid NOT NULL REFERENCES ai_conversations,
  role ai_role NOT NULL, content text NOT NULL, status ai_msg_status NOT NULL DEFAULT 'complete',
  quick_action text CHECK (quick_action IN ('simpler','more_detail','check_me')),
  tokens_in int, tokens_out int, created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX ix_ai_messages_conv ON ai_messages (conversation_id, created_at);

CREATE TABLE school_requests (id uuid PRIMARY KEY, public_number text UNIQUE NOT NULL,
  school_name text NOT NULL CHECK (length(school_name) <= 200), region text CHECK (length(region) <= 120),
  city text CHECK (length(city) <= 120), contact_person text NOT NULL CHECK (length(contact_person) <= 200),
  phone text, email citext NOT NULL, message text CHECK (length(message) <= 5000),
  status request_status NOT NULL DEFAULT 'new', assignee_id uuid REFERENCES users);

CREATE TABLE support_tickets (id uuid PRIMARY KEY, public_number text UNIQUE NOT NULL, category support_category NOT NULL,
  subject text NOT NULL CHECK (length(subject) <= 200), name text CHECK (length(name) <= 200), email citext NOT NULL,
  phone text, description text NOT NULL CHECK (length(description) <= 10000), user_id uuid REFERENCES users,
  status ticket_status NOT NULL DEFAULT 'new', assignee_id uuid REFERENCES users, tech_context jsonb,
  resolved_at timestamptz, closed_at timestamptz);
CREATE INDEX ix_tickets_queue ON support_tickets (status, assignee_id);
CREATE INDEX ix_tickets_email ON support_tickets (email);

CREATE TABLE ticket_messages (id uuid PRIMARY KEY, ticket_id uuid NOT NULL REFERENCES support_tickets,
  direction text NOT NULL CHECK (direction IN ('in','out','note')), author_id uuid REFERENCES users,
  body text NOT NULL, is_internal boolean NOT NULL DEFAULT false, sent_at timestamptz);
CREATE TABLE ticket_status_history (id uuid PRIMARY KEY, ticket_id uuid NOT NULL REFERENCES support_tickets,
  from_status ticket_status, to_status ticket_status NOT NULL, changed_by uuid REFERENCES users,
  changed_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE ticket_reply_tokens (ticket_id uuid REFERENCES support_tickets, token_hash bytea PRIMARY KEY,
  expires_at timestamptz NOT NULL);
CREATE TABLE response_templates (code text, locale locale, body text NOT NULL, PRIMARY KEY (code, locale));

CREATE TABLE idempotency_keys (scope text, key text, request_hash bytea NOT NULL, response jsonb,
  expires_at timestamptz NOT NULL, PRIMARY KEY (scope, key));
CREATE TABLE outbox_events (id uuid PRIMARY KEY, type text NOT NULL, payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), processed_at timestamptz, attempts int NOT NULL DEFAULT 0, last_error text);
CREATE TABLE email_queue (id uuid PRIMARY KEY, to_email citext NOT NULL, template text NOT NULL, payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending', attempts int NOT NULL DEFAULT 0, sent_at timestamptz);
CREATE TABLE notifications (id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users, type text NOT NULL,
  payload jsonb NOT NULL, read_at timestamptz);
CREATE TABLE audit_log (id bigserial PRIMARY KEY, actor_id uuid REFERENCES users, school_id uuid,
  entity_type text NOT NULL, entity_id uuid, action text NOT NULL, before jsonb, after jsonb,
  created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX ix_audit_entity ON audit_log (entity_type, entity_id, created_at);
REVOKE UPDATE, DELETE ON audit_log FROM app_user;

CREATE TABLE feature_flags (key text PRIMARY KEY, enabled boolean NOT NULL, note text);
CREATE TABLE app_config (key text PRIMARY KEY, value jsonb NOT NULL, needs_confirmation boolean NOT NULL DEFAULT true,
  confirmed_at timestamptz, confirmed_by text,
  note text);                           -- PH-ID заглушки раздела 11 (решение владельца, ред. 2026-10-13)
```

Таблицы `feature_flags` и `app_config` хранят флаги функций и значения заглушек раздела 11.

## 5.8 Роли БД

| **Роль** | **Права** |
|------|-----------------------------|
| app_user | SELECT/INSERT/UPDATE на рабочие таблицы; только INSERT в audit_log; без DDL; без DELETE |
| app_maintenance | Только для фоновых задач worker: SELECT и DELETE на таблицы с ограниченным сроком хранения и технические таблицы — support_tickets, ticket_messages, ticket_status_history, ticket_reply_tokens, school_requests, ai_conversations, ai_messages (очистка по срокам PH-18), media_files, topic_materials (удаление отклонённых и откреплённых файлов, BR-FILE-03), idempotency_keys, outbox_events, email_queue, auth_sessions (истёкшие записи); без INSERT/UPDATE, без DDL; к audit_log доступа нет (решение владельца, ред. 2026-10-13) |
| migrator | DDL; используется только CI при миграции |
| analytics_ro | SELECT на реплике |

## 5.9 Battle (итерация 10.5)

Миграция `0007_battle.sql` (+ откат), схема Drizzle `packages/db/src/schema/battle.ts`. Правила — 7.12, автомат — SM-BTL (раздел 9).

```sql
CREATE TABLE battle_quizzes (id uuid PRIMARY KEY, owner_id uuid NOT NULL REFERENCES users,
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 120), description text CHECK (length(description) <= 500),
  locale locale NOT NULL,                -- язык содержания теста; перевода нет
  archived_at timestamptz);
CREATE INDEX ix_battle_quizzes_owner ON battle_quizzes (owner_id, created_at DESC);

CREATE TABLE battle_questions (id uuid PRIMARY KEY, battle_quiz_id uuid NOT NULL REFERENCES battle_quizzes,
  position int NOT NULL, type question_type NOT NULL CHECK (type IN ('single_choice','true_false')),
  text text NOT NULL CHECK (length(text) BETWEEN 1 AND 300),
  image_media_id uuid REFERENCES media_files,   -- файл галереи учителя (media_files kind = 'cover', BR-BTL-10)
  time_limit_sec int NOT NULL DEFAULT 20 CHECK (time_limit_sec IN (5,10,20,30,60,90)),
  source_question_id uuid REFERENCES questions, -- если вопрос импортирован из квиза темы (копия, BR-BTL-10)
  archived_at timestamptz,
  UNIQUE (battle_quiz_id, position) DEFERRABLE INITIALLY DEFERRED);

CREATE TABLE battle_options (id uuid PRIMARY KEY, battle_question_id uuid NOT NULL REFERENCES battle_questions,
  position int NOT NULL CHECK (position BETWEEN 1 AND 4), text text NOT NULL CHECK (length(text) BETWEEN 1 AND 150),
  is_correct boolean NOT NULL DEFAULT false, UNIQUE (battle_question_id, position));
CREATE UNIQUE INDEX ux_battle_one_correct ON battle_options (battle_question_id) WHERE is_correct;

CREATE TABLE battle_sessions (id uuid PRIMARY KEY, battle_quiz_id uuid NOT NULL REFERENCES battle_quizzes,
  host_id uuid NOT NULL REFERENCES users, class_id uuid NOT NULL REFERENCES classes,
  code char(6) NOT NULL CHECK (code ~ '^[A-Z]{3}[1-9]{3}$'),
  status battle_session_status NOT NULL DEFAULT 'lobby', phase battle_phase NOT NULL DEFAULT 'lobby',
  settings jsonb NOT NULL,                 -- 7.12, таблица настроек
  questions_snapshot jsonb NOT NULL,       -- снимок вопросов при запуске (BR-BTL-05)
  current_index int, question_started_at timestamptz, deadline_at timestamptz,
  state_version int NOT NULL DEFAULT 0, cancel_reason text CHECK (cancel_reason IN ('host','expired')),
  started_at timestamptz, finished_at timestamptz, last_activity_at timestamptz NOT NULL DEFAULT now());
CREATE UNIQUE INDEX ux_battle_active_code ON battle_sessions (code) WHERE status IN ('lobby','in_progress');
CREATE INDEX ix_battle_sessions_host ON battle_sessions (host_id, created_at DESC);
CREATE INDEX ix_battle_sessions_class ON battle_sessions (class_id, created_at DESC);

CREATE TABLE battle_participants (id uuid PRIMARY KEY, session_id uuid NOT NULL REFERENCES battle_sessions,
  student_id uuid NOT NULL REFERENCES users, display_name text NOT NULL CHECK (length(display_name) <= 80),
  joined_at timestamptz NOT NULL DEFAULT now(), left_at timestamptz, kicked_at timestamptz,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  correct_count int, answered_count int, correct_time_ms int, final_rank int,   -- итоги, пишутся при finished
  UNIQUE (session_id, student_id));

CREATE TABLE battle_answers (id uuid PRIMARY KEY, session_id uuid NOT NULL REFERENCES battle_sessions,
  participant_id uuid NOT NULL REFERENCES battle_participants, question_index int NOT NULL CHECK (question_index >= 0),
  option_position int NOT NULL CHECK (option_position BETWEEN 1 AND 4), is_correct boolean NOT NULL,
  response_ms int NOT NULL CHECK (response_ms >= 0), answered_at timestamptz NOT NULL, client_answer_id uuid NOT NULL,
  UNIQUE (participant_id, question_index), UNIQUE (participant_id, client_answer_id));
CREATE INDEX ix_battle_answers_question ON battle_answers (session_id, question_index);
```

- `questions_snapshot`: `[{ index, type, text, imageMediaId, timeLimitSec, options: [{ position, text, isCorrect }] }]`; порядок — с учётом настройки «Перемешать вопросы/варианты» (один порядок для всех). Правильные варианты из снимка MUST NOT отдаваться ученику до `reveal` (BR-BTL-03).
- У всех таблиц Battle есть `created_at` и `updated_at` (5.1); в DDL опущены.
- RLS (SHOULD, второй уровень, как в миграции 0002): при заданном `app.user_id` учитель видит только свои тесты и сессии, ученик — только сессии, где он участник, и только свои ответы; без контекста — не ограничивает (основная защита — guards и сервисы).
- Аудит (REQ-NFR-SEC-05): создание и запуск сессии, выгон участника, досрочное завершение, отмена (`entity_type = 'battle_session'`).
- Права ролей БД (5.8): `app_user` — SELECT/INSERT/UPDATE на таблицы Battle; DELETE — только `app_maintenance` для `battle_answers` (обезличивание по запросу на удаление, BR-BTL-11).


# 6. API

## 6.1 Общие правила

| **ID** | **Правило** |
|---|-----------------------------|
| API-GEN-01 | Базовый путь `/api`. Формат — JSON, UTF-8. Описание — OpenAPI 3, генерируется из декораторов NestJS; клиент для web генерируется из OpenAPI. |
| API-GEN-02 | Аутентификация — cookie `sid` (HttpOnly, Secure, SameSite=Lax, срок до 14 дней с продлением). Изменяющие запросы требуют заголовок `X-CSRF-Token` (double-submit cookie `csrf`). |
| API-GEN-03 | Локаль запроса — заголовок `Accept-Language` (ru, kk, en); ответы с переводами содержат поле `locale` — фактически отданный язык. |
| API-GEN-04 | Формат ошибки: `{ "code": "VALIDATION_FAILED", "message": "…", "fieldErrors": { "email": "…" }, "requestId": "…" }`. HTTP-коды: 400, 401, 403, 404, 409, 413, 422, 429, 500, 503. |
| API-GEN-05 | Все POST публичных форм требуют заголовок `Idempotency-Key` (UUID). Тот же ключ и то же тело → прежний ответ; тот же ключ и другое тело → 409 `IDEMPOTENCY_MISMATCH`. Срок хранения ключа — 24 ч. |
| API-GEN-06 | Лимиты (Redis): формы — 5 в минуту на IP; вход — 10 в 15 минут на IP+email; проверка кода класса — 10 в 15 минут; ИИ — PH-20; Battle — ввод кода 10 за 10 минут на ученика и 30 на IP, ответы — 1 в 200 мс на участника (BR-BTL-01/03). Ответ 429 содержит `retryAfterSeconds`. |
| API-GEN-07 | Списки — курсорная пагинация: `?cursor=&limit=` (limit ≤ 100), ответ `{ items, nextCursor }`. |
| API-GEN-08 | Все обращения к данным проверяют владение/членство (BR-ACL-*). Нарушение → 404 (не раскрывать существование объекта). |

## 6.2 Публичные операции (без входа)

| **ID** | **Метод и путь** | **Запрос** | **Ответ 2xx** |
|---|------------|------------|------------|
| API-PUB-01 | GET /api/public/subjects | — | `[{ id, title, description, icon, status: 'open'|'login_required'|'soon', href }]` — элементы по кодам PH-01 (код раздела каталога или базового предмета); `open` — есть опубликованные базовые темы, `href` — `/learn/sections/:id` или `/learn/subjects/:id`; иначе `soon` без ссылки (BR-CNT-08). Порядок: `open` первыми, затем `soon`; внутри группы — порядок content/ (позиция раздела, затем предмета в разделе, BR-CNT-02) |
| API-PUB-02 | GET /api/public/demo-question | `?exclude=<id>` | `{ id, subjectId, version, text, options: [{ id, text }], hasAnother, locale }` — без `isCorrect`; `subjectId` — предмет вопроса («Перейти к предмету» для ученика); `hasAnother` — есть ли другие пробные вопросы (кнопка «Другой вопрос», PH-02) |
| API-PUB-03 | POST /api/public/demo-answer | `{ questionId, version, optionId }` | `{ correct: boolean, correctOptionId, explanation }` |
| API-PUB-04 | POST /api/public/school-requests | `SchoolRequestDto` (6.7) | 201 `{ publicNumber, email }` |
| API-PUB-05 | POST /api/public/support-tickets | `SupportTicketDto` (6.7) | 201 `{ publicNumber, email }` |
| API-PUB-06 | POST /api/public/assistant | `{ message (≤2000), history: [{role, content}] (≤20) }` | SSE: `event: delta {text}` … `event: done {}` / `event: error {code}` |
| API-PUB-07 | GET /api/public/config | — | `{ supportEmail, atlasUrls, features: {...} }` — только публичные значения из app_config |
| API-PUB-08 | POST /api/public/join/check | `{ code }` | `{ valid: boolean }` — без данных класса |
| API-PUB-09 | GET /api/public/schools | `?q=` (≥ 2 символа) | `[{ id, name, city, region }]` — до 10 подтверждённых школ (status = 'active') для автодополнения |
| API-PUB-10 | GET /api/public/catalog | — | Каталог базовых уроков для гостя (BR-VIS-04): как API-S-04, только базовые предметы; `status: 'available'|'soon'` |
| API-PUB-11 | GET /api/public/sections/:id | — | Раздел каталога для гостя: как API-S-05, только базовые предметы |
| API-PUB-12 | GET /api/public/subjects/:id | — | Базовый предмет для гостя: `{ id, title, description, topics: [{ id, number, title }] }` — без статусов; не базовый → 404 |
| API-PUB-13 | GET /api/public/topics/:id | — | «Обзор» базового урока для гостя: как API-S-06, `quizId` = null; квиз и ИИ — только после входа; не базовый или не опубликован → 404 |

## 6.3 Аутентификация и профиль

| **ID** | **Метод и путь** | **Запрос** | **Ответ 2xx** |
|---|------------|------------|------------|
| API-AUTH-01 | POST /api/auth/login | `{ email, password }` | 200 `{ user: MeDto }` + cookie `sid` |
| API-AUTH-02 | POST /api/auth/logout | — | 204 |
| API-AUTH-03 | POST /api/auth/register | `{ role: 'teacher', email, displayName, password }` (PH-06) | 201 `{ user }` и вход; письмо со ссылкой подтверждения email (API-AUTH-06) |
| API-AUTH-03S | POST /api/auth/register-student | `{ displayName, login, password, email?, schoolId?, schoolName?, code? }` (PH-06, PH-17, PH-44) | 201 `{ user }` и вход; верный код — сразу членство в классе и школа класса; неверный код — 400 без создания аккаунта |
| API-AUTH-04 | POST /api/auth/password/forgot, /reset | `{ email }`, `{ token, password }` | 204 |
| API-AUTH-05 | POST /api/auth/password/change | `{ currentPassword?, password }` | 204; при `mustChangePassword` (временный пароль) текущий пароль не нужен |
| API-AUTH-06 | POST /api/auth/email/verify, /email/resend | `{ token }`, — | 204; повторная отправка — только вошедшему с неподтверждённым email |
| API-ME-01 | GET /api/me | — | `MeDto { id, displayName, initials, roles[], activeRole, preferences, emailVerified, mustChangePassword }`; `emailVerified` = null без email |
| API-ME-02 | PATCH /api/me/preferences | `{ locale?, theme?, dataSaver? }` | 200 |
| API-ME-03 | POST /api/me/active-role | `{ role }` | 200 |
| API-ME-04 | GET /api/me/notifications | — | список (PH-32) |
| API-ME-05 | POST /api/me/data-requests | `{ type: 'export'|'delete' }` | 201; создаёт обращение категории data_privacy (PH-08) |

## 6.4 Учитель

| **ID** | **Метод и путь** | **Назначение** |
|---|------------|-----------------------------|
| API-T-01 | GET /api/teacher/subjects | Мои курсы (PH-24) |
| API-T-02 | POST /api/teacher/subjects | Создать предмет: `{ translations: {ru?, kk?, en?: {title, description}}, inPublicCatalog }` — минимум один язык с title |
| API-T-03 | GET / PATCH /api/teacher/subjects/:id | Получить / изменить предмет |
| API-T-04 | GET /api/teacher/classes | Классы учителя: `[{ id, name, studentsCount }]` |
| API-T-05 | POST /api/teacher/classes | Создать класс `{ name }` (PH-07) |
| API-T-06 | POST /api/teacher/classes/:id/invite-codes | Выпустить код `{ code, expiresAt }` (код показывается один раз) |
| API-T-07 | POST /api/teacher/subjects/:id/access | Выдать предмет классу `{ classId }`; повтор → 200 без дубля |
| API-T-08 | DELETE /api/teacher/subjects/:id/access/:classId | Отозвать выдачу |
| API-T-09 | POST /api/teacher/subjects/:id/topics | Создать тему (черновик) |
| API-T-10 | GET / PUT /api/teacher/topics/:id | Получить / сохранить тему: `{ translations, coverMediaId?, coverUrl?, materialIds[] }`; `coverUrl` (http/https) сервер скачивает в своё хранилище и проверяет как загруженную обложку (BR-FILE-06); не удалось — 422 `fieldErrors.coverUrl` |
| API-T-11 | POST /api/teacher/topics/:id/ai-draft | ИИ-черновик: ответ `{ ru: {title, description, funFact, bodyMd}, kk: {...} }` — название на языке черновика; ничего не сохраняет |
| API-T-12 | POST /api/teacher/topics/:id/publish | `{ changeNote? }` → создаёт topic_version, status = published |
| API-T-13 | POST /api/teacher/topics/:id/unpublish | Снять с публикации (PH-27) |
| API-T-14 | GET /api/teacher/topics/:id/versions | История версий (PH-25) |
| API-T-15 | GET /api/teacher/topics/:id/preview | Представление темы глазами ученика (без публикации) |
| API-T-16 | POST /api/files/upload-url | `{ kind: 'cover'|'material', topicId?, fileName, mime, size }` → `{ mediaId, uploadUrl, headers }` после проверки лимитов BR-FILE-* |
| API-T-17 | POST /api/files/:mediaId/complete | Подтвердить загрузку → постановка в очередь проверки (scan_status = pending) |
| API-T-18 | GET /api/teacher/gallery | Обложки пользователя |
| API-T-19 | GET /api/teacher/topics/:id/quiz | Квиз и вопросы |
| API-T-20 | POST /api/teacher/topics/:id/quiz/questions | Создать вопрос `QuestionDto` (6.7) |
| API-T-21 | PUT / DELETE /api/teacher/questions/:id | Изменить / архивировать вопрос |
| API-T-22 | POST /api/teacher/assignments | `{ classId, subjectId, topicId, dueAt }` → `{ id }`. Класс — свой (иначе 404); предмет — базовый (общий каталог) или свой, выданный этому классу (чужой — 404, не выдан — 422 `subjectNotGranted`); тема — опубликованная тема этого предмета (422 `topicNotInSubject` / `topicNotPublished`); `dueAt` — ISO 8601 с часовым поясом. Аудит `assignment.created`. |
| API-T-23 | GET /api/teacher/assignments | `[{ id, topicTitle, className, dueAt, counts: { submitted, inReview, graded } }]` Задания всех своих классов, поздний срок — первым. |
| API-T-24 | GET /api/teacher/review-queue | Работы на проверку (PH-29 — пустой список) |
| API-T-25 | GET /api/teacher/classes/:id/analytics | `{ avgPercent, engagement: { active, total, windowDays: 7 }, weakTopics: [{ topicId, title, students, percent, color }], attention: [{ studentId, name, lastActivityAt, reason: 'inactive' }] }` Учитываются и базовые уроки платформы, и личные уроки учителя (решение владельца 2026-10-17, см. BR-AN-02). |
| API-T-28 | GET /api/teacher/classes/:id/assignment-options | `{ subjects: [{ id, title, official, topics: [{ id, title }] }] }` — что можно назначить классу (BR-ASG-01/02): базовые предметы и свои предметы, выданные классу; только опубликованные темы. Чужой класс → 404 (итерация 10) |
| API-T-29 | GET /api/teacher/classes/:id/mastery | `?subjectId` (необязательно; по умолчанию — первый предмет API-T-28) → `{ subjects: [{ id, title, official }], subjectId, topics: [{ id, title }], students: [{ id, name }], cells: [{ studentId, topicId, status: 'mastered'|'started'|'not_started', percent }] }` — «Карта освоения»; чужой класс или недоступный предмет → 404 |
| API-T-26 | GET /api/teacher/classes/:id/roster | Ростер: минимальная версия — `[{ id, displayName, login, hasEmail }]` активных учеников (страница «Ростер» — PH-24) |
| API-T-27 | POST /api/teacher/classes/:id/students/:studentId/temporary-password | Временный пароль ученику своего класса без email → `{ temporaryPassword }` (показывается один раз); ученик меняет его при входе (API-AUTH-05) |

## 6.5 Ученик

| **ID** | **Метод и путь** | **Назначение** |
|---|------------|-----------------------------|
| API-S-01 | POST /api/student/join | `{ code }` → вступление в класс после подтверждения (BR-CLS-02) |
| API-S-02 | GET /api/student/class | `{ classId, className, teacherName, schoolName } | null` |
| API-S-03 | POST /api/student/class/leave | Выйти из класса (SM-MEM, PH-40) |
| API-S-04 | GET /api/student/catalog | `{ sections: [{ id, title, description, status: 'section' }], subjects: [{ id, title, description, status: 'available'|'soon' }] }` — `soon`: у предмета нет опубликованных тем (BR-CNT-08) |
| API-S-05 | GET /api/student/sections/:id | Предметы раздела (`status: 'available'|'soon'`, BR-CNT-08) |
| API-S-06 | GET /api/student/topics/:id | `{ id, quizId, subject: {id, title}, title, number, questionsCount, summary, funFact, bodyMd?, illustrationUrl?, illustrationAlt?, needsReview, sections: [{ id, number, title, body, illustrationUrl?, illustrationAlt? }], materials: [{ id, name, url }], next: { id, title } | null, locale }` — `materials` только со scan_status = clean, `url` и `illustrationUrl` — подписанные ссылки нашего хранилища на 10 минут (BR-FILE-04); `locale` — фактический язык урока (нет перевода → RU, REQ-ST-LES-07); `needsReview` — перевод ждёт вычитки (BR-CNT-05) |
| API-S-07 | POST /api/student/quizzes/:quizId/attempts | Начать или продолжить попытку → `{ attemptId, questions: [{ id, type, difficulty, text, options: [{id, text}] }], answered: {...} }` Тело (необязательно): `{ assignmentId }` — попытка из задания (решение по Q-18): назначение действующего класса ученика по этой теме, иначе 404; незавершённая попытка продолжается и связывается с заданием. |
| API-S-08 | POST /api/student/attempts/:id/answers | `{ questionId, optionId?, textAnswer? }` → `{ correct, correctOptionId, correctAnswer, explanation }` (PH-37); `correctAnswer` — правильный ответ «Вписать ответ», только в ответе на уже отправленный ответ (BR-QZ-01) |
| API-S-09 | POST /api/student/attempts/:id/finish | `{ scorePercent, xpAwarded, badgesAwarded[] }` |
| API-S-10 | GET /api/student/assignments | Мои задания (PH-33) `[{ id, topicId, topicTitle, subjectTitle, dueAt, status: 'not_started'|'submitted'|'graded', grade, overdue }]` — назначения действующих классов ученика по видимым ему темам, ближайший срок — первым; `overdue` — срок прошёл, а работа не сдана. `late` — сдано после срока (BR-ASG-03). |
| API-S-11 | POST /api/student/ai/conversations | `{ context: 'topic_tutor'|'general_tutor', topicId? }` → `{ id }`; `topic_tutor` — только по видимой теме (BR-VIS-01, иначе 404). У ученика один действующий диалог на тему и один общий: повторный вызов возвращает его (история после перезагрузки) |
| API-S-12 | POST /api/student/ai/conversations/:id/messages | `{ content ≤ 2000, quickAction?: 'simpler'|'more_detail'|'check_me' }` → SSE как API-PUB-06; поддержка отмены (закрытие соединения → status = partial). Вопрос сохраняется сразу вместе с событием `ai_question` (без XP, BR-XP-01; не входит в серию, BR-ST-02), ответ — по завершении: complete / partial / failed (SM-AI-MESSAGE). Пока поставщик mock или недоступен — `event: error {code: 'AI_UNAVAILABLE'}`, ответ failed, клиент показывает PH-19 «Учебный ИИ скоро будет доступен». Лимиты PH-20 — на ученика (не на IP). Чужой диалог → 404 (BR-ACL-03) |
| API-S-13 | GET /api/student/ai/conversations/:id | `{ id, context, topic: { id, title } | null, messages: [{ id, role, content, status, quickAction, createdAt }] }` — история сообщений; чужой диалог → 404 (BR-ACL-03) |
| API-S-14 | GET /api/student/progress | `?period=today|7d|30d|90d|quarter|year` → `{ range: {from, to}, compareRange, nextStep: {action, reason, href}, progress: { mastered, total, percent, deltaPercent }, streak: { days, lastActivityDate, delta } }` Плюс `period`, `availablePeriods` (четверть — только если заданы четверти, Q-23; иначе `period=quarter` → 422 `periodUnavailable`); `nextStep` — `{ action: 'assignment'|'improve_topic'|'next_topic'|'catalog', reason, href, topicTitle, dueAt, percent }`, тексты — в интерфейсе. По умолчанию `period=30d`. |
| API-S-15 | GET /api/student/achievements | `{ level, rankTitle, xpTotal, xpToNext, streakDays, badges: [{ code, title, condition, imageUrl, earned, earnedAt }], earnedCount, totalCount }` Плюс `xpPerLevel` (PH-39) для полосы прогресса; ранг — `level_translations`. |
| API-S-16 | GET /api/me/stats | `{ streakDays, xpTotal, continueTopicId }` для хедера; `streakDays` — 0, если последней активности не было ни сегодня, ни вчера (BR-ST-03); `continueTopicId` — последняя открытая и доступная тема (REQ-ST-HOME-01, PH-34) |
| API-S-17 | POST /api/student/events | `{ type: 'lesson_opened', topicId, idempotencyKey }` |
| API-S-18 | GET /api/student/subjects/:id | Страница предмета: `{ id, title, description, topics: [{ id, number, title, status: 'mastered'|'started'|'not_started' }] }` — опубликованные темы по position; предмет не виден (BR-VIS-01) → 404 |

## 6.6 Служебная поддержка

| **ID** | **Метод и путь** | **Назначение** |
|---|------------|-----------------------------|
| API-SUP-01 | GET /api/staff/tickets | Фильтры: `status, assigneeId, category, dueBefore, q` (номер или email) |
| API-SUP-02 | GET /api/staff/tickets/:id | Обращение, tech_context, сообщения, заметки, история статусов |
| API-SUP-03 | POST /api/staff/tickets/:id/assign | `{ assigneeId }` |
| API-SUP-04 | POST /api/staff/tickets/:id/reply | `{ body, templateCode? }` → email_queue; статус по SM-TICKET: шаблон «Уточнение» → waiting_user, «Решение» → resolved (если переход допустим); остальные ответы статус не меняют |
| API-SUP-05 | POST /api/staff/tickets/:id/notes | Внутренняя заметка (не отправляется клиенту) |
| API-SUP-06 | POST /api/staff/tickets/:id/status | `{ to }` — только разрешённые переходы SM-TICKET |
| API-SUP-07 | GET / POST … /api/staff/requests | Аналогично для школьных заявок (роль onboarding_agent) |
| API-SUP-08 | POST /api/inbound/email | Вебхук входящих писем; связь по токену из ticket_reply_tokens; ответ после resolved/closed → reopened |

## 6.7 Схемы DTO (Zod, packages/shared)

```ts
export const Locale = z.enum(['ru', 'kk', 'en']);
const email = z.string().trim().email().max(254);
const phone = z.string().trim().regex(/^\+?[0-9 ()-]{6,20}$/).optional().or(z.literal(''));

export const SchoolRequestDto = z.object({
  schoolName: z.string().trim().min(1).max(200),
  region: z.string().trim().max(120).optional(),
  city: z.string().trim().max(120).optional(),
  contactPerson: z.string().trim().min(1).max(200),
  phone,
  email,
  message: z.string().trim().max(5000).optional(),
});

export const SupportCategory = z.enum(['technical', 'school_onboarding', 'learning', 'account_access', 'data_privacy', 'other']);
export const SupportTicketDto = z.object({
  category: SupportCategory,
  subject: z.string().trim().min(1).max(200),
  name: z.string().trim().max(200).optional(),
  email,
  phone,
  description: z.string().trim().min(1).max(10000),
  techContext: z.object({ route: z.string(), appVersion: z.string(), locale: Locale,
    dataSaver: z.boolean(), userAgent: z.string().max(300) }).optional(),
});

const LangText = z.object({ text: z.string().trim().min(1).max(1000), explanation: z.string().max(2000).optional() });
export const QuestionDto = z.object({
  type: z.enum(['single_choice', 'true_false', 'text_input']),
  difficulty: z.enum(['easy', 'medium', 'hard']),
  translations: z.record(Locale, LangText).refine(t => Object.keys(t).length >= 1),
  options: z.array(z.object({ translations: z.record(Locale, z.string().trim().min(1).max(300)),
    isCorrect: z.boolean() })).optional(),
  textAnswer: z.string().trim().max(300).optional(),
}).superRefine((q, ctx) => {
  if (q.type !== 'text_input') {
    const n = q.options?.length ?? 0, correct = q.options?.filter(o => o.isCorrect).length ?? 0;
    if (n < 2) ctx.addIssue({ code: 'custom', path: ['options'], message: 'min2' });
    if (correct !== 1) ctx.addIssue({ code: 'custom', path: ['options'], message: 'exactlyOneCorrect' });
  } else if (!q.textAnswer) ctx.addIssue({ code: 'custom', path: ['textAnswer'], message: 'required' });
});
```

Тексты ошибок валидации — ключи i18n; пример RU для email: «Введите email, например name@example.com».

## 6.8 Battle (итерация 10.5)

Общие правила — 6.1: Zod-схемы в `packages/shared`, формат ошибок API-GEN-04, CSRF для изменяющих запросов, OpenAPI. Уточняющий код ошибки Battle передаётся в `fieldErrors` (как `subjectNotGranted` в API-T-22): `{ "code": "CONFLICT", "fieldErrors": { "battle": "questionClosed" } }`. Чужой тест или сессия → 404 (API-GEN-08).

**Учитель — тесты** (`teacher`, только владелец — BR-BTL-12)

| **ID** | **Метод и путь** | **Назначение** |
|---|------------|-----------------------------|
| API-BTL-01 | GET /api/teacher/battles | `?archived=false` → `[{ id, title, locale, questionsCount, gamesCount, lastPlayedAt, archived }]` — мои тесты |
| API-BTL-02 | POST /api/teacher/battles | `{ title, description?, locale }` → 201 `{ id }` |
| API-BTL-03 | GET /api/teacher/battles/:id | Тест с вопросами и вариантами (с правильными — это владелец) |
| API-BTL-04 | PATCH /api/teacher/battles/:id | `{ title?, description?, locale?, archived? }` |
| API-BTL-05 | POST /api/teacher/battles/:id/duplicate | Копия теста (неархивные вопросы) → 201 `{ id }` |
| API-BTL-06 | POST /api/teacher/battles/:id/questions | `BattleQuestionDto` → 201 `{ id }`; больше 50 вопросов → 422 `tooManyQuestions` |
| API-BTL-07 | PATCH /api/teacher/battles/:id/questions/:qid | `BattleQuestionDto` — вопрос и варианты целиком |
| API-BTL-08 | DELETE /api/teacher/battles/:id/questions/:qid | Удалить вопрос (архивирование, `archived_at`) → 204 |
| API-BTL-09 | POST /api/teacher/battles/:id/questions/reorder | `{ questionIds: [...] }` — все неархивные вопросы теста в новом порядке |
| API-BTL-10 | GET /api/teacher/battles/import-sources | `[{ subjectId, subjectTitle, official, topics: [{ id, title, eligibleCount, questions: [{ id, text, type }] }] }]` — свои темы и базовые темы платформы с подходящими вопросами (BR-BTL-10; вопросы — для выбора чекбоксами в BT-T02) |
| API-BTL-11 | POST /api/teacher/battles/:id/import | `{ topicId, questionIds? }` → `{ imported }` — копии вопросов (время по умолчанию, PH-45) |

`BattleQuestionDto` (6.7): `{ type: 'single_choice'|'true_false', text (1–300), imageMediaId?, timeLimitSec ∈ {5,10,20,30,60,90}, options: [{ text (1–150), isCorrect }] }` — `single_choice`: 2–4 варианта, ровно один правильный; `true_false`: ровно два варианта, тексты «Верно» / «Неверно» задаёт сервер на языке теста, правильный — один.

**Учитель — сессии** (ведущий — `battle_sessions.host_id = me`)

| **ID** | **Метод и путь** | **Назначение** |
|---|------------|-----------------------------|
| API-BTL-20 | POST /api/teacher/battles/:id/sessions | `{ classId, settings }` → 201 `{ sessionId, code }`; класс свой (иначе 404); тест без вопросов → 422 `noQuestions`; у вопроса нет правильного варианта → 422 `noCorrectOption`; больше 3 активных сессий → 409 `tooManyActiveSessions` (BR-BTL-05) |
| API-BTL-21 | GET /api/teacher/battle-sessions/:sid | Снимок ведущего: фаза, версия, участники, текущий вопрос с правильным вариантом, счётчики, `serverNow` |
| API-BTL-22 | GET /api/teacher/battle-sessions/:sid/events | SSE-поток ведущего (6.9) |
| API-BTL-23 | POST /api/teacher/battle-sessions/:sid/start | `lobby → question(0)`; без участников → 422 `noParticipants` |
| API-BTL-24 | POST /api/teacher/battle-sessions/:sid/close-question | Досрочно закрыть вопрос → `reveal` |
| API-BTL-25 | POST /api/teacher/battle-sessions/:sid/next | `reveal → leaderboard → question(i+1)`; на последнем вопросе → `finished` |
| API-BTL-26 | POST /api/teacher/battle-sessions/:sid/finish | Досрочно завершить игру (итог по отвеченным вопросам) |
| API-BTL-27 | POST /api/teacher/battle-sessions/:sid/cancel | Отменить (только из `lobby`) |
| API-BTL-28 | POST /api/teacher/battle-sessions/:sid/participants/:pid/kick | Выгнать участника |
| API-BTL-29 | GET /api/teacher/battle-sessions | `?battleId=&classId=&cursor=&limit=` (API-GEN-07) → `{ items: [{ id, battleTitle, className, status, participantsCount, questionsCount, startedAt, finishedAt }], nextCursor }` — история игр |
| API-BTL-30 | GET /api/teacher/battle-sessions/:sid/results | Итоги: пьедестал, таблица, по вопросам (доля правильных, распределение вариантов, среднее время), ответы по участникам |
| API-BTL-31 | GET /api/teacher/battle-sessions/:sid/results.csv | Экспорт итогов: UTF-8 с BOM, разделитель `;` |

Переходы API-BTL-23…28 принимают `{ expectedVersion }`; версия не совпала → 409 `staleState`, в теле ошибки — поле `snapshot` (свежий снимок API-BTL-21). Повтор уже выполненного перехода ничего не меняет (SM-BTL).

**Ученик** (`student`; участник — BR-BTL-02)

| **ID** | **Метод и путь** | **Назначение** |
|---|------------|-----------------------------|
| API-BTL-40 | POST /api/student/battles/join | `{ code }` → `{ sessionId }`; 404 `codeNotFound` (в том числе код чужого класса — без подробностей), 409 `kicked`, 409 `full`, 409 `alreadyStarted` (позднее подключение выключено); лимит — BR-BTL-01 |
| API-BTL-41 | GET /api/student/battle-sessions/:sid | Снимок ученика: фаза, версия, вопрос **без правильного ответа**, мой ответ, мой счёт и место (после `reveal`), число участников, `serverNow` |
| API-BTL-42 | GET /api/student/battle-sessions/:sid/events | SSE-поток ученика (6.9) |
| API-BTL-43 | POST /api/student/battle-sessions/:sid/answers | `{ questionIndex, optionPosition, clientAnswerId }` → `{ accepted: true }` — без правильности (BR-BTL-03); 409 `questionClosed`, 409 `alreadyAnswered` |
| API-BTL-44 | POST /api/student/battle-sessions/:sid/leave | Выйти из игры → 204 |
| API-BTL-45 | GET /api/student/battle-sessions | `?cursor=&limit=` → `{ items: [{ id, battleTitle, teacherName, finishedAt, rank, participantsCount, correctCount, questionsCount }], nextCursor }` — мои прошедшие Battle |
| API-BTL-46 | GET /api/student/battle-sessions/:sid/results | После `finished`: пьедестал, полная таблица, мои ответы по вопросам с правильными вариантами; до `finished` → 409 `notFinished` |

Чужая сессия или сессия, где ученик не участник, → 404. Выгнанный ученик получает в снимке `kicked: true` и не может отвечать (409 `kicked`); вышедший из игры — 409 `notInGame` до повторного входа по коду. Прочие коды: чужой класс при запуске — 404 `classNotFound`, чужой участник при выгоне — 404 `participantNotFound`, недопустимый переход — 409 `INVALID_TRANSITION` (`invalidTransition`) со снимком, код не удалось подобрать за 10 попыток — 503 `codeUnavailable`, ответ чаще 1 в 200 мс — 429.

## 6.9 События Battle (SSE)

Формат: `id: {stateVersion}-{seq}`, `event: <тип>`, `data: <JSON>`; каждые 15 с — комментарий `: ping` (и отметка `last_seen_at` участника). При подключении и переподключении первым приходит `snapshot`. Поток — только с cookie-сессией; не больше 2 одновременных потоков на пользователя в одной сессии (лишние закрываются, старейший первым).

| **Событие** | **Кому** | **Данные** |
|---|---|---|
| `snapshot` | всем при подключении | Полное состояние для роли (как API-BTL-21 / API-BTL-41) + `serverNow` |
| `participant_joined` / `participant_left` / `participant_kicked` | ведущему — с участником; ученикам — только счётчик | `{ participant?, participantsCount }` |
| `question_started` | всем | `{ version, index, total, type, text, imageUrl?, options: [{ position, text }], startedAt, deadlineAt, serverNow }` |
| `answer_progress` | ведущему, не чаще раза в 250 мс | `{ answered, active }` |
| `answer_accepted` | ответившему ученику | `{ index }` |
| `question_revealed` | всем | ведущему: `{ correctPosition, distribution: [{ position, count }], avgResponseMs }`; ученику: `{ correctPosition, myPosition, isCorrect, myCorrectCount, myRank, participantsCount }` |
| `leaderboard` | всем | `{ top: [{ rank, displayName, correctCount }] (5), me?: { rank, correctCount } }` |
| `finished` | всем | `{ podium, table, me? }` — таблица всех мест с именами |
| `cancelled` | всем | `{ reason }` |
| `kicked` | выгнанному | `{}` — клиент закрывает поток и показывает сообщение |

- Оставшееся время на клиенте: `deadlineAt − (Date.now() + (serverNow − clientNowAtReceipt))`.
- Переподключение — с нарастающей задержкой 1, 2, 4, 8 с (не больше 10 с) и новым `snapshot`; после 3 неудачных попыток — баннер «Нет соединения, переподключаемся…».
- Персональные данные ученика (`question_revealed`, `leaderboard.me`, `finished.me`) формирует экземпляр api, держащий соединение ученика; через Redis Pub/Sub идёт только общее событие — правильность чужих ответов никому не уходит.
- В режиме «Экономия трафика» данные событий не меняются.

# 7. Бизнес-правила

## 7.1 Доступ и видимость

```text
BR-VIS-01  canStudentSeeTopic(student, topic):
             topic.status == 'published'
             AND topic.archived_at IS NULL
             AND ( subject(topic).in_public_catalog
                   OR EXISTS class_subject_access csa
                        JOIN class_memberships m ON m.class_id = csa.class_id
                      WHERE csa.subject_id = topic.subject_id AND csa.revoked_at IS NULL
                        AND m.student_id = student.id AND m.status = 'active' )
           Применяется к: API-S-04..S-09, S-12 (topic_tutor), выдаче файлов материалов.
BR-VIS-02  Черновик (status='draft') MUST NOT отдаваться ученику ни одним эндпоинтом. Предпросмотр учителя (API-T-15)
           доступен только владельцу предмета.
BR-VIS-03  Флаг каталога (subjects.in_public_catalog), выдача классу (class_subject_access) и публикация (topics.status) —
           три независимых признака; объединять в одно поле запрещено.
BR-ACL-01  Учитель изменяет только subjects.owner_id = me и всё, что к ним относится (topics, questions, materials).
BR-ACL-02  Учитель работает только со своими классами (classes.teacher_id = me): выдача, задания, аналитика, коды.
BR-ACL-03  Ученик читает только свои attempts, events, stats, badges, ai_conversations, submissions.
BR-ACL-04  Служебные роли не имеют доступа к /api/teacher/*, /api/student/*; учебные роли — к /api/staff/*.
BR-ACL-05  Базовый контент (subjects.is_official = true, его темы, разделы, вопросы, картинки) не изменяется ни одним
           эндпоинтом API: у него нет владельца, поэтому API-T-* отвечают 404 (BR-ACL-01), прочие роли — 401/403.
           Изменение — только файлами content/ и командой импорта (BR-CNT-01).
BR-VIS-04  canGuestSeeTopic(topic): topic.status == 'published' AND topic.archived_at IS NULL
             AND subject(topic).is_official AND subject(topic).in_public_catalog AND subject(topic).archived_at IS NULL.
           Гость видит каталог, предметы и «Обзор» только базовых уроков (API-PUB-10..13); личные уроки учителей
           гостю не видны, даже если они в общем каталоге. Квиз, учебный ИИ, события, XP и прогресс — только после входа.
```

## 7.2 Квиз

```text
BR-QZ-01  Правильный ответ (is_correct, text_answer) MUST NOT присутствовать в ответах API до ответа на вопрос.
BR-QZ-02  single_choice и true_false: ровно один правильный вариант (ux_one_correct + Zod).
          true_false: два фиксированных варианта «Верно» / «Неверно» (PH-28).
BR-QZ-03  text_input: сравнение normalize(a) == normalize(b), где normalize = trim, схлопнуть пробелы, lower-case (PH-28).
BR-QZ-04  Проверка ответа — сразу после выбора (PH-37): возвращаются correct, correctOptionId, explanation.
BR-QZ-05  score_percent = round(100 * correct_answers / questions_count, 2) при finish.
BR-QZ-06  Попытки не ограничены; в зачёт идёт лучшая (topic_mastery.best_percent = max). Незавершённая попытка
          (in_progress) продолжается при повторном входе (API-S-07 возвращает уже данные ответы).
BR-QZ-07  Тема освоена: best_percent >= 80 (PH-38) → mastered_at = now() при первом достижении.
BR-QZ-08  Попытка связана с topic_version_id опубликованной версии на момент старта.
BR-QZ-09  Гостевой пробный вопрос: questions.is_demo = true; баллы и события не начисляются. В квизе своей темы пробный
          вопрос — обычный вопрос ученика.
```

## 7.3 Геймификация (PH-39)

```text
BR-XP-01  События и XP:
            quiz_finished                → +10 XP
            quiz_finished с score >= 80  → ещё +10 XP (reason = 'quiz_high_score')
            lesson_opened (первое для темы) → +5 XP
BR-XP-02  Идемпотентность: каждая запись xp_ledger уникальна по (student_id, source_event_id, reason);
          повторная обработка события не начисляет XP повторно.
BR-XP-03  level = floor(xp_total / 100) + 1; xpToNext = 100 * level - xp_total.
          Ранг: level 1 → «Новичок»; иначе «Уровень N».
BR-BDG-01 Бейджи и правила (rule jsonb):
            first_step        quiz_finished count >= 1                         «Первый шаг» — «Пройден первый квиз»
            warmup            streak >= 3                                       «Разогрев» — «Серия из 3 дней подряд»
            week_power        streak >= 7                                       «Неделя силы» — «Серия из 7 дней подряд»
            marathon          streak >= 30                                      «Марафонец» — «Серия из 30 дней подряд»
            topic_mastered    mastered topics >= 1                              «Тема освоена» — «Первая тема пройдена на 80%+»
            five_topics       mastered topics >= 5                              «Пятёрка знаний» — «5 тем освоено»
            erudition         mastered topics >= 10                             «Эрудиция» — «10 тем освоено»
            subject_conquered all published topics of a subject mastered        «Предмет покорён» — «Все темы предмета освоены»
            erudite           level >= 5                                        «Эрудит» — «Достигнут 5-й уровень»
            legend            level >= 10                                       «Легенда» — «Достигнут 10-й уровень»
            comeback          topic mastered after a failed attempt (<50%)      «Исправился» — «Тема, которая сначала не давалась, потом взята»
            bug_fixing        5 such topics                                     «Работа над ошибками» — «Пять тем вытянуто с неудачной попытки»
          Пороги «неудачной попытки» (<50%) — PH-39. Ещё 5 бейджей не создаются; totalCount = 12.
BR-BDG-02 Бейдж выдаётся один раз (PK student_id, badge_id).
BR-XP-04  Начисление XP, пересчёт уровня и серии и выдача бейджей — синхронно, в транзакции события (finish, lesson_opened);
          отдельной очереди пересчёта нет (решение по Q-17). Серия в хедере учитывает дату последней активности (API-S-16).
```

## 7.4 Показатели (PH-38)

```text
BR-ST-01  Часовой пояс расчётов — PLATFORM_TZ (UTC+5).
BR-ST-02  День активности — календарный день, в котором есть learning_events типа quiz_finished или lesson_opened.
BR-ST-03  streak_current = число подряд идущих дней активности, заканчивающихся сегодня или вчера; иначе 0.
BR-ST-04  Периоды: today; 7d/30d/90d — последние N дней включая сегодня; quarter — текущая четверть из app_config
          'progress.quarters' (PH-38), на каникулах и летом — последняя начавшаяся; year — 'progress.school_year'
          (01.09–25.05, решение владельца 2026-10-17).
          compareRange — предыдущий период той же длины.
BR-ST-05  progress.total = число опубликованных тем во всех предметах, где у ученика есть хотя бы одно событие;
          progress.mastered = число освоенных из них; percent = round(100 * mastered / total, 1). Значения — на конец
          периода, но не позже сегодняшнего дня (события и mastered_at по min(range.to, сегодня) включительно); deltaPercent — разница с тем же расчётом на конец
          compareRange; streak.days и streak.delta — так же (серия на range.to минус серия на compareRange.to).
          Базовые и личные предметы считаются одинаково.
BR-ST-06  nextStep: (1) незавершённое назначение с ближайшим сроком → (2) начатая тема с минимальным best_percent < 80
          → (3) следующая тема после последней открытой → (4) каталог. «Незавершённое» — без сдачи и со сроком
          в будущем; темы — только видимые ученику.
```

## 7.5 Аналитика класса (PH-30)

```text
BR-AN-01  Данные только по выбранному классу и его активным ученикам.
BR-AN-02  avgPercent = среднее best_percent учеников класса по темам, назначенным классу (assignments);
          если назначений нет — по всем темам выданных классу предметов и базовых предметов платформы, которые
          ученики проходили (решение владельца 2026-10-17). Округление — до целого процента.
BR-AN-03  engagement.active = число учеников с learning_events за последние 7 дней; total = число активных учеников.
BR-AN-04  weakTopics: по каждой теме из набора BR-AN-02 — students = число учеников класса с попытками; percent = среднее best_percent;
          сортировка по возрастанию percent; максимум 10 строк.
          color: percent < 50 → 'red'; 50 ≤ percent < 80 → 'blue'; percent ≥ 80 → 'green'.
BR-AN-05  attention: ученики без learning_events 7 дней и более; reason = 'inactive'; lastActivityAt — время последнего события
          (null — событий не было); сначала те, кто дольше неактивен.
```

## 7.6 Задания

```text
BR-ASG-01 topic MUST принадлежать subject; класс MUST принадлежать учителю; subject — свой или is_official.
BR-ASG-02 Список тем в форме фильтруется по выбранному предмету; при смене предмета выбранная тема сбрасывается.
BR-ASG-03 Сдача (PH-29, решение владельца 2026-10-17): завершение попытки квиза темы создаёт/обновляет submission
          каждого назначения по этой теме в действующих классах ученика, выданного до завершения попытки, — и попытки
          из назначения (attempt.assignment_id), и попытки из урока: status = 'graded', grade = score_percent (лучший).
          Попытки, завершённые до выдачи назначения, не засчитываются. После срока сдача принимается и помечается
          «Сдано после срока» (submitted_at > due_at; SPEC сдачу после срока не запрещает).
          Счётчики: submitted = число submissions; inReview = status 'in_review' (сейчас всегда 0); graded = status 'graded'.
          Категории пересекаются (сданная и оценённая работа учитывается в обоих счётчиках).
          Каждая оценка — в audit_log (submission.graded,
          автор — система), REQ-NFR-SEC-05.
```

## 7.7 Классы

```text
BR-CLS-01 Код класса: 6 символов из алфавита 23456789ABCDEFGHJKLMNPQRSTUVWXYZ; хранится только hash (SHA-256 с солью);
          срок 30 дней; ввод нормализуется: trim, upper-case, удаление пробелов (PH-07).
BR-CLS-02 До входа — только проверка годности кода (API-PUB-08) без данных класса. Вступление — после входа
          и подтверждения; повторное вступление в тот же класс не создаёт второй записи (ux_membership_active).
BR-CLS-03 Leave: membership.status = 'left', left_at = now(); доступ к предметам класса закрывается (BR-VIS-01);
          личные результаты сохраняются.
BR-CLS-04 Ученик регистрируется сам (PH-17 = true): имя, логин, пароль, email и школа — необязательные; код класса
          необязателен. Верный код — ученик сразу становится членом класса, школа берётся из класса; неверный код —
          ошибка без создания аккаунта. Без класса ученик может подключиться позже (/join, API-S-01).
BR-CLS-05 Восстановление пароля: с email — по письму (API-AUTH-04); без email — учитель класса задаёт временный пароль
          (API-T-27), ученик обязан сменить его при входе (API-AUTH-05). Роль «завуч» — TODO(OWNER).
```

## 7.8 Файлы

```text
BR-FILE-01 Обложка: mime ∈ {image/jpeg, image/png, image/webp, image/gif}; size ≤ 5 МБ (1 МБ = 1 048 576 байт).
BR-FILE-02 Материалы: расширение и сигнатура ∈ {pdf, docx, xlsx, pptx, odt, txt, csv}; size ≤ 25 МБ;
           на тему ≤ 20 файлов и ≤ 200 МБ суммарно (проверка до выдачи upload-url и повторно после загрузки).
BR-FILE-03 После загрузки: проверка ClamAV и olevba; найден вирус или макрос → scan_status = 'rejected',
           файл удаляется из хранилища, учителю показывается ошибка «Файл отклонён: обнаружены макросы или вредоносный код».
BR-FILE-04 Ученикам отдаются только файлы со scan_status = 'clean' через подписанные ссылки сроком 10 минут.
BR-FILE-05 Галерея обложек = media_files(kind='cover', owner_id = me). Выбор обложки — последнее действие побеждает (PH-26).
BR-FILE-06 Обложка по ссылке учителя (REQ-TCH-TOP-04): при сохранении темы сервер скачивает картинку в своё хранилище
           (media_files kind='cover', галерея учителя) и проверяет как загруженную: BR-FILE-01 (тип, ≤ 5 МБ, сигнатура),
           затем BR-FILE-03. Ученику внешняя ссылка не отдаётся — только файл из хранилища (BR-FILE-04).
           Защита от SSRF: только http/https, порты 80/443, без учётных данных в адресе; все адреса имени после DNS —
           публичные (запрещены 0.0.0.0/8, 10/8, 100.64/10, 127/8, 169.254/16, 172.16/12, 192.168/16 и прочие служебные,
           ::1, fc00::/7, fe80::/10, IPv4-mapped); соединение — на проверенный адрес; перенаправления (≤ 3) проверяются
           заново; таймаут 10 с; чтение прерывается после 5 МБ. Не удалось скачать — учителю ошибка у поля ссылки.
BR-FILE-07 Незавершённые загрузки: worker раз в сутки удаляет записи scan_status = 'pending' старше 24 часов, загрузка
           которых не подтверждена (API-T-17 не вызван), и их объект в хранилище, если он есть. Подтверждённые файлы,
           ожидающие проверки BR-FILE-03, не удаляются.
```

## 7.9 Формы и поддержка

```text
BR-FRM-01 Сохранение заявки/обращения, запись idempotency_keys и outbox_events('email.confirmation') — одна транзакция.
BR-FRM-02 public_number: заявки 'SR-' + YYMMDD + '-' + 4 цифры; обращения 'T-' + YYMMDD + '-' + 4 цифры.
BR-FRM-03 Письмо-подтверждение содержит номер, тип, способ ответа; без полного текста обращения.
BR-FRM-04 Ошибка отправки письма не отменяет сохранённую запись.
BR-SUP-01 Повторное открытие: входящий ответ пользователя на обращение в статусе resolved или closed → reopened.
BR-SUP-02 Автозакрытие: resolved → closed через 7 дней без ответа пользователя (cron в worker).
BR-SUP-03 Все смены статуса и ответственного пишутся в ticket_status_history и audit_log.
```

## 7.10 ИИ

```text
BR-AI-01 Клиент никогда не обращается к поставщику ИИ напрямую; только через API (LLMProvider).
BR-AI-02 В промпт передаются: системная инструкция, база знаний (публичный) или текст текущей темы (topic_tutor),
         уровень объяснения 'beginner', последние 20 сообщений. MUST NOT передаваться: email, телефон, ФИО, ID ученика.
BR-AI-03 Ответ ИИ не вызывает никаких изменяющих операций (нет инструментов с записью).
BR-AI-04 Отмена клиентом → сообщение сохраняется со status = 'partial' и пометкой «Ответ прерван».
BR-AI-05 Гостевая история хранится только в памяти вкладки; на сервере не сохраняется.
BR-AI-06 Пока LLM_PROVIDER = 'mock' или поставщик недоступен — поведение PH-19.
BR-AI-07 Публичный помощник: ссылки в ответах только на внутренние маршруты раздела 4 и URL атласов из конфигурации;
         остальные ссылки удаляются при санитизации. Учебный ИИ — та же серверная санитизация (REQ-NFR-SEC-06).
BR-AI-08 (решение владельца 2026-10-17) Учебный ИИ не решает за ученика:
         объясняет, подсказывает и задаёт наводящие вопросы; на вопросы квиза текущей темы не даёт готового ответа
         (вариант, букву, число или слово), даже если ученик просит прямо или просит «забыть правила». В промпт topic_tutor
         передаются тексты вопросов квиза темы без вариантов, правильных ответов и объяснений; при «Проверь меня» ИИ
         задаёт свои вопросы, а не вопросы квиза.
BR-AI-09 Текст текущей темы (topic_tutor, решение владельца 2026-10-17): снимок опубликованной версии на языке ученика
         (нет перевода — RU, REQ-ST-LES-07): название, описание, интересный факт, текст урока и все разделы аккордеона.
```

## 7.11 Базовая программа платформы (этап 8.6)

```text
BR-CNT-01 Источник правды базовых уроков — файлы content/. Создаёт и меняет их разработчик по решению владельца
          командой `pnpm content:import`; через сайт и API базовые уроки не меняет никто (BR-ACL-05). Деления на классы
          (годы обучения) нет (1.3). Кто готовит контент — TODO(OWNER).
BR-CNT-02 Формат (docs/CONTENT_GUIDE.md): content/<раздел>/section.yaml, content/<раздел>/<предмет>/subject.yaml,
          content/<раздел>/<предмет>/<тема>/{ru.md, kk.md, en.md, quiz.yaml, media/}; каждый базовый предмет — в разделе
          (предметов вне разделов нет). Порядок — position: раздела в section.yaml, предмета в разделе — в subject.yaml
          (subjects.position), темы — в ru.md; номера уникальны на своём уровне. Тема — Markdown с YAML-заголовком, один файл на язык; разделы аккордеона —
          заголовки «## Название {#код}». Разделы аккордеона есть только у базовых уроков (редактор учителя их не
          поддерживает — TODO(OWNER)).
BR-CNT-03 До записи проверяются все файлы: YAML-схемы, обязательные поля, длины 5.4, коды (a-z, 0-9, «-», «_»)
          и их уникальность, ссылки на картинки, вопросы — по BR-QZ-02 и QuestionDto. Любая ошибка → импорт ничего
          не меняет (одна транзакция), выводит все ошибки в виде «файл: поле — причина» и завершается с кодом 1.
BR-CNT-04 Сопоставление — по постоянным кодам (catalog_sections.code, subjects/topics/topic_sections/questions.code).
          Повторный запуск без изменений ничего не меняет. Изменённая тема (хеш снимка) → новая topic_version
          и публикация; тема, удалённая из файлов → status = 'draft' (снята с публикации, строки и прогресс учеников
          сохраняются); вопрос, удалённый из quiz.yaml → archived_at. Импорт управляет только строками с кодом.
BR-CNT-05 Языки: ru.md обязателен; kk.md и en.md необязательны и содержат review: needs_review | reviewed. Переводы
          готовит ИИ, до вычитки человеком — needs_review (topic_translations.needs_review), ученик видит «На проверке».
          Нет файла языка — ученику показывается RU с пометкой «Урок пока доступен на русском» (REQ-GEN-PREF-02).
BR-CNT-06 Картинки — только в content/.../media/: WEBP, PNG или JPG (сигнатура совпадает с расширением), не больше
          300 КБ (307 200 байт); у каждой в YAML — источник (source) и лицензия: own (собственная), CC0 или
          public-domain. Проверка — в импорте и в CI (`pnpm content:check`). Импорт кладёт файл в наше хранилище
          (media_files: kind = 'illustration', owner_id NULL, ключ по sha256 — повтор не дублирует, scan_status = 'clean'
          после проверки типа, сигнатуры и размера — как у обложек, BR-FILE-01); ученику — подписанные ссылки (BR-FILE-04).
BR-CNT-07 Автор версий импорта — системный пользователь «Импорт» (users.status = 'system', без пароля и ролей).
          Каждый запуск с изменениями пишется в audit_log: actor = «Импорт», entity_type = 'content_import',
          action = 'content.import', after = сводка (создано, обновлено, снято с публикации).
BR-CNT-08 Предмет без опубликованных тем — статус «Скоро», карточка не кликабельна: каталог ученика и гостя
          (API-S-04/05, API-PUB-10/11) и /subjects (API-PUB-01).
```

## 7.12 Battle (итерация 10.5)

Battle — живая викторина для класса: учитель собирает Battle-тест, запускает игровую сессию с кодом, ученики класса входят по коду и одновременно отвечают на время; в конце — рейтинг и пьедестал. Экран ведущего у учителя (подходит для проектора), «пульт» для ответов у ученика. Транспорт реального времени: SSE (сервер → клиент) + POST (клиент → сервер) + Redis Pub/Sub между экземплярами api; PostgreSQL — источник истины, api без состояния, время — только серверное. Код событий изолирован за интерфейсом `BattleRealtime` (замена транспорта на WebSocket — только в этом слое).

```text
BR-BTL-01 Код сессии: 3 латинские буквы A–Z и 3 цифры 1–9 (`^[A-Z]{3}[1-9]{3}$`, например KTR583; PH-45, Q-BTL-10);
          генерация crypto.randomInt; уникален среди активных сессий (lobby, in_progress — частичный индекс
          ux_battle_active_code), после завершения или отмены освобождается; при коллизии до 10 повторов, затем 503.
          Ввод: trim, удаление пробелов, upper-case («ktr 583» → KTR583). Хранится открыто (короткоживущий, показывается
          на проекторе). Лимит ввода: 10 попыток за 10 минут на ученика и 30 на IP (API-GEN-06); ответ «код не найден»
          одинаков для несуществующего и чужого кода.
BR-BTL-02 Вход по коду (PH-45 battle.join_scope = 'class', Q-BTL-01): только ученик с активным членством в классе сессии.
          Выгнанный — 409 kicked; лимит участников PH-45 max_participants (100, Q-BTL-08) — 409 full; после старта —
          только при настройке «Позднее подключение» (Q-BTL-03), иначе 409 alreadyStarted; пропущенные вопросы —
          без ответа. Повторный вход тем же аккаунтом (обрыв связи, «Выйти из игры») — та же строка участника, пока
          сессия активна.
BR-BTL-03 Ответы: один раз на вопрос, изменить нельзя. Принимается ответ, пришедший не позже deadline_at + 500 мс;
          позже — 409 questionClosed. response_ms = answered_at − question_started_at (оба момента серверные).
          Повтор с тем же clientAnswerId → 200 и прежний результат; другой вариант на тот же вопрос → 409 alreadyAnswered.
          Правильность до раскрытия MUST NOT сообщаться ни ученику, ни в сетевых ответах («Ответ принят»).
          Вопрос закрывается досрочно, когда ответили все активные участники (не выгнанные, не вышедшие, на связи
          за последние 30 с). Ответы — не чаще 1 запроса в 200 мс на участника.
BR-BTL-04 Рейтинг: (1) correct_count по убыванию; (2) correct_time_ms — сумма response_ms правильных ответов — по
          возрастанию; (3) при полном равенстве — одно место (два вторых, затем четвёртое). Выгнанные в рейтинг не
          входят; вышедшие сами остаются с набранным результатом. Итоги (final_rank, correct_count, correct_time_ms,
          answered_count) пишутся в battle_participants при переходе в finished; пересчёт по battle_answers даёт тот же
          результат. Пьедестал — места 1–3 с учётом совпадений (может быть больше трёх человек), остальные — таблица.
BR-BTL-05 Сессия: запускается из теста для своего класса с настройками; при запуске замораживается снимок вопросов
          (questions_snapshot) — правка теста не влияет на идущую игру и историю. У учителя не больше 3 активных
          сессий (не finished и не cancelled) — иначе 409 tooManyActiveSessions.
BR-BTL-06 Срок жизни: лобби без старта закрывается через 60 минут, игра без активности — через 30 минут
          (status = cancelled, cancel_reason = 'expired'); проверка — задача worker раз в минуту.
BR-BTL-07 Участники: имя в игре — из профиля, «имя и первая буква фамилии» (первое слово display_name + первая буква
          второго слова с точкой: «Асель К.»; одно слово — как есть; PH-45 display_name, Q-BTL-07); свои ники не
          вводятся. Учитель может выгнать участника (в лобби и в игре) — вернуться в эту сессию нельзя. Обрыв связи — не
          выход. «Выйти из игры» — left_at; повторный вход по коду возможен, пока сессия активна.
BR-BTL-08 Переходы SM-BTL — одна транзакция с SELECT … FOR UPDATE строки сессии и проверкой ожидаемых фазы, номера
          вопроса и state_version; повторный или запоздавший переход ничего не меняет. Каждое изменение состояния
          увеличивает state_version; события несут version, клиент игнорирует события со старой версией. Переходы
          выполняет одна реализация (`packages/db/src/battle`), её вызывают api (BattleEngine) и worker (очередь battle:
          таймер закрытия вопроса на deadline_at + 500 мс, автопереход).
BR-BTL-09 Battle не начисляет XP и не влияет на освоение тем, «Мои показатели», задания и аналитику класса
          (PH-45 xp.enabled = false, Q-BTL-04).
BR-BTL-10 Battle-тест: владелец — учитель; название ≤ 120, описание ≤ 500, язык содержания RU/KK/EN (перевода нет);
          1–50 вопросов. Вопрос: текст ≤ 300, необязательная картинка — только файл галереи учителя (загрузка как
          обложка, BR-FILE-01/03; ученику — подписанная ссылка BR-FILE-04, только clean); типы single_choice (2–4
          варианта, ровно один правильный) и true_false (Q-BTL-05); text_input не поддерживается; время 5/10/20/30/60/90 с,
          по умолчанию 20 (Q-BTL-02). Импорт — копирование вопросов single_choice и true_false квиза своей темы или
          базовой темы платформы (текст и варианты на языке теста, иначе RU; подходят вопросы не больше чем с 4 вариантами и с текстами в пределах лимитов Battle — 300 и 150 символов, тексты не обрезаются); правка копии не
          меняет исходный квиз. Тест можно дублировать и архивировать; тест с прошедшими сессиями не удаляется — только
          архив.
BR-BTL-11 Удаление данных ученика (запрос «Мои данные», PH-08; исполняет сотрудник: `pnpm battle:anonymize --student=<id>`) распространяется на Battle: ответы ученика удаляются,
          в чужой истории и итогах участник показывается как «Участник» (display_name), итоговые числа сохраняются.
          Выход из класса и архивирование класса не удаляют прошедшие результаты.
BR-BTL-12 Права: тесты и сессии видит и меняет только учитель-владелец (ведущий); остальным — 404. Ученик — только
          сессии, где он участник. Служебные роли доступа не имеют (BR-ACL-04). Все изменяющие запросы — с CSRF;
          SSE — только с cookie-сессией.
```

**Настройки сессии** (`battle_sessions.settings`)

| **Настройка** | **По умолчанию** | **Описание** |
|---|---|---|
| Класс | обязательно | Войти могут только активные участники класса (BR-BTL-02) |
| Перемешать вопросы | выкл | Один порядок для всех участников |
| Перемешать варианты | выкл | Один порядок для всех; цвета и фигуры привязаны к позиции |
| Промежуточный рейтинг | вкл (Q-BTL-09) | Топ-5 после каждого вопроса, кроме последнего |
| Автопереход | выкл | После `reveal` через 5 с и после `leaderboard` через 5 с — без нажатия |
| Позднее подключение | выкл (Q-BTL-03) | Вход после старта; пропущенные вопросы — без ответа |
| Максимум участников | 100 (Q-BTL-08) | Лимит сессии (BR-BTL-02) |

**Нагрузочные цели** (проверяются k6, этап B6): одна сессия — 100 участников, вопрос 10 с, все отвечают в первые 3 с: p95 «ответ → `answer_accepted`» ≤ 300 мс, p95 «закрытие → `question_revealed` у всех» ≤ 1 с, без потерянных ответов; 20 одновременных сессий по 40 участников на одном экземпляре api без ошибок; перезапуск экземпляра api посреди вопроса — все клиенты переподключились за ≤ 10 с, ответы не потеряны, игра продолжилась.

**Вопросы владельцу** (docs/BATTLE_TZ.md, раздел 12) — `TODO(OWNER)`; до ответа действуют значения по умолчанию (PH-45):

| **№** | **Вопрос** | **По умолчанию** |
|---|---|---|
| Q-BTL-01 | Кто может войти по коду: только ученики выбранного класса или любой ученик платформы, знающий код? | Только ученики класса сессии |
| Q-BTL-02 | Время на вопрос по умолчанию и набор вариантов | 20 с; 5/10/20/30/60/90 с |
| Q-BTL-03 | Позднее подключение после старта | Выключено, учитель может включить |
| Q-BTL-04 | XP за Battle (вариант: +5 за участие, +10 за пьедестал) | Не начислять |
| Q-BTL-05 | Типы вопросов | Выбор варианта и «Верно/Неверно», без вписанного ответа |
| Q-BTL-06 | Показывать текст вопроса на экране ученика (вариант Kahoot — только на проекторе) | Показывать |
| Q-BTL-07 | Имена в рейтинге | «Асель К.» — имя и первая буква фамилии |
| Q-BTL-08 | Лимит участников в сессии | 100 |
| Q-BTL-09 | Промежуточный рейтинг после каждого вопроса | Включён |
| Q-BTL-10 | Код: исключить похожие буквы O и I | Не исключать — ровно A–Z |


# 8. Функциональные требования по экранам

Формат: каждый экран — маршрут, эталон, требования с ID, точные тексты в «…». Компоненты из 3.2; операции из раздела 6.

## 8.1 Гостевой режим

### 8.1.1 Главная (/, S01–S07)

| **ID** | **Требование** |
|---|-----------------------------|
| REQ-PUB-HOME-01 | Секции строго в порядке: Hero → Коротко → Пробный вопрос → Как это работает → Предметы → Почему Syntara → Школам → Сохраняй прогресс → Футер. |
| REQ-PUB-HOME-02 | Hero: метка «ОБРАЗОВАТЕЛЬНАЯ ПЛАТФОРМА»; H1 из трёх строк «Учишься.» / «Преподаёшь.» / «На своём языке.» (третья — `--accent`); текст «Уроки, квизы и ИИ-наставник на казахском и русском. Учителя создают свои курсы и следят за прогрессом. Работает даже на слабом интернете.»; белая кнопка «К предметам →» (/subjects); ссылка «Я учитель →» (/auth/start?role=teacher). Декоративный геометрический фон — `aria-hidden`. |
| REQ-PUB-HOME-03 | «КОРОТКО» / «ЧТО ТАКОЕ SYNTARA» — текстовый блок о предметах, уроках, квизах, ИИ-наставнике, классе и языках. |
| REQ-PUB-HOME-04 | Пробный вопрос: «БЕЗ РЕГИСТРАЦИИ» / «ОТВЕТЬ НА ВОПРОС ИЗ НАСТОЯЩЕГО УРОКА» / «Это тот же вопрос, который увидит ученик в квизе. Выбери ответ — и сразу получишь разбор.» Логика — SM-DEMO. |
| REQ-PUB-HOME-05 | «КАК ЭТО РАБОТАЕТ» / «ОТ ПЕРВОГО УРОКА ДО СВОЕГО КЛАССА» / «Ученики учатся и растут, учителя ведут — всё в одном месте.» Три шага: «01 Учишься» (иконка книга), «02 Растёшь» (график), «03 Учителя ведут класс» (школа). |
| REQ-PUB-HOME-06 | «ПРЕДМЕТЫ» / «ВЫБЕРИ, ЧТО ИЗУЧАТЬ» / пояснение из PH-01. Карточки из API-PUB-01: Биология — «Раздел: анатомия человека — и скоро больше»; Химия — «Элементы, реакции, молекулярные структуры»; Физика — «Механика, волны, термодинамика». Статус и кнопка «Открыть →» — только если status = 'open'. На главной — не больше 6 карточек, открытые первыми (порядок API-PUB-01); под карточками — ссылка «Все предметы →» на /subjects (решение владельца 2026-10-17). |
| REQ-PUB-HOME-07 | Синяя секция «ОТЛИЧИЯ» / «ПОЧЕМУ SYNTARA?» / метка «ТРИ ЯЗЫКА» / «Сделано под казахстанскую школу и её реальные условия.» Переключаемый блок из 5 пунктов: «Казахский, русский, английский», «ИИ-наставник», «Работает на слабых устройствах», «Открытый доступ», «Достижения и прогресс». Справа панель выбранного пункта (тексты — PH-03), стрелка «далее», 5 индикаторов. Одно состояние `activeIndex`; без автопрокрутки; управление с клавиатуры (роль tablist). |
| REQ-PUB-HOME-08 | «ШКОЛАМ» / «НЕ ТОЛЬКО УЧЕНИКАМ — ШКОЛЕ ЦЕЛИКОМ»; карточки «Журнал», «Дневник», «Домашняя работа»; кнопки «Смотреть для школ» (/schools) и «Оставить заявку» (/schools/request). |
| REQ-PUB-HOME-09 | «СОХРАНЯЙ СВОЙ ПРОГРЕСС» / «Войди, чтобы сохранять результаты квизов и видеть прогресс. Учишься в классе — подключись по коду учителя.»; кнопки «Войти» и «Подключиться к классу» (/join). |

### 8.1.2 Предметы (/subjects, S08)

| **ID** | **Требование** |
|---|-----------------------------|
| REQ-PUB-SUBJ-01 | Заголовок «Предметы»; карточки из API-PUB-01 (название, описание, иконка, статус, адрес). |
| REQ-PUB-SUBJ-02 | Статусы: open — «Открыт для знакомства» + «Открыть →» (гость открывает каталог и «Обзор» базовых уроков, BR-VIS-04); login_required — «Нужен вход» + переход на /auth/login?returnTo=…; soon — «Скоро», без кнопки, в отдельной группе после доступных. |
| REQ-PUB-SUBJ-03 | Поиск и фильтры MUST NOT добавляться. |

### 8.1.3 О проекте (/about, S09–S14)

| **ID** | **Требование** |
|---|-----------------------------|
| REQ-PUB-ABOUT-01 | Блоки по порядку: (1) «О ПРОЕКТЕ» / «Учиться может каждый», кнопки «К предметам →» и «Начать» (/auth/start), метрики «2 — языка полностью», «Пробный доступ — по условиям подключения», «PWA — устанавливается на телефон» (PH-11, PH-13), карточка «Учёба, которая остаётся доступной» с ролями Ученик / Учитель / Школа; (2) «Наша миссия» и цитата «Место, где родился ребёнок, не должно решать, какое образование он получит.»; (3) «Проблема, которую решаем»: образовательное неравенство в Казахстане, результаты PISA ниже среднего ОЭСР, разрыв города и села, нехватка контента на казахском, стоимость образовательных сервисов; (4) «Для кого Syntara»: карточки Ученику (#student), Учителю (#teacher), Школе (/schools), у каждой «Подробнее ↗»; (5) «Почему именно Syntara»: «Условия доступа», «Настоящий казахский», «Работает везде», «ИИ, а не видео»; (6) «Как это работает»: 1 Учишься, 2 Растёшь, 3 Учитель ведёт; (7) «Что внутри»: Уроки и тесты, ИИ-наставник, Мотивация, Казахский язык, Работает на слабом интернете (PH-13), Для учителей; (8) «С этого всё начиналось»: Mendeleev Atlas — «Химический атлас», Anatomy Atlas — «Атлас по анатомии», «Открыть сайт ↗» (PH-10); (9) «Команда»: Александр Заболотный — «Разработчик, идея и методология», zabolotnyyalexandr@gmail.com; Керейбаева Айгерим — «Учитель биологии · научный руководитель»; фото — PH-05; (10) «Цели устойчивого развития ООН»: 4 «Качественное образование», 9 «Инновации и инфраструктура», 10 «Меньше неравенства»; (11) «Присоединяйся», кнопка «Для школы →», email поддержки. |
| REQ-PUB-ABOUT-02 | Утверждения про офлайн, рейтинги и «полный паритет языков» — только текст; соответствующие функции не реализуются. |

### 8.1.4 Публичный помощник (/ai, S15)

| **ID** | **Требование** |
|---|-----------------------------|
| REQ-PUB-AI-01 | Слева: «ПОМОЩНИК ПО ПЛАТФОРМЕ», «Syntara AI», «Спроси что угодно про платформу: куда нажать, как учиться, что где найти. Регистрация не нужна.» Справа — чат: приветствие «Привет! Я Syntara. Помогу разобраться на платформе. С чего начнём?»; быстрые вопросы «Что это за платформа?», «С чего начать учёбу?», «Как сменить язык?», «Нужна ли регистрация?»; поле с placeholder «Напиши вопрос по платформе...»; кнопка «Отправить →». |
| REQ-PUB-AI-02 | Быстрый вопрос отправляется сразу. Enter — отправить, Shift+Enter — перенос строки. Пустое сообщение не отправляется. Максимум 2000 символов, счётчик при > 1800. |
| REQ-PUB-AI-03 | Во время ответа — статус «Готовлю ответ...» и кнопка «Остановить». Прерванный ответ помечается «Ответ прерван». |
| REQ-PUB-AI-04 | Ошибка: текст вопроса сохраняется, кнопка «Повторить». 429: «Слишком много вопросов. Попробуйте через N сек.» |
| REQ-PUB-AI-05 | Нет ответа в базе знаний → «Не могу точно ответить. Напишите в поддержку» + ссылка /support. Помощник MUST NOT утверждать, что отправил заявку или изменил данные. |
| REQ-PUB-AI-06 | История — только в памяти вкладки; кнопка «Очистить диалог». Режим без поставщика — PH-19. |

### 8.1.5 Школам (/schools, S16–S17)

| **ID** | **Требование** |
|---|-----------------------------|
| REQ-PUB-SCH-01 | «Школьный журнал, который ведёт в учебник»; кнопки «Оставить заявку» (/schools/request) и «Задать вопрос» (/support?category=school_onboarding). |
| REQ-PUB-SCH-02 | «Что получает школа»: 6 карточек — Журнал, Дневник, Расписание, Домашняя работа, Табель, Общение. |
| REQ-PUB-SCH-03 | «Чем отличается»; «Как подключить»: 1 Оставить заявку, 2 Мы заводим школу, 3 Заводите классы и учеников, 4 Начинаете вести; «Данные детей» со ссылкой «Политика конфиденциальности»; «Пробный период»: «Школа начинает бесплатно и решает после того, как поработает четверть, а не по презентации.» + «Оставить заявку». Цены не показываются. |

### 8.1.6 Заявка школы (/schools/request, S18)

| **ID** | **Требование** |
|---|-----------------------------|
| REQ-PUB-REQ-01 | Заголовок «Подключить школу к Syntara LMS». Поля по порядку (DTO SchoolRequestDto): «Название школы»* (placeholder «Школа-гимназия №1», полная ширина); «Регион» («Алматинская обл.») и «Город / село» («Алматы») — в одной строке; «Контактное лицо»* («Директор / завуч») и «Телефон» («+7 700 000 00 00») — в одной строке; «Email»* («school@example.kz»); «Сообщение» («Сколько классов, что важно, когда хотите начать...», многострочное). |
| REQ-PUB-REQ-02 | Внизу «← На главную» и белая кнопка «Оставить заявку». Отправка — SM-FORM. Текст согласия — PH-15. |

### 8.1.7 Поддержка (/support, S19)

| **ID** | **Требование** |
|---|-----------------------------|
| REQ-PUB-SUP-01 | Заголовок «Поддержка», подзаголовок для гостя «Опишите вопрос — ответим на указанный email». |
| REQ-PUB-SUP-02 | Поля (SupportTicketDto): «Категория» (select: «Техническая проблема» — по умолчанию, «Подключение школы», «Вопрос по обучению», «Аккаунт и доступ», «Данные и конфиденциальность», «Другое») и «Тема» — ряд 1; «Ваше имя (необязательно)» и «Email для ответа» — ряд 2; «Телефон (необязательно)»; «Опишите проблему». Кнопка «Отправить обращение»; ниже карточки «← На главную». |
| REQ-PUB-SUP-03 | techContext заполняется автоматически (маршрут, версия, язык, режим трафика, user-agent); пароли, токены и учебные работы MUST NOT передаваться. Пользователь видит подпись «К обращению будут добавлены технические сведения: страница, язык, браузер». |

### 8.1.8 Правовые страницы и cookie (S20–S26)

| **ID** | **Требование** |
|---|-----------------------------|
| REQ-PUB-LEGAL-01 | Шаблон: заголовок, «Обновлено: 2026-09-14», нумерованные разделы (соглашение — 13, политика конфиденциальности — 13, cookie — 7); внизу ссылки «Мои данные», три документа, «← На главную». Тексты — PH-14 (плашка «Черновик редакции — не действует до утверждения»). |
| REQ-PUB-LEGAL-02 | Cookie-баннер при первом визите: «Только необходимые» и «Принять все». Необязательные категории выключены по умолчанию. Решение хранится в cookie `consent` 12 месяцев. Отказ не ломает функции сайта. |

### 8.1.9 Формы: общий автомат отправки (SM-FORM)

```text
idle → validating → (errors) → idle с ошибками у полей + сводка сверху + фокус на первое ошибочное поле
validating → submitting: кнопка «Отправляем...», disabled; Idempotency-Key генерируется один раз на содержимое формы
submitting → success: только после 201; показать «Заявка получена» / «Обращение получено», номер и email; очистить форму
submitting → network_error: «Нет соединения. Проверьте интернет и повторите отправку» — ввод сохранён, ключ тот же
submitting → server_error | timeout(15 с): «Не удалось подтвердить отправку. Повторите попытку» — ключ тот же
Изменение содержимого после ошибки → новый Idempotency-Key.
Уход со страницы с заполненной неотправленной формой → beforeunload-предупреждение. Черновик формы не сохраняется в localStorage.
Валидация: при отправке и при уходе с поля (blur) у уже затронутых полей; верные поля не очищаются.
```

### 8.1.10 Пробный вопрос (SM-DEMO)

```text
loading → (error) → «Не удалось загрузить вопрос» + «Повторить загрузку»
loading → question: варианты как radio-группа; кнопка «Проверить ответ» disabled до выбора
question → answered: POST demo-answer; показать «Верно» или «Пока неверно» (текст + иконка, не только цвет),
           подсветить выбранный и правильный варианты, объяснение
answered → question: «Попробовать ещё раз» (сброс выбора того же вопроса)
answered → loading: «Другой вопрос» (скрыта, если вопрос один — PH-02)
answered: ссылка «Перейти к предмету». Баллы не начисляются; правильный ответ не приходит до проверки (BR-QZ-01).
```

## 8.2 Аккаунты (PH-06, PH-07, PH-08)

| **ID** | **Требование** |
|---|-----------------------------|
| REQ-GEN-AUTH-01 | /auth/login: поля «Email или логин», «Пароль»; кнопка «Войти»; ссылка «Забыли пароль?». После входа — переход на returnTo или по роли (/teacher/courses, /learn/subjects); с временным паролем — сначала смена пароля (API-AUTH-05). |
| REQ-GEN-AUTH-02 | /auth/start: выбор «Ученик» или «Учитель». «Учитель» → регистрация (email, имя, пароль ≥ 8 символов); вход сразу, подтверждение email — по ссылке из письма, до подтверждения в кабинете напоминание «Подтвердите email» с повторной отправкой. «Ученик» (`/auth/start?role=student`, эталон `media/student-auth.png`) → «Syntara», «УЧЕНИК», заголовок «Вход или регистрация», вкладки «Регистрация» / «Вход». Регистрация: «Имя»*, «Логин»* (если введён email — подсказка), «Пароль»* с показом и подсказкой «Минимум 8 символов», «Email» (необязательно), «Школа» (поиск API-PUB-09, «Нет в списке? Ввести вручную» — школа сохраняется со статусом «не проверена»), «Код класса (необязательно)» (ABC123); «Создать аккаунт» → API-AUTH-03S и сразу кабинет ученика. Под кнопкой — согласие со ссылками «Пользовательское соглашение» и «Политика конфиденциальности», «Аккаунт нужен только для сохранения прогресса — изучать можно без него», блок «Забыл пароль?» и «Продолжить без входа →» (гостевой режим). Вход: «Email или логин», «Пароль», «Забыли пароль?». Обращение к ученику — на «ты». |
| REQ-GEN-AUTH-03 | /join: поле кода (вставка, trim, сохранение символов по BR-CLS-01); до входа — API-PUB-08 и сообщение «Код подходит. Войдите, чтобы присоединиться»; неверный/истёкший код — «Код не найден или истёк. Проверьте код у учителя» + ссылка на поддержку. После входа — экран подтверждения «Присоединиться к классу?» и API-S-01. Гость с годным кодом переходит на форму ученика (REQ-GEN-AUTH-02) с заполненным кодом. Ученик без класса в кабинете видит блок «Подключиться к классу». |
| REQ-GEN-AUTH-04 | /account/privacy: список хранимых данных; кнопки «Запросить копию» и «Запросить удаление» (API-ME-05). |

## 8.3 Кабинет учителя

### 8.3.1 Новый предмет (/teacher/subjects/new, T05)

![T05 — Создание предмета](media/image2.jpg)

| **ID** | **Требование** |
|---|-----------------------------|
| REQ-TCH-SUBJ-01 | Заголовок «Новый предмет», ссылка «← К моим курсам». Сегмент RU/KK/EN (независим от языка интерфейса); поля «Название», «Описание» для каждого языка; переключение вкладки не теряет введённое. Машинный перевод не выполняется. |
| REQ-TCH-SUBJ-02 | Подсказка «Заполни хотя бы один язык (RU, KK или EN)». Ошибка, если ни в одном языке нет названия. Длины — PH-23. |
| REQ-TCH-SUBJ-03 | Флажок «Показывать предмет в общем каталоге» с пояснением «Предмет увидят все пользователи, но только опубликованные темы будут доступны ученикам.» |
| REQ-TCH-SUBJ-04 | Кнопка «Создать» → API-T-02 → переход на /teacher/subjects/:id. |

### 8.3.2 Предмет: доступ классу и темы (/teacher/subjects/:id, T04)

![T04 — Доступ классу и темы предмета](media/image1.jpg)

| **ID** | **Требование** |
|---|-----------------------------|
| REQ-TCH-ACC-01 | Блок «Выдать предмет классу» с пояснением «После подключения ученики этого класса увидят предмет и его опубликованные темы в „Курсах".»; список классов учителя: название, «Учеников: N», кнопка «Выдать классу» (API-T-07). Для уже выданного — состояние «Выдан» и действие «Отозвать». |
| REQ-TCH-ACC-02 | Блок «Темы», кнопка «+ Добавить тему» (API-T-09 → редактор). Пустое состояние «Пока нет тем — добавьте первую». Список тем: номер, название, статус (Черновик / Опубликована). Отдельного экрана «Новая тема» до первого сохранения нет: `/teacher/subjects/:id/topics/new` ведёт на страницу предмета. |

### 8.3.3 Редактор темы (/teacher/topics/:id, T06–T07)

![T06 — Редактор темы: ИИ-черновик и текстовые поля](media/image3.jpg)

| **ID** | **Требование** |
|---|-----------------------------|
| REQ-TCH-TOP-01 | Заголовок «Новая тема», ссылка «← К предмету». Порядок: панель ИИ → RU/KK/EN → «Название» → «Описание» → «Интересный факт» → «Текст урока» → «Обложка темы» → «Материалы урока» → «Сохранить» → блок публикации (8.3.4). |
| REQ-TCH-TOP-02 | Кнопка «Сгенерировать черновик ИИ» (`--ai-gradient`) → API-T-11; заполняет название, описание, факт и текст урока для RU и KK в форме (название — на языке черновика, учитель может его поправить); не сохраняет и не публикует. При недоступности ИИ — сообщение «ИИ-черновик сейчас недоступен». |
| REQ-TCH-TOP-03 | «Текст урока» — Markdown (заголовки `##`, списки, жирный, курсив) с вкладкой «Просмотр»; рендер через rehype-sanitize. |
| REQ-TCH-TOP-04 | «Обложка темы»: поле «Ссылка на изображение (необязательно)» или «Загрузить файл»; JPG, PNG, WEBP, GIF до 5 МБ; миниатюры галереи (API-T-18); выбор — синяя рамка (PH-26). Картинку по ссылке сервер скачивает в хранилище при сохранении (BR-FILE-06). |
| REQ-TCH-TOP-05 | «Материалы урока»: «Добавить файл»; PDF, DOCX, XLSX, PPTX, ODT, TXT, CSV; до 25 МБ на файл, до 20 файлов и 200 МБ на тему; статус проверки файла (Проверяется / Готов / Отклонён) по BR-FILE-*. |
| REQ-TCH-TOP-06 | «Сохранить» → API-T-10; статус темы не меняется. Сообщение «Сохранено». |

### 8.3.4 Публикация темы (T07)

![T07 — Обложка, материалы и публикация темы](media/image4.jpg)

| **ID** | **Требование** |
|---|-----------------------------|
| REQ-TCH-PUB-01 | Статус-капсула: draft — «Черновик — ученики не видят»; published — «Опубликована». |
| REQ-TCH-PUB-02 | Кнопки: «Посмотреть глазами ученика» (API-T-15, открывает представление 8.4.3 без публикации); «Опубликовать» (светлая; API-T-12); «История версий» (API-T-14, PH-25); для опубликованной — «Снять с публикации» (API-T-13). |
| REQ-TCH-PUB-03 | Поле «Что изменилось (необязательно)», ≤ 500 символов; передаётся в API-T-12 как changeNote. |
| REQ-TCH-PUB-04 | Кнопка «Редактировать квиз» → /teacher/topics/:id/quiz. |
| REQ-TCH-PUB-05 | Изменения опубликованной темы видны ученикам только после повторного «Опубликовать» (ученик видит снимок published_version_id). |

### 8.3.5 Вопрос квиза (/teacher/topics/:id/quiz, T08)

![T08 — Добавление вопроса квиза](media/image5.jpg)

| **ID** | **Требование** |
|---|-----------------------------|
| REQ-TCH-QZ-01 | Блок «+ Добавить вопрос». Сегменты: тип («Выбор варианта», «Верно/Неверно», «Вписать ответ»); сложность («Лёгкий», «Средний», «Сложный»); язык RU/KK/EN. |
| REQ-TCH-QZ-02 | «Выбор варианта»: поле вопроса; варианты — поле + radio; ровно один правильный (зелёная рамка); «+ Добавить вариант» (2–8 вариантов); удаление варианта. «Верно/Неверно»: два фиксированных варианта, выбор правильного. «Вписать ответ»: поле «Правильный ответ». |
| REQ-TCH-QZ-03 | Поле «Объяснение». Подсказка «Заполни хотя бы один язык (RU, KK или EN)». Кнопка «Создать» → API-T-20. Правильность хранится в варианте и одинакова для всех языков. |
| REQ-TCH-QZ-04 | Список существующих вопросов с порядком, редактированием и архивированием (API-T-21). |

### 8.3.6 Задания (/teacher/assignments, T09)

![T09 — Задания: выдача, список, проверка](media/image6.jpg)

| **ID** | **Требование** |
|---|-----------------------------|
| REQ-TCH-ASG-01 | Блок «Выдать задание»: «Назначь тему своему классу — и ученики увидят задание у себя в „Мои задания". Можно выбрать как свой предмет, так и официальный.» Поля: Класс, Предмет, Тема (фильтр по предмету, BR-ASG-02), Срок сдачи (дата и время, формат PH-31). Кнопка «Выдать» → API-T-22. |
| REQ-TCH-ASG-02 | «Выданные задания»: карточки — тема, «класс · срок», счётчики «Сдано: N · На проверку: N · Оценено: N» (BR-ASG-03). |
| REQ-TCH-ASG-03 | «Проверка»: очередь API-T-24; пустое состояние «Нет работ на проверку». |

### 8.3.7 Аналитика класса (/teacher/classes/:id/analytics, T10)

![T10 — Аналитика класса](media/image7.jpg)

| **ID** | **Требование** |
|---|-----------------------------|
| REQ-TCH-AN-01 | Ссылка «← К классам», название класса, вкладки «Ростер», «Карта освоения», «Аналитика класса»; класс сохраняется при переключении вкладок. «Ростер» и «Карта освоения» — PH-24. «Карта освоения» (решение владельца 2026-10-17, вместо PH-24) — простая версия: таблица «ученики × темы» выбранного предмета (базового или своего, выданного классу, API-T-29), в ячейке — цвет и подпись статуса «Освоена» (≥ 80 %) / «Начата» / «Не начата» (с процентом лучшего результата); фильтр по предмету; на мобильном — горизонтальная прокрутка таблицы. |
| REQ-TCH-AN-02 | Карточки «Средняя успеваемость класса» (avgPercent, %) и «Вовлечённость» («active/total», подпись «за последние 7 дней»). |
| REQ-TCH-AN-03 | «Слабые темы класса»: строки — название, «N уч.», процент, полоса шириной = percent%; цвет по BR-AN-04. |
| REQ-TCH-AN-04 | «Требуют внимания» (красная рамка): имя, «N дней назад», метка «неактивен». Пустое — «Все ученики активны». |

## 8.4 Интерфейс ученика

### 8.4.1 Главная ученика (/, U01)

![U01 — Главная ученика](media/image8.jpg)

| **ID** | **Требование** |
|---|-----------------------------|
| REQ-ST-HOME-01 | Тот же Hero, что у гостя; вместо кнопок — светлая «Продолжить учёбу →»: href = последняя открытая тема, иначе /learn/subjects (PH-34). |

### 8.4.2 Каталог и класс (/learn/subjects, U13, U03)

![U13 — Каталог предметов и карточка класса](media/image10.jpeg)

| **ID** | **Требование** |
|---|-----------------------------|
| REQ-ST-CAT-01 | Карточка класса (API-S-02): «Вы в классе «{name}»», «Учитель: {teacher} · {school}», кнопка «Выйти из класса» (EN-эталон U13: «You're in class «{name}»», «Teacher: {teacher} · {school}», «Leave»). Выход из аккаунта в хедере — «Выйти» / EN «Log out». Подтверждение «Выйти из класса «{name}»?» → API-S-03 (PH-40). Это не выход из аккаунта. Без класса — поле «Подключиться к классу». |
| REQ-ST-CAT-02 | Заголовок «Предметы платформы» (EN «Platform subjects»); сетка 3 колонки: разделы (статус «Раздел»/«Section») и доступные предметы («Доступно»/«Available»); вся карточка кликабельна, без отдельной кнопки. Предмет без опубликованных тем — «Скоро»/«Soon», карточка не кликабельна (BR-CNT-08). Гость видит тот же каталог базовых уроков без карточки класса (BR-VIS-04). Пользовательские названия не переводятся. Эталон U13 (EN), 7 карточек по порядку: Biology — Human Anatomy (Section); Natural sciences — Physics · Geography (Section); Exact sciences — Mathematics · Algebra · Geometry · Informatics (Section); Humanities — History of Kazakhstan (Section); Languages — Kazakh language · Russian language · English language (Section); ботаника — растение, животные (Available, название учителя не переводится); Chemistry — Elements, reactions, molecular structures (Available). Отступление от эталона (решение владельца 2026-10-17): «Химия» — в разделе «Естественные науки» (Chemistry · Physics · Geography), отдельной карточки Chemistry нет. |
| REQ-ST-CAT-03 | /learn/sections/:id: «← Предметы», заголовок раздела, карточки предметов (пример U03: «Анатомия человека», «11 систем организма», «Доступно»). |
| REQ-ST-CAT-04 | /learn/subjects/:id (API-S-18): «← Предметы», название и описание предмета, «Темы» — карточки тем по порядку («Тема {N}», название) со статусом ученика: «Освоена» (лучший результат ≥ 80 %, PH-38), «Начата» (тема открыта или есть попытка квиза), «Не начата». Сюда ведут карточка предмета, крошки урока и «Перейти к предмету». |

### 8.4.3 Урок (/learn/topics/:id, U04, U09, U12)

![U04 — Обзор темы (тёмная тема)](media/image11.jpg)

![U09 — Меню языка и английская версия урока](media/image17.jpg)

![U12 — Обзор темы в светлой теме](media/image18.jpg)

| **ID** | **Требование** |
|---|-----------------------------|
| REQ-ST-LES-01 | Хлебные крошки «← {Предмет} / {Тема}», заголовок, «Тема {N}», «{K} вопросов». Вкладки «Обзор», «Квиз», «Syntara AI» — параметр `?tab=`; переключение без перезагрузки. |
| REQ-ST-LES-02 | «Обзор»: краткое описание; карточка «Интересный факт» (если задан) — после описания, перед текстом урока; текст; материалы урока (только прошедшие проверку); иллюстрация справа (~336×190); аккордеон разделов (все свёрнуты, можно раскрыть несколько — PH-36). Эталон U04/U11 (RU): «01 Основные функции», «02 Состав сердечно-сосудистой системы», «03 Строение сердца», «04 Круги кровообращения», «05 Кровеносные сосуды и давление»; U09 (EN): «Main Functions», «Components of the Cardiovascular System», «Structure of the Heart», «Circulatory Pathways», «Blood Vessels and Pressure Regulation», «06 Microcirculation». Для авторских тем — Markdown целиком. |
| REQ-ST-LES-03 | Внизу карточка «СЛЕДУЮЩАЯ — {Тема} →» (по position, PH-35); переход не засчитывает текущую тему. |
| REQ-ST-LES-04 | Открытие темы → API-S-17 (lesson_opened, idempotencyKey = `lesson:{topicId}:{date}`). |
| REQ-ST-LES-05 | Смена языка или темы оформления сохраняет тему, вкладку и результаты. |
| REQ-ST-LES-06 | Гость (BR-VIS-04): базовый урок в публичной оболочке; «Обзор» как у ученика; на вкладке «Квиз» — «Войди или зарегистрируйся, чтобы пройти квиз», на «Syntara AI» — «Войди или зарегистрируйся, чтобы задать вопрос Syntara AI»; на обеих — кнопка «Войти» (вход с возвратом на урок). Событие открытия урока, XP и прогресс гостю не создаются. |
| REQ-ST-LES-07 | Пометки языка урока: перевод ждёт вычитки (BR-CNT-05) — «На проверке»; урока нет на выбранном языке — показывается RU с пометкой «Урок пока доступен на русском». Иллюстрации разделов базовых уроков — внутри раздела аккордеона, с подписью из файла; ширина — около 336 px на десктопе (от 768 px), на мобильном — по ширине экрана. |

### 8.4.4 Квиз (?tab=quiz, U05)

![U05 — Первый вопрос квиза](media/image12.jpg)

| **ID** | **Требование** |
|---|-----------------------------|
| REQ-ST-QZ-01 | Маркеры прогресса, сложность («Лёгкий»/«Средний»/«Сложный»), «Вопрос {i} из {n}», текст, варианты A–D (radio-группа). Клавиатура: стрелки только перемещают выбор, ответ — Enter, пробел или кнопка «Ответить»; клик мышью по варианту сразу отправляет ответ. Логика — SM-ATTEMPT и BR-QZ-*. |
| REQ-ST-QZ-02 | После выбора — сразу результат: «Верно»/«Неверно», правильный вариант, объяснение; кнопка «Далее». В конце — «Результат: {score} %» (целые проценты), «{N} из {M} правильно», при результате ≥ 80 % — «Тема освоена!», иначе — «Тема освоена при 80 % — попробуй ещё раз» (порог — PH-38); начисленные XP и бейджи, «Пройти ещё раз». |

### 8.4.5 Учебный ИИ (?tab=ai, /learn/assistant; U06, U07, U02)

![U06 — ИИ в теме: ввод вопроса](media/image13.jpg)

![U07 — ИИ в теме: ответ](media/image14.jpg)

![U02 — Отдельная страница учебного помощника](media/image9.jpg)

| **ID** | **Требование** |
|---|-----------------------------|
| REQ-ST-AI-01 | Во вкладке темы: приветствие «Привет! Я Syntara. Спроси меня о теме «{Тема}» — я помогу разобраться.»; поле «Задайте вопрос наставнику...»; кнопка «Спросить»; быстрые действия «Объясни проще», «Расскажи подробнее», «Проверь меня» (PH-21); подпись «Объясняю под твой уровень: Начальный». |
| REQ-ST-AI-02 | Сообщения ученика справа (синие, подпись «Вы»), ответы слева (подпись «Syntara»); потоковый вывод; кнопка «Остановить». Постоянный текст под полем: «Это ИИ. Он может ошибаться. Важное проверяйте по учебнику.» |
| REQ-ST-AI-03 | /learn/assistant: «Syntara AI», «Ваш личный помощник в учёбе»; кнопки «Начать обучение с ИИ» (фокус в поле) и «Как это работает» (модальное окно, PH-21); статус «Онлайн»; «Режим академической поддержки»; «Я помогу вам:» — «Объяснить непонятное простыми словами», «Связать тему с тем, что уже знаете», «Определить слабые места», «Создать адаптивные тесты», «Составить структурированное резюме» (описание возможностей, отдельных экранов нет); поле «Задайте вопрос по теме, которую разбираете.»; context = general_tutor. Абзац под заголовком на эталоне U02 («Syntara анализирует ваш прогресс…») не выводится, пока такой функции нет (решение владельца 2026-10-17). |
| REQ-ST-AI-04 | Сообщения сохраняются (API-S-12); ИИ не изменяет данные (BR-AI-03). Недоступность — PH-19. В режиме mock вопрос сохраняется, ответ — «Учебный ИИ скоро будет доступен» (PH-19). Лимиты PH-20 — на ученика, не на IP. |

### 8.4.6 Мои показатели (/learn/progress, U08)

![U08 — Мои показатели](media/image15.jpg)

| **ID** | **Требование** |
|---|-----------------------------|
| REQ-ST-PRG-01 | Метка «ПЕРИОД», заголовок «Мои показатели»; сегменты «Сегодня», «7 дней», «30 дней», «90 дней», «Четверть», «Учебный год»; строка с датами периода и «Сравнение с: …». Подзаголовок «Как у вас идут дела за период.» (эталон U08, решение владельца 2026-10-17). «Четверть» — по датам PH-38. |
| REQ-ST-PRG-02 | Блок «Начни отсюда» / «С чего начать сейчас?»: «Что делать» и «Почему» (BR-ST-06). Перед ним — блок «Начни отсюда»: «Это не оценки и не контрольная. Сначала смотри следующий шаг, затем прогресс и серию — так сразу понятно, что делать сегодня.» (эталон U08, решение владельца 2026-10-17). |
| REQ-ST-PRG-03 | Карточки «Мой прогресс» («{mastered} из {total} тем», «{percent} %», дельта) и «Серия» («{days} дн.», последнее занятие, дельта). Кнопки «Что это значит» и «Как считается» — модальные окна с текстом правил BR-ST-*. |
| REQ-ST-PRG-04 | Смена периода → API-S-14, пересчёт всех значений. |

### 8.4.7 Достижения (/learn/achievements, U10)

![U10 — Достижения и бейджи](media/image16.jpg)

| **ID** | **Требование** |
|---|-----------------------------|
| REQ-ST-ACH-01 | Карточка уровня: номер, ранг (BR-XP-03), «Серия: {n} дн.», «{xp} XP всего», «До следующего уровня: {n} XP», полоса прогресса. |
| REQ-ST-ACH-02 | «Бейджи — Получено {earned} из {total}»; сетка 4 колонки; полученные — цветные, закрытые — серые с замком и «ЗАКРЫТО». Список и условия — BR-BDG-01. |

### 8.4.8 Мои задания (/learn/assignments, PH-33)

| **ID** | **Требование** |
|---|-----------------------------|
| REQ-ST-ASG-01 | Список назначений класса: тема, предмет, срок, статус («Не начато», «Сдано», «Оценено: {grade}%»); переход открывает квиз темы с assignment_id. Просроченные помечены «Срок прошёл». Сдача после срока — пометка «Сдано после срока» (BR-ASG-03). |

## 8.5 Служебная поддержка (/staff)

| **ID** | **Требование** |
|---|-----------------------------|
| REQ-SUP-01 | Вход только для support_agent / onboarding_agent. Очередь: фильтры (тип, статус, ответственный, срок), поиск по номеру и email, сортировка по дате. |
| REQ-SUP-02 | Карточка: исходное обращение, tech_context, история переписки, внутренние заметки (визуально отличаются, не отправляются клиенту), история статусов. |
| REQ-SUP-03 | Действия: назначить, ответить (шаблоны response_templates: подтверждение, уточнение, решение, задержка; текст и адрес видны перед отправкой), сменить статус по SM-TICKET, эскалировать (waiting_internal). |
| REQ-SUP-04 | Работает при недоступном ИИ. Цель первого ответа — 1 рабочий день (PH-22), не показывается пользователю. |

## 8.6 Battle (итерация 10.5)

Общие требования к экранам Battle:

| **ID** | **Требование** |
|---|-----------------------------|
| REQ-BTL-GEN-01 | Экраны — только из токенов и компонентов `packages/ui`, текущий тёмный стиль; React Bits не подключается. Обе темы; ширины 320/390/768/1280/1440 без горизонтальной прокрутки; axe без нарушений serious/critical; `prefers-reduced-motion` и «Экономия трафика» отключают анимации и конфетти. |
| REQ-BTL-GEN-02 | Новые элементы `packages/ui`: токены медалей `--medal-gold`, `--medal-silver`, `--medal-bronze` (+ варианты для текста с контрастом ≥ 4,5:1); 4 цвета вариантов ответа — красный, синий, жёлтый, зелёный; каждый вариант всегда с фигурой (▲ ◆ ● ■) и буквой (A–D), не только цветом. Компоненты `CodeInput` (6 ячеек, автопереход, вставка, верхний регистр), `BigCode` (крупный код с «Копировать»), `CountdownBar` (таймер), `AnswerTile`, `Podium`, `LeaderboardTable`, `ParticipantChip`, `ConnectionBanner`. |
| REQ-BTL-GEN-03 | Смена фаз — плавная смена содержимого (≤ 250 мс) без перезагрузки. Изменения состояния объявляются через `aria-live="polite"` («Вопрос 3 из 10», «Время вышло», «Верно»). Тексты — i18n RU/KK/EN (`needs_confirmation.json`; KK и EN — `needs_review`); название функции во всех языках — «Battle»; содержание вопросов не переводится. |

### 8.6.1 Учитель (BT-T*)

Новый пункт боковой панели учителя «Battle» (значок «молния» из набора Lucide).

| **ID** | **Экран и маршрут** | **Требование** |
|---|---|-----------------------------|
| REQ-BTL-T01 | Мои Battle, `/teacher/battles` | Вкладки «Тесты» и «История игр». Карточки тестов: название, число вопросов, последняя игра, кнопки «Запустить», «Изменить», меню (дублировать, архивировать). Кнопка «Новый Battle». Пустое состояние с пояснением, что такое Battle. |
| REQ-BTL-T02 | Редактор, `/teacher/battles/:id` | Название, описание, язык. Список вопросов (перетаскивание + кнопки ↑↓ для клавиатуры). Карточка вопроса: текст, картинка, тип, время (сегменты 5/10/20/30/60/90), 2–4 варианта с цветом и фигурой как в игре и переключателем «правильный». «+ Вопрос», «Импорт из темы» (модальное окно: предмет → тема → чекбоксы вопросов). Проверка перед запуском: у каждого вопроса есть правильный вариант. Автосохранение с индикатором «Сохранено». |
| REQ-BTL-T03 | Запуск — модальное окно | Выбор класса, настройки 7.12, кнопка «Создать игру» → API-BTL-20 → лобби. |
| REQ-BTL-T04 | Лобби ведущего, `/teacher/battle-sessions/:sid` | Крупный код (`BigCode`) и подсказка «Ученики: кабинет → Battle → ввести код». Счётчик и сетка подключившихся (`ParticipantChip`, мягкое появление, «×» — выгнать с подтверждением). «Начать» (неактивна при 0 участников) и «Отменить». «Во весь экран» — режим проектора. |
| REQ-BTL-T05 | Вопрос (ведущий) | «Вопрос 3 из 10», текст крупно, картинка, плитки вариантов без отметки правильного, большой таймер, «Ответили 18 из 24», «Завершить вопрос». |
| REQ-BTL-T06 | Раскрытие | Правильный вариант подсвечен, остальные приглушены. Столбчатая диаграмма распределения ответов по вариантам (цвет + фигура + число), среднее время. «Далее». |
| REQ-BTL-T07 | Промежуточный рейтинг | Топ-5: место, имя, правильных. «Следующий вопрос». |
| REQ-BTL-T08 | Итог | Пьедестал (2-е слева, 1-е по центру выше, 3-е справа; цвета медалей, имя, «X из Y правильных», время), ниже таблица остальных мест. «Сыграть ещё раз» (новая сессия того же теста и класса), «Подробные результаты», «Экспорт CSV». |
| REQ-BTL-T09 | Результаты игры, `/teacher/battle-sessions/:sid/results` | Шапка: тест, класс, дата, участников. Пьедестал + таблица. «По вопросам»: доля правильных (цвет по порогам аналитики PH-30), распределение, среднее время; список «Сложные вопросы». «По ученикам»: строка ученика раскрывается ответами по вопросам. |
| REQ-BTL-T10 | Режим проектора | Крупная типографика (вопрос ≥ 40 px на 1280 px), без боковой панели, кнопки управления внизу; выход по Esc. |
| REQ-BTL-T11 | Карточка класса `/teacher/classes/:id` | Ссылка «Battle этого класса» → история игр, отфильтрованная по классу. |

### 8.6.2 Ученик (BT-S*)

Новый пункт боковой панели ученика «Battle». На главной ученика — карточка «Есть код Battle? Введи его» с полем `CodeInput`.

| **ID** | **Экран и маршрут** | **Требование** |
|---|---|-----------------------------|
| REQ-BTL-S01 | Вход в Battle, `/learn/battles` | Крупный `CodeInput` и «Войти в игру». Ошибки: «Код не найден — проверь буквы и цифры», «Игра уже началась», «Учитель удалил тебя из этой игры». Ниже «Мои Battle» — история (тест, дата, место «3 из 24», правильных «7 из 10»). |
| REQ-BTL-S02 | Лобби, `/learn/battles/:sid` | «Ты в игре!», название теста, имя учителя, «Ждём, когда учитель начнёт», число участников, своё имя, мягкая анимация ожидания. «Выйти». |
| REQ-BTL-S03 | Вопрос | Таймер сверху, «Вопрос 3 из 10», текст вопроса и картинка (Q-BTL-06). 2–4 больших плитки `AnswerTile` (на телефоне — сетка 2×2 или столбец, высота ≥ 72 px). Нажатие сразу отправляет ответ; с клавиатуры — Tab/стрелки + Enter. После ответа — «Ответ принят! Ждём остальных…», плитки заблокированы, выбранная отмечена. Время вышло без ответа — «Время вышло». |
| REQ-BTL-S04 | Раскрытие | «Верно!» (зелёный, ✓) или «Неверно» (+ правильный вариант). «Правильных: 4», «Твоё место: 5 из 24». |
| REQ-BTL-S05 | Промежуточный рейтинг | Топ-5 и строка «Ты: 7-е место». |
| REQ-BTL-S06 | Итог, `/learn/battles/:sid/results` | Пьедестал (как у учителя) + своя карточка: место, правильных X из Y, время. Таблица всех мест, своя строка подсвечена. «Мои ответы» — разбор по вопросам с правильными вариантами. Короткое CSS-конфетти для мест 1–3 (отключается при reduced motion и «Экономии трафика»). |
| REQ-BTL-S07 | Связь | Обрыв — переподключение (6.9), после 3 неудач — `ConnectionBanner` «Нет соединения, переподключаемся…»; после переподключения — текущая фаза из `snapshot`. |

# 9. Конечные автоматы

```text
SM-TOPIC        draft --publish--> published --unpublish--> draft
                published --edit+save--> published (изменения в черновом содержимом; ученик видит published_version)
                published --publish--> published (новая topic_version)

SM-ATTEMPT      (none) --start--> in_progress --answer*--> in_progress --finish--> finished
                in_progress --(30 дней без активности)--> abandoned

SM-SUBMISSION   (none) --attempt.finish(assignment)--> graded   [PH-29; submitted/in_review зарезервированы]

SM-MEMBERSHIP   (none) --join(code)--> active --leave--> left ; left --join--> новая запись active

SM-TICKET       new --assign--> in_progress
                in_progress --ask_user--> waiting_user --user_reply--> in_progress
                in_progress --reply(шаблон «Уточнение»)--> waiting_user              (= ask_user)
                in_progress | waiting_* --reply(шаблон «Решение»)--> resolved          (= resolve)
                in_progress --escalate--> waiting_internal --resume--> in_progress
                in_progress | waiting_* --resolve--> resolved --(7 дней)--> closed
                resolved | closed --user_reply--> reopened --assign--> in_progress

SM-REQUEST      new --> in_progress --> contacted --> onboarded | rejected

SM-FILE         pending --scan ok--> clean ; pending --virus|macro--> rejected (файл удалён)

SM-AI-MESSAGE   streaming --done--> complete ; streaming --abort--> partial ; streaming --error--> failed

SM-BTL          lobby --start--> question(0) --(дедлайн + 500 мс | все ответили | «Завершить вопрос»)--> reveal
                reveal --(«Далее» | автопереход 5 с)--> leaderboard --next--> question(i+1)
                reveal --next--> question(i+1)                       (промежуточный рейтинг выключен)
                reveal | leaderboard на последнем вопросе --next--> finished
                любое состояние, кроме finished/cancelled --«Завершить игру»--> finished (итог по отвеченным вопросам)
                lobby --«Отменить» | 60 мин без старта--> cancelled ; игра 30 мин без активности --> cancelled (expired)
                status: lobby (фаза lobby), in_progress (question | reveal | leaderboard), finished, cancelled (7.12)
```

Недопустимые переходы возвращают 409 `INVALID_TRANSITION`.


# 10. Нефункциональные требования

| **ID** | **Требование** | **Как проверить** |
|---|-----------------------|--------------|
| REQ-NFR-SEC-01 | Только HTTPS (TLS 1.2+), HSTS, заголовки CSP, X-Content-Type-Options, Referrer-Policy, frame-ancestors 'none'. | Тест заголовков в e2e |
| REQ-NFR-SEC-02 | Пароли — Argon2id; токены сессий и кодов классов хранятся только хешами. | Unit-тест сервиса auth |
| REQ-NFR-SEC-03 | Cookie сессии HttpOnly, Secure, SameSite=Lax; срок ≤ 14 дней; CSRF для изменяющих запросов. | Integration-тест |
| REQ-NFR-SEC-04 | Подстановка чужого ID в любой эндпоинт /api/teacher/*, /api/student/* → 404. | Генерируемый тест по всем маршрутам |
| REQ-NFR-SEC-05 | Журнал аудита: оценки, состав классов, выдача предметов, публикация тем, статусы обращений. | Integration-тест |
| REQ-NFR-SEC-06 | Санитизация Markdown, ответов ИИ и пользовательского текста; без исполнения скриптов. | Тест XSS-полезных нагрузок |
| REQ-NFR-SEC-07 | В журналах нет содержимого форм, чата, паролей, токенов; есть requestId. | Проверка логов в тесте |
| REQ-NFR-DATA-01 | Все серверы, БД, файлы, журналы, резервные копии — в Республике Казахстан (PH-16). | Инфраструктурный чек-лист |
| REQ-NFR-DATA-03 | Обработка ПД по Закону РК «О персональных данных и их защите»; ученики регистрируются сами (PH-17), аккаунт без email — child-safe; согласия фиксируются в consents (согласие родителя — TODO(OWNER)). | Юридическая проверка (ручн.) |
| REQ-NFR-DATA-02 | Сроки хранения — PH-18; очистка выполняется задачами worker. | Integration-тест задач очистки |
| REQ-NFR-PERF-01 | Главная: ≤ 500 КБ сжатых ресурсов при первой загрузке; ИИ-модуль — динамический импорт. | Lighthouse CI, бюджет в next.config |
| REQ-NFR-PERF-02 | p75 мобильный профиль: LCP ≤ 2,5 с; INP ≤ 200 мс; CLS ≤ 0,1. | Lighthouse CI |
| REQ-NFR-PERF-03 | p95 API: чтение ≤ 500 мс; сохранение ≤ 2 с; клиентские таймауты: формы 15 с, первый токен ИИ 45 с. | k6 |
| REQ-NFR-PERF-04 | Нагрузка — PH-41 (2 000 одновременных сессий) с запасом ×2. | k6 |
| REQ-NFR-A11Y-01 | WCAG 2.1 AA: клавиатура, видимый фокус, контраст 4,5:1 / 3:1, масштаб 200 %, `prefers-reduced-motion`, alt у изображений, статусы через aria-live. | axe-core + ручная проверка NVDA/VoiceOver |
| REQ-NFR-I18N-01 | Все строки — в i18n-файлах; ключи совпадают в ru/kk/en; даты и числа форматируются по локали (Intl); часовой пояс PLATFORM_TZ. | Тест сравнения ключей |
| REQ-NFR-COMP-01 | Chrome и Safari (десктоп), Safari iOS, Chrome Android — две последние версии; Edge и Firefox — последние. Ширины 320, 390, 768, 1440 px. | Playwright projects |
| REQ-NFR-OBS-01 | Метрики: сохранение обращений, задержка API, длина очереди писем, ошибки ИИ; алерты в Grafana; Sentry для ошибок. | Наличие дашбордов и алертов |
| REQ-NFR-OPS-01 | Ежедневный бэкап PostgreSQL (pgBackRest) + WAL; проверка восстановления до запуска. | Протокол восстановления |

# 11. Конфигурация заглушек

Все значения хранятся в `app_config` (seed `packages/db/seed/config.json`) с `needs_confirmation = true` и доступны в коде через `config.get('<key>')`. Каждой заглушке соответствует ЗГ-* исходного ТЗ (PH-NN = ЗГ-NN). Перед выпуском `pnpm config:report` выводит все неподтверждённые ключи; ключи с `prodBlocked: true` блокируют сборку продуктива.

```json
{
  "PH-01 catalog.public_subjects": ["biology", "chemistry", "physics", "geography", "mathematics", "algebra", "geometry", "informatics", "history-of-kazakhstan", "kazakh-language", "russian-language", "english-language"],
  "PH-01 home.subjects_subtitle": "Предметы на казахском и русском — открывай любой",
  "PH-02 demo.questions": [{
    "text": "Какой сосуд несёт кровь от сердца к телу?",
    "options": ["Аорта", "Полая вена", "Капилляр", "Лимфатический сосуд"], "correct": 0,
    "explanation": "Аорта — главная артерия: по ней кровь из левого желудочка идёт ко всем органам тела."
  }],
  "PH-03 home.benefits": [
    "Интерфейс, уроки и квизы на казахском, русском и английском",
    "ИИ-наставник объясняет тему простыми словами",
    "Работает на обычных телефонах и слабом интернете",
    "Уроки и квизы доступны после входа",
    "Опыт, серии и бейджи показывают прогресс"
  ],
  "PH-04 i18n.enabled_locales": ["ru", "kk", "en"],
  "PH-04 i18n.review_status": { "kk": "needs_review", "en": "prepared" },
  "PH-05 brand.use_text_logo": true,
  "PH-05 team.photos": "initials",
  "PH-06 auth.password_min_length": 8,
  "PH-06 auth.reset_link_ttl_hours": 24,
  "PH-07 class.code": { "length": 6, "alphabet": "23456789ABCDEFGHJKLMNPQRSTUVWXYZ", "ttl_days": 30 },
  "PH-08 privacy.requests_as_tickets": true,
  "PH-09 support.email": { "value": "support@syntara-edu.me", "prodBlocked": true },
  "PH-10 atlas.urls": { "mendeleev": null, "anatomy": null, "label_when_null": "Ссылка скоро появится" },
  "PH-11 about.metric_access": "Пробный доступ — по условиям подключения",
  "PH-11 pricing.visible": false,
  "PH-12 schools.trial": "Одна учебная четверть; даты — по договорённости при подключении",
  "PH-13 features.offline": false,
  "PH-13 about.metric_pwa": "PWA — устанавливается на телефон",
  "PH-14 legal.draft_banner": { "value": "Черновик редакции — не действует до утверждения", "prodBlocked": true },
  "PH-15 forms.consent_text": "Отправляя форму, вы соглашаетесь с обработкой данных по Политике конфиденциальности.",
  "PH-16 infra.data_residency": "KZ",
  "PH-17 auth.student_self_registration": true,
  "PH-18 retention_days": { "tickets": 1095, "requests": 1095, "logs": 365, "backups": 30, "ai_messages": 365 },
  "PH-19 ai.mode": "mock",
  "PH-19 ai.public_quick_answers": {
    "Что это за платформа?": "Syntara — учебная платформа: уроки, квизы и ИИ-наставник на казахском и русском.",
    "С чего начать учёбу?": "Откройте «Предметы» и выберите предмет. Чтобы сохранять результаты, войдите или подключитесь к классу.",
    "Как сменить язык?": "Нажмите на переключатель языка в верхней панели.",
    "Нужна ли регистрация?": "Нет, чтобы смотреть сайт и попробовать вопрос. Для сохранения прогресса нужен вход."
  },
  "PH-19 ai.unavailable_public": "Помощник пока недоступен. Напишите в поддержку",
  "PH-19 ai.unavailable_tutor": "Учебный ИИ скоро будет доступен",
  "PH-20 ai.limits": { "per_minute": 10, "per_day": 50, "max_chars": 2000 },
  "PH-21 ai.quick_actions": { "simpler": "Объясни проще", "more_detail": "Расскажи подробнее", "check_me": "Проверь меня: задай 3 вопроса по теме" },
  "PH-21 ai.explain_level": "beginner",
  "PH-22 support.hours": { "days": "mon-fri", "from": "09:00", "to": "18:00", "tz": "UTC+5", "first_response_business_days": 1 },
  "PH-23 limits": { "title": 150, "description": 1000, "fun_fact": 500, "body_md": 50000, "question": 1000, "option": 300, "explanation": 2000, "min_options": 2 },
  "PH-24 teacher.mastery_map": "simple",   // решение владельца 2026-10-17: таблица «ученики × темы» (REQ-TCH-AN-01)
  "PH-25 topic.versions_restore": false,
  "PH-26 cover.selection": "last_action_wins",
  "PH-27 topic.unpublish_enabled": true,
  "PH-28 quiz.text_answer_normalize": ["trim", "collapse_spaces", "lowercase"],
  "PH-29 assignments.manual_review": false,
  "PH-30 analytics": { "red_below": 50, "green_from": 80, "max_rows": 10, "inactive_days": 7 },
  "PH-31 datetime.format": "DD.MM.YYYY HH:mm",
  "PH-32 notifications.limit": 20,
  "PH-33 student.assignments_page": true,
  "PH-34 student.continue_target": "last_opened_topic",
  "PH-35 topics.sequential_lock": false,
  "PH-36 overview.accordion_multi": true,
  "PH-37 quiz": { "check_mode": "immediate", "attempts_limit": null, "score": "best", "resume": true },
  "PH-38 progress": { "mastery_threshold": 80, "school_year": { "from": "09-01", "to": "05-25" },
    "quarters": [ { "from": "2026-09-01", "to": "2026-10-25" }, { "from": "2026-11-02", "to": "2026-12-27" },
                  { "from": "2027-01-11", "to": "2027-03-21" }, { "from": "2027-03-29", "to": "2027-05-25" } ] },
    // Четверти 2026–2027 (решение владельца 2026-10-17): каникулы — по официальной публикации; начало 1 сентября
    // и конец 25 мая — стандартные. TODO(OWNER): сверить с приказом Минпросвещения РК. Меняются в app_config без кода.
  "PH-39 xp": { "quiz_finished": 10, "high_score_bonus": 10, "high_score_threshold": 80, "first_lesson_open": 5, "per_level": 100, "failed_attempt_below": 50 },
  "PH-40 class.leave_confirm": true,
  "PH-41 load.expected": { "schools": 50, "students": 20000, "concurrent_sessions": 2000 },
  "PH-42 platform.tz": "Asia/Almaty",
  "PH-43 routes.legal": { "terms": "/terms", "privacy": "/privacy", "cookies": "/cookies" },
  "PH-44 auth.student_registration_by_class_code": {
    "enabled": true, "requires_valid_code": true, "email_required": false,
    "fields": ["displayName", "login", "password", "email?"], "status": "требует уточнения"
  },
  "PH-45 battle": {   // итерация 10.5, значения по умолчанию вопросов Q-BTL-01…10 (7.12) — TODO(OWNER)
    "join_scope": "class", "default_time_limit_sec": 20, "time_limits_sec": [5, 10, 20, 30, 60, 90],
    "late_join_default": false, "xp": { "enabled": false }, "question_types": ["single_choice", "true_false"],
    "show_question_on_student": true, "display_name": "first_name_initial", "max_participants": 100,
    "leaderboard_default": true, "code": { "letters": "ABCDEFGHIJKLMNOPQRSTUVWXYZ", "digits": "123456789" }
  }
}
```

В JSON префикс «PH-NN » в ключе показан для связи с таблицей; в реальном seed ключ — только часть после пробела, а PH-ID хранится в поле `note`.

**PH-44 — регистрация ученика.** Q-16 решён владельцем 2026-10-14: ограничение «только по коду класса» отменено — ученик регистрируется сам (PH-17 = true, BR-CLS-04, REQ-GEN-AUTH-02), код класса необязателен. Ниже — исходная редакция от 2026-10-13 (для истории).
**Исходная редакция (отменена):**
Ученик регистрируется только по действующему коду класса (BR-CLS-01). На `/join` после успешной проверки кода (API-PUB-08) гость без аккаунта вводит имя, логин и пароль (email необязателен; пароль — не короче PH-06). Сервер повторно проверяет код, создаёт пользователя с ролью `student` (без email — `is_child_safe = true`, вход по логину), фиксирует согласие в `consents` и создаёт активное членство в классе в одной транзакции. Без действующего кода регистрация ученика невозможна; ответ сервера не раскрывает данных класса до входа. Эндпоинт — `POST /api/auth/register-student { code, displayName, login, password, email? }` (лимиты как у проверки кода, API-GEN-06). Открытые вопросы: правила формата логина, согласие родителя для детей, вход по логину на /auth/login (поле «Email или логин»), восстановление пароля без email. Тексты экрана — `needs_confirmation`.

**PH-45 — Battle.** Значения по умолчанию для вопросов владельца Q-BTL-01…10 (7.12). Набор времени и формат кода закреплены также ограничениями БД (5.9: `time_limit_sec IN (…)`, `code ~ '^[A-Z]{3}[1-9]{3}$'`) — их изменение потребует миграции. `join_scope`, `xp.enabled`, `show_question_on_student` — пока поддерживается только значение по умолчанию; другое значение — отдельная задача после решения владельца.

**Недостающие тексты.** Видимые тексты, которых нет в документе, задаются заглушками в i18n-файлах и перечисляются в `packages/shared/i18n/needs_confirmation.json` (решение владельца, ред. 2026-10-13).

# 12. План реализации

Каждая итерация завершается выполнением DoD (0.5) и критериев AC, указанных в столбце «Готово, когда».

| **№** | **Итерация** | **Задачи** | **Готово, когда** |
|---|-----------|-----------------------|------------|
| 1 | Каркас | Монорепозиторий, Docker Compose (Postgres, Redis, MinIO, ClamAV), CI, линтеры, tokens.css, базовые компоненты, i18n-каркас, OpenAPI, Sentry/OTel | `pnpm dev` поднимает всё; CI зелёный |
| 2 | База данных | Миграции раздела 5, seed (config, демо, визуальные данные), RLS-политики | Миграции применяются и откатываются; seed проходит |
| 3 | Оболочка и публичные страницы | Хедер, футер, мобильное меню, плавающие кнопки, 10 страниц раздела 8.1 (без форм и ИИ), язык/тема/трафик, cookie-баннер | AC-PUB-01..03, AC-GEN-01..03 |
| 4 | Формы и поддержка | API-PUB-04/05, idempotency, outbox, email worker, служебная очередь /staff | AC-FRM-01..05, AC-SUP-01..02 |
| 5 | Пробный вопрос и публичный помощник | API-PUB-02/03/06, SM-DEMO, LLMProvider (mock + реальный), лимиты | AC-PUB-04..06 |
| 6 | Аккаунты и классы | Вход, регистрация учителя, сессии, CSRF, классы, коды, /join, Leave, «Мои данные» | AC-AUTH-01..04 |
| 7 | Кабинет учителя: контент | Предметы, выдача классу, темы, Markdown, файлы и проверка, публикация, версии, квиз | AC-TCH-01..07 |
| 8 | Интерфейс ученика: обучение | Каталог, урок, квиз, события, mastery, XP, бейджи | AC-ST-01..05 |
| 9 | Учебный ИИ | Диалоги, SSE, отмена, быстрые действия, /learn/assistant | AC-ST-06..07 |
| 10 | Задания, показатели, аналитика | Назначения, «Мои задания», /learn/progress, /learn/achievements, аналитика класса | AC-TCH-08..09, AC-ST-08..09 |
| 10.5 | Battle | Этапы B0–B6 (docs/PLAN.md): данные и тесты, движок и реальное время, интерфейсы ученика и ведущего, история и результаты, надёжность и нагрузка (7.12) | AC-BTL-01..18 |
| 11 | Качество и выпуск | Визуальные тесты по эталонам, axe, k6, проверка безопасности, бэкап/восстановление, отчёт заглушек | Все AC; REQ-NFR-*; отчёт `config:report` |

# 13. Критерии приёмки

Формат: Дано / Когда / Тогда. Каждый критерий реализуется как автоматический тест (Playwright или integration), кроме помеченных «ручн.».

| **ID** | **Дано** | **Когда** | **Тогда** |
|---|--------|--------|------------|
| AC-GEN-01 | Гость на любой публичной странице | Открывает страницу по прямому URL | Та же страница, что при переходе из меню; активный пункт меню соответствует странице |
| AC-GEN-02 | Форма заполнена наполовину, открыт урок | Пользователь меняет язык или тему | Введённые данные, тема урока и вкладка сохранены; выбор сохранён после перезагрузки |
| AC-GEN-03 | Ширина 320 px | Открыты все публичные страницы | Нет горизонтальной прокрутки; меню открывается и закрывается Escape; фокус возвращается |
| AC-PUB-01 | Главная | Загрузка | Секции в порядке REQ-PUB-HOME-01; H1 из трёх строк, третья синяя |
| AC-PUB-02 | Блок «Почему Syntara» | Клик по стрелке и клавиши ←/→ | Меняется активный пункт, панель и индикатор синхронно; нет автопрокрутки |
| AC-PUB-03 | Первый визит | Нажать «Только необходимые» | Аналитические cookie не ставятся; сайт работает; баннер больше не показывается |
| AC-PUB-04 | Пробный вопрос загружен | Ответ сети проверен до выбора | В ответе нет isCorrect; кнопка «Проверить ответ» неактивна до выбора |
| AC-PUB-05 | Выбран неверный вариант | «Проверить ответ» | «Пока неверно», подсвечены выбранный и правильный, показано объяснение; баллы не начислены |
| AC-PUB-06 | Публичный помощник, ai.mode = mock | Клик по быстрому вопросу; ввод своего вопроса | Ответ-справка из PH-19; на свой вопрос — «Помощник пока недоступен…» со ссылкой на /support |
| AC-FRM-01 | Форма заявки с пустыми обязательными полями | «Оставить заявку» | Ошибки у полей и сводка сверху; фокус на первом ошибочном; запрос не отправлен |
| AC-FRM-02 | Валидная заявка | Отправка | «Отправляем...»; после 201 — «Заявка получена», номер SR-…, email; в БД одна запись; outbox-событие создано в той же транзакции |
| AC-FRM-03 | Отправка с таймаутом | Повтор с тем же Idempotency-Key | В БД одна запись, ответ тот же |
| AC-FRM-04 | Нет сети | Отправка | «Нет соединения. Проверьте интернет и повторите отправку»; ввод сохранён |
| AC-FRM-05 | SMTP недоступен | Отправка формы | Заявка сохранена, успех показан; письмо в email_queue с повтором |
| AC-SUP-01 | Обращение в статусе new | Сотрудник назначает себя, отвечает, решает | Статусы по SM-TICKET; письмо в очереди; история и автор сохранены; заметка не попала в письмо |
| AC-SUP-02 | Обращение resolved | Пользователь отвечает на письмо | Статус reopened |
| AC-AUTH-01 | Гость на /join с годным кодом | Вводит код | «Код подходит. Войдите, чтобы присоединиться»; данных класса в ответе нет |
| AC-AUTH-02 | Ученик вошёл с кодом | Подтверждает вступление дважды | Одна активная запись membership |
| AC-AUTH-03 | 11 попыток проверки кода за 15 минут | Ещё попытка | 429 с retryAfterSeconds |
| AC-AUTH-05 | Гость на /auth/start?role=student | Регистрируется без кода и без email | Аккаунт child-safe; вход по логину; кабинет ученика с блоком «Подключиться к классу» |
| AC-AUTH-06 | Гость с годным кодом | Регистрируется с кодом | Ученик сразу в классе; школа — из класса |
| AC-AUTH-07 | Ученик без email в классе | Учитель задаёт временный пароль; ученик входит | Требуется смена пароля; старые сессии завершены; после смены — кабинет |
| AC-AUTH-08 | Учитель зарегистрировался | Открывает ссылку из письма | email подтверждён; напоминание «Подтвердите email» исчезает |
| AC-AUTH-04 | Ученик в классе | «Выйти из класса» и подтверждение | Карточка класса исчезает; предметы класса недоступны; личные результаты сохранены |
| AC-TCH-01 | Учитель | Создаёт предмет только с KK-названием | Предмет создан; данные RU/EN-вкладок, введённые ранее, не потеряны при переключении |
| AC-TCH-02 | Предмет с флагом каталога и черновой темой | Ученик запрашивает тему по ID | 404 |
| AC-TCH-03 | Учитель выдал предмет классу | Ученик класса открывает каталог | Видны предмет и только опубликованные темы |
| AC-TCH-04 | Тема | «Сгенерировать черновик ИИ» | Заполнены описание, факт, текст для RU и KK; тема не сохранена и не опубликована |
| AC-TCH-05 | Загрузка DOCX с макросом | Проверка файла | scan_status = rejected; сообщение «Файл отклонён…»; файл не доступен ученику |
| AC-TCH-06 | 20 материалов уже загружено | Загрузка 21-го | 413/422 с понятной ошибкой до загрузки |
| AC-TCH-07 | Форма вопроса «Выбор варианта» | Отмечены два правильных или один вариант | Ошибка валидации; вопрос не создан |
| AC-TCH-08 | Учитель назначил тему классу | Ученик открывает «Мои задания», проходит квиз | Назначение видно; после finish — submission graded; счётчики учителя обновлены |
| AC-TCH-09 | Класс с результатами | Открыть «Аналитика класса» | Значения совпадают с BR-AN-*; цвета по порогам; ученик без событий 7 дней в «Требуют внимания» |
| AC-ST-01 | Ученик открыл урок | Переключает вкладки и язык | URL меняет ?tab; тема и прогресс те же |
| AC-ST-02 | Квиз | Ответ на вопрос | Сразу «Верно/Неверно», правильный вариант, объяснение; правильный ответ не приходил ранее |
| AC-ST-03 | Попытка не завершена | Ученик уходит и возвращается | Продолжение с того же вопроса |
| AC-ST-04 | Квиз завершён с 85 % | finish | +20 XP; тема освоена; бейджи «Первый шаг» и «Тема освоена» при первом выполнении |
| AC-ST-05 | Событие quiz_finished обработано | Повторная обработка того же события | XP и бейджи не начислены повторно |
| AC-ST-06 | Вкладка Syntara AI | Вопрос и «Остановить» во время ответа | Сообщение сохранено со status partial и пометкой «Ответ прерван» |
| AC-ST-07 | Учебный ИИ | Ответ модели содержит ссылку и HTML-скрипт | Скрипт удалён; ИИ не изменил данные |
| AC-ST-08 | Мои показатели | Смена периода на «7 дней» | Даты периода и сравнения, прогресс и серия пересчитаны по BR-ST-* |
| AC-ST-09 | Ученик A | Запрос /api/student/... с ID объектов ученика B | 404 |
| AC-CNT-01 | Гость, базовый урок опубликован | Открывает каталог и урок | Виден «Обзор»; на «Квиз» и «Syntara AI» — приглашение войти; API квиза → 401; личные уроки учителей не видны |
| AC-CNT-02 | Ученик | Проходит квиз базового урока | Результат сохранён, начислены XP |
| AC-CNT-03 | Учитель или другая роль | Пытается изменить базовый предмет, тему, вопрос или файл | 404 или 401/403; данные не изменены |
| AC-CNT-04 | Импорт выполнен | Повторный запуск без изменений | Ни одной новой строки или версии; изменений 0 |
| AC-CNT-05 | Изменён файл темы | Импорт | Новая опубликованная версия; ученик видит новый текст; прогресс сохранён |
| AC-CNT-06 | Файл с ошибкой | Импорт | Код выхода 1, список ошибок; БД не изменена |
| AC-CNT-07 | Тема удалена из файлов | Импорт | Тема снята с публикации, не удалена; результаты учеников сохранены |
| AC-BTL-01 | Учитель | Создаёт тест из 5 вопросов, 2 импортирует из темы | Тест сохранён; импортированные вопросы — копии |
| AC-BTL-02 | Тест с вопросами | Запуск игры для класса | Код вида `^[A-Z]{3}[1-9]{3}$`, уникален среди активных |
| AC-BTL-03 | Ученик класса | Вводит код в нижнем регистре с пробелом | Попадает в лобби; учитель видит его без перезагрузки ≤ 1 с |
| AC-BTL-04 | Ученик другого класса | Вводит код | «Код не найден», без подробностей |
| AC-BTL-05 | Лобби с участниками | Учитель нажимает «Начать» | У всех участников вопрос появляется одновременно (разница ≤ 1 с), таймер совпадает |
| AC-BTL-06 | Идёт вопрос | Ученик отвечает | «Ответ принят»; в сетевых ответах нет правильности; счётчик у ведущего растёт |
| AC-BTL-07 | Идёт вопрос | Все ответили раньше времени | Вопрос закрывается досрочно, раскрытие у всех |
| AC-BTL-08 | Вопрос закрыт | Ответ после дедлайна + 500 мс | 409 `questionClosed`, ответ не засчитан |
| AC-BTL-09 | Ответ отправлен | Повтор того же ответа (повтор сети) | Один ответ в БД; второй запрос — 200 с тем же результатом |
| AC-BTL-10 | Идёт вопрос | Ученик теряет связь на 15 с | После переподключения видит текущую фазу; ответ, если успел, сохранён |
| AC-BTL-11 | Идёт игра | Перезапуск api | Игра продолжается, данные не потеряны |
| AC-BTL-12 | Равенство правильных | Итог | Выше тот, у кого меньше суммарное время правильных; полное равенство — одинаковое место |
| AC-BTL-13 | Последний вопрос | Завершение | Пьедестал 1–3 (золото, серебро, бронза), таблица остальных; у ученика своя строка выделена |
| AC-BTL-14 | Игра завершена | История | Учитель видит игру в истории с разбором по вопросам; ученик — в «Мои Battle» с местом |
| AC-BTL-15 | Участник в игре | Учитель выгоняет его | Участник видит сообщение, не может вернуться в эту игру, не входит в рейтинг |
| AC-BTL-16 | Сессия учителя A | Учитель B открывает её | 404 |
| AC-BTL-17 | Нагрузочные цели 7.12 | Сценарии k6 | Цели выполнены |
| AC-BTL-18 | Экраны Battle | axe, клавиатура | Без нарушений; игра проходится с клавиатуры; варианты различимы без цвета |
| AC-VIS-01 | Seed visual | Скриншот-тесты на эталонных размерах | Совпадение с T04–T10, U01–U13, S01–S26 в пределах порога (ручн. для итогового сравнения) |

# 14. Трассировка к исходному ТЗ

| **Исходное ТЗ (краткое, ред. 5.1)** | **Этот документ** |
|---------------------|---------------------|
| 1. Общие сведения | 0, 1 |
| 2.1–2.4 Дизайн, оболочка, мобильная версия, язык | 3 |
| 2.5 Публичные формы | 6.7, 7.9, 8.1.6–8.1.9 |
| 2.6 Служба поддержки | 6.6, 7.9, 8.5, 9 (SM-TICKET) |
| 2.7 Сервер и API | 6 |
| 2.8 Безопасность | 7.1, 7.8, 7.10, 10 |
| 2.9 Доступность и скорость | 10 |
| 3. Гостевой режим | 4, 8.1, 8.2 |
| 4. Кабинет учителя | 6.4, 7.5–7.8, 8.3 |
| 5. Интерфейс ученика | 6.5, 7.2–7.4, 8.4 |
| 6. Модель данных, 9. Архитектура БД | 5 |
| 7. Открытые вопросы, 11. Заглушки | 11, 15 (демо-данные) |
| 8. Приёмка | 13 |
| 10. Технологический стек | 2 |

# 15. Демо-данные эталонов (seed `visual`)

Эти значения со скриншотов загружаются только командой `pnpm db:seed --set=visual` для визуальных тестов (AG-08). В рабочем коде они MUST NOT использоваться как константы.

| **Экран** | **Данные** |
|-------|-----------------------------|
| Пользователь | Учитель и ученик «Alexandr», буква аватара «A»; школа «Школа-гимназия №73» |
| T04 | Классы «9» (Учеников: 1), «5» (Учеников: 0), «7» (Учеников: 0); тем нет |
| T05 | Предмет «Биология: сердце и кровообращение», описание «Материалы урока о строении сердца и движении крови.»; флажок каталога выключен |
| T06–T07 | Тема «Как работает сердце»; описание «Разбираем четыре камеры сердца и два круга кровообращения.»; факт «Клапаны помогают крови двигаться в одном направлении.»; текст урока с разделами «## Четыре камеры сердца», «## Два круга кровообращения», «## Проверьте себя»; 3 миниатюры в галерее; статус «Черновик — ученики не видят» |
| T08 | Вопрос «Какая камера сердца направляет кровь в аорту?»; варианты «Левый желудочек» (верный), «Правое предсердие»; объяснение «Левый желудочек выталкивает кровь в аорту, откуда она поступает к органам тела.»; тип «Выбор варианта», сложность «Лёгкий» |
| T09 | Форма: класс «9», предмет «Анатомия человека», тема «Сердечно-сосудистая система»; выданное задание «Фотосинтез», класс «7», «Сдано: 1 · На проверку: 0 · Оценено: 1»; очередь пуста |
| T10 | Класс «9»: успеваемость 64 %, вовлечённость 0/1; слабые темы: Сердечно-сосудистая система 33 % (красный), Дыхательная система 43 % (красный), Пищеварительная система 43 % (красный), Проценты 67 % (синий), Порядок слов 100 % (зелёный), у каждой «1 уч.»; «Требуют внимания»: Alexandr, «24 дня назад», «неактивен» |
| U01 | Хедер ученика: серия 1, 20 XP |
| U03 | Раздел «Биология» → «Анатомия человека», «11 систем организма», «Доступно» |
| U04, U09, U11, U12 | Предмет «Анатомия человека», тема «Сердечно-сосудистая система» / «Cardiovascular system», «Тема 1», «9 вопросов»; описание «Сердце и сосуды, обеспечивающие кровообращение.»; разделы 01–05 (+06 в EN); следующая тема «Дыхательная система» |
| U05 | «Вопрос 1 из 9», сложность «Средний», «Какой сосуд несёт кровь от сердца к телу?» — A Аорта, B Полая вена, C Капилляр, D Лимфатический сосуд |
| U06–U07 | Вопрос ученика «Почему у сердца четыре камеры?»; ответ — аналогия с домом из четырёх комнат и уточняющий вопрос |
| U08 | Период «30 дней», 30.08.2026 — 28.09.2026, сравнение 31.07.2026 — 29.08.2026; «Пройти короткий квиз сегодня» / «серия прервана»; прогресс 1 из 41 = 2,4 %; серия 0 дн., последнее занятие 05.09.2026 |
| U10 | Уровень 1 «Новичок», «Серия: 1 дн.», 20 XP, до следующего уровня 80 XP; получены «Первый шаг» и «Тема освоена» (на эталоне «2 из 17»; в продукте — «из 12», PH-39) |
| U13 | Класс «7», учитель Alexandr, школа «Школа-гимназия №73»; 7 карточек каталога из REQ-ST-CAT-02 |



# 16. Журнал изменений редакции

| **Дата** | **Изменение** | **Основание** |
|------|-----------------------------|------|
| 2026-10-13 | 5.3: `user_roles` — суррогатный `id` и `UNIQUE NULLS NOT DISTINCT (user_id, role, school_id)` вместо PK с nullable-столбцом | Решение владельца по Q-15 (docs/PLAN.md) |
| 2026-10-13 | 5.3: `users.login citext UNIQUE`; 7.7 BR-CLS-04, 8.2 REQ-GEN-AUTH-03, 11: заглушка PH-44 — регистрация ученика только по действующему коду класса (требует уточнения) | Решение владельца по Q-16 |
| 2026-10-13 | 3.4 REQ-GEN-PREF-02, 11 PH-04: включены все три языка (ru, kk, en); заранее подготовленные переводы kk/en допустимы, KK — `needs_review` | Решение владельца по Q-07 |
| 2026-10-13 | 11: недостающие тексты — заглушки с пометкой `needs_confirmation` | Решение владельца по Q-05, Q-06, Q-09 |
| 2026-10-13 | 5.7: столбец `app_config.note` (PH-ID) | Решение владельца по итогам итерации 2 |
| 2026-10-13 | 5.8: роль `app_maintenance` для фоновых задач worker (DELETE по срокам хранения и для файлов); у `app_user` DELETE нет | Решение владельца по итогам итерации 2 |
| 2026-10-13 | 15: в seed ученик «Alexandr» — в классе «7»; визуальные тесты сравнивают внешний вид и расположение, динамические значения (числа, даты, XP, серии) маскируются | Решение владельца по итогам итерации 2 |
| 2026-10-14 | 9 SM-TICKET, 6.6 API-SUP-04: ответ по шаблону «Уточнение» переводит обращение в waiting_user, по шаблону «Решение» — в resolved; ручная смена статуса сохраняется | Решение владельца по итогам итерации 4 |
| 2026-10-14 | 8.5 REQ-SUP-04, 11 PH-22: срок первого ответа считается в рабочих часах PH-22 (пн–пт 09:00–18:00, UTC+5): `first_response_business_days` рабочих дней от ближайшего рабочего момента после создания | Решение владельца по итогам итерации 4 |
| 2026-10-14 | 6.2 API-PUB-02: поле `hasAnother` (есть ли другие пробные вопросы) и `locale` в ответе | Решение владельца по итогам итерации 5 |
| 2026-10-14 | 5.3 (`users.email_verified_at`, `users.must_change_password`, `schools.status = unverified`), 6.2 API-PUB-09, 6.3 API-AUTH-03S/05/06 и MeDto, 6.4 API-T-26/27, 7.7 BR-CLS-04/05, 8.2 REQ-GEN-AUTH-01..03, 10 REQ-NFR-DATA-03, 11 PH-17 = true и PH-44 (Q-16 решён), 13 AC-AUTH-05..08: самостоятельная регистрация ученика (эталон `media/student-auth.png`), временный пароль от учителя, подтверждение email учителя | Решение владельца по итогам итерации 6 |
| 2026-10-16 | 2.3 `S3_PUBLIC_ENDPOINT`; 4 и 8.3.2 REQ-TCH-ACC-02: без отдельного экрана «Новая тема» (`/topics/new` → страница предмета); 6.4 API-T-10 (обложка по ссылке скачивается сервером), API-T-11 (название в черновике); 6.5 API-S-06 (`funFact`, `materials`); 7.8 BR-FILE-06 (обложка по ссылке, защита от SSRF) и BR-FILE-07 (очистка незавершённых загрузок); 8.3.3 REQ-TCH-TOP-02/04; 8.4.3 REQ-ST-LES-02 (карточка «Интересный факт», также в «Посмотреть глазами ученика») | Решение владельца по итогам итерации 7 |
| 2026-10-16 | 2.2: очередь recalc удалена; 3.3 REQ-GEN-SHELL-01 («Кабинет» у вошедшего), REQ-GEN-SHELL-02 (роль один раз); 4 и 8.4.2 REQ-ST-CAT-04: страница предмета ученика `/learn/subjects/:id` со статусами тем; 6.2 API-PUB-02 `subjectId`; 6.5 API-S-06 `quizId`, API-S-08 `correctAnswer`, API-S-16 `continueTopicId` и «живая» серия, новая API-S-18; 7.2 BR-QZ-09 (пробный вопрос в квизе темы); 7.3 BR-XP-04 (начисление синхронно, Q-17 решён); 8.4.4 REQ-ST-QZ-01 (клавиатура), REQ-ST-QZ-02 (формат результата) | Решение владельца по итогам итерации 8 |
| 2026-10-16 | Этап 8.6 «Базовая программа платформы»: 1.1, 1.2 (гость читает базовые уроки; базовый контент не меняется через сайт); 2.2 `content/`; 2.4 `content:check`, `content:import`; 4 гостевой доступ к /learn/...; 5.4 коды `code` и `topic_translations.needs_review`; 6.2 API-PUB-01 (PH-01 — разделы и базовые предметы, `open`), API-PUB-10..13; 6.5 API-S-04/05 `soon`, API-S-06 `needsReview`, подписи и иллюстрации разделов; 7.1 BR-ACL-05, BR-VIS-04; 7.11 BR-CNT-01..08; 8.1.2 REQ-PUB-SUBJ-02; 8.4.2 REQ-ST-CAT-02 «Скоро»; 8.4.3 REQ-ST-LES-06/07; 11 PH-01; 13 AC-CNT-01..07. Роли «Методист» нет; деления на классы нет (1.3 в силе) | Решение владельца 2026-10-16 по вопросам этапа 8.6 |
| 2026-10-16 | 15: seed `visual` больше не переписывает базовые уроки — эталонные значения U03 «11 систем организма», U04/U05 «9 вопросов», U08 «из 41 темы», U13 «Chemistry — Available» не воспроизводятся (базовые уроки — только `content/`, BR-CNT-01); 2.2 `scripts/content-art/` — исходники собственных схем | Этап 8.6 |
| 2026-10-17 | 5.4 `subjects.position` (миграция 0006); 6.2 API-PUB-01 — порядок по content/; 7.11 BR-CNT-02 — порядок предметов в `subject.yaml`, предметов вне разделов нет (`content/_root/` убран); 8.1.1 REQ-PUB-HOME-06 — не больше 6 карточек, открытые первыми, «Все предметы →»; 8.4.2 REQ-ST-CAT-02 — «Химия» в «Естественных науках» (отступление от эталона U13: карточки «Chemistry — Available» вне разделов больше нет); 8.4.3 REQ-ST-LES-06 — текст приглашения на «Syntara AI», REQ-ST-LES-07 — ширина иллюстраций разделов | Решение владельца 2026-10-17 при приёмке этапа 8.6 |
| 2026-10-17 | 2.3 `LLM_BASE_URL`, обязательность `LLM_API_KEY`/`LLM_MODEL` при реальном поставщике; 6.5 API-S-11 (один действующий диалог на тему и общий), API-S-12 (событие `ai_question`, mock → `AI_UNAVAILABLE`, лимиты PH-20 на ученика), API-S-13 (формат истории); 7.10 BR-AI-07 (санитизация учебного ИИ), BR-AI-08 (не решает за ученика — предложение, TODO(OWNER)), BR-AI-09 (текст темы для ИИ) | Итерация 9, решение владельца 2026-10-17 |
| 2026-10-17 | 7.10 BR-AI-08 подтверждено; 8.4.5 REQ-ST-AI-03 — абзац U02 «Syntara анализирует ваш прогресс…» не выводится, пока такой функции нет (отступление от эталона); REQ-ST-AI-04 — mock: вопрос сохраняется, ответ PH-19; лимиты PH-20 на ученика; Q-11 — реальный ИИ пока не подключается, mock по умолчанию, порядок подключения — docs/AI_PROVIDER.md (хранение данных в РК — обязательный критерий) | Решение владельца 2026-10-17 при приёмке итерации 9 |
| 2026-10-17 | 6.4 API-T-22 (ошибки и аудит), API-T-23, API-T-25, новая API-T-28 (что можно назначить классу); 6.5 API-S-07 `assignmentId` (Q-18), API-S-10 (формат), API-S-14 (`period`, `availablePeriods`, формат `nextStep`, по умолчанию 30d), API-S-15 `xpPerLevel`; 7.4 BR-ST-05 (значения на конец периода, дельты к концу периода сравнения), BR-ST-06; 7.5 BR-AN-02 (базовые предметы, округление), BR-AN-04/05; 7.6 BR-ASG-03 (только попытка из задания, аудит оценок) | Итерация 10; показатели и аналитика учитывают базовые и личные уроки — решение владельца 2026-10-17 |
| 2026-10-17 | 11 PH-38 — четверти 2026–2027 и учебный год 01.09–25.05 (TODO(OWNER): сверить с приказом Минпросвещения); 7.4 BR-ST-04 — на каникулах последняя начавшаяся четверть; 7.6 BR-ASG-03 — засчитывается и квиз из урока после выдачи задания, сдача после срока — «Сдано после срока»; 6.5 API-S-10 `late`; 8.4.8 REQ-ST-ASG-01; 8.4.6 REQ-ST-PRG-01/02 — подзаголовок и блок «Начни отсюда» с эталона U08; 8.3.7 REQ-TCH-AN-01 и новая API-T-29 — «Карта освоения» (простая версия вместо PH-24); BR-ST-05 (толкование) и правила назначения (только опубликованные темы, свой предмет — выданный классу) подтверждены | Решение владельца 2026-10-17 при приёмке итерации 10 |
| 2026-10-20 | Итерация 10.5 «Battle» (docs/BATTLE_TZ.md): 1.1, 1.2 (матрица — Battle учителя и ученика); 2.2 (модуль `battle`, очередь worker `battle`); 4 (маршруты `/teacher/battles…`, `/teacher/battle-sessions/…`, `/learn/battles…`); 5.2 и 5.9 (таблицы `battle_*`, перечисления, RLS, аудит); 6.1 API-GEN-06 (лимиты Battle); 6.8 API-BTL-01…11, 20…31, 40…46; 6.9 события SSE; 7.12 BR-BTL-01…12, настройки сессии, нагрузочные цели, вопросы Q-BTL-01…10 (TODO(OWNER), значения по умолчанию); 8.6 REQ-BTL-GEN-01…03, REQ-BTL-T01…T11, REQ-BTL-S01…S07; 9 SM-BTL; 11 PH-45; 12 итерация 10.5; 13 AC-BTL-01…18 | Команда владельца 2026-10-20: выполнить docs/BATTLE_TZ.md (этап B0) |
| 2026-10-20 | 6.8 — коды ошибок Battle вне ТЗ (`notInGame`, `classNotFound`, `participantNotFound`, `codeUnavailable`, `invalidTransition`, 429 ответов); API-BTL-10 — вопросы темы в ответе (выбор чекбоксами); 7.12 BR-BTL-10 — критерий подходящих для импорта вопросов, BR-BTL-11 — команда `pnpm battle:anonymize`; нагрузочные цели проверены (docs/BATTLE.md) | Этапы B1–B6 итерации 10.5 |
