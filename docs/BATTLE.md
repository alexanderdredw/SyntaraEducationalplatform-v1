# Battle — как устроено и как отлаживать

Живая викторина для класса (итерация 10.5). Требования — `docs/SPEC.md`: 5.9 (таблицы), 6.8–6.9 (API и события), 7.12 (правила BR-BTL-*, настройки, нагрузочные цели, вопросы владельцу Q-BTL-*), 8.6 (экраны), 9 (SM-BTL). Исходное ТЗ — `docs/BATTLE_TZ.md`.

## Схема

```
ученик (браузер) ──POST ответ──▶ api ──INSERT battle_answers──▶ PostgreSQL (источник истины)
      ▲                           │  └─ INCR battle:answered:{sid}:{i} ──▶ Redis
      │ SSE                       │
      └──── api (любой экземпляр) ◀── PSUBSCRIBE battle:* ◀── PUBLISH battle:{sid} ◀── api / worker
                                                                                       ▲
worker: очередь BullMQ «battle» — таймер закрытия вопроса (дедлайн + 500 мс), автопереход, истечение раз в минуту
```

- **Переходы SM-BTL** — одна реализация: `packages/db/src/battle/engine.ts` (`@syntara/db/battle`). Каждый переход — транзакция с `SELECT … FOR UPDATE` строки сессии, проверкой фазы, номера вопроса и `state_version`; повтор ничего не меняет. Результат перехода — внутренние события и таймеры.
- **api** — `apps/api/src/modules/battle/`:
  - `battle-engine.service.ts` — вызывает переходы, публикует события, ставит таймеры в очередь `battle`;
  - `battle-realtime.gateway.ts` — SSE-соединения, подписка `PSUBSCRIBE battle:*`, раздача по аудитории (`host`, `students`, `participant:{id}`, `all`), персонализация ученика (своё место, свой ответ) на экземпляре, держащем его соединение; heartbeat `: ping` каждые 15 с, отметка `last_seen_at`, не больше 2 потоков на пользователя в сессии, закрытие после выхода из аккаунта и через 60 с после `finished`/`cancelled`;
  - `battle-state.service.ts` — снимки API-BTL-21/41 и итоги API-BTL-30/46;
  - `battle-session.service.ts`, `student-battle.service.ts` — сессии ведущего и участие ученика;
  - `battle-quiz.service.ts` — Battle-тесты, вопросы, импорт из квизов тем.
- **worker** — `apps/worker/src/processors/battle.ts`: задачи `close-question`, `auto-next` (тот же идемпотентный переход) и `expire` (BR-BTL-06).
- **web** — `apps/web/components/battle/`: `use-battle-stream.ts` (EventSource, переподключение 1/2/4/8/10 с, баннер после 3 неудач, поправка часов `serverNow`), `student-game.tsx`, `host-game.tsx`, редактор, история, итоги.

Правильный вариант покидает сервер только в раскрытии: снимок и события ученика до `reveal` его не содержат (проверяют integration- и e2e-тесты).

## Как проверить вживую

1. `pnpm infra:up`, `pnpm db:migrate`, `pnpm db:seed --set=demo`, `pnpm dev` (web, api, worker).
2. Учитель: регистрация на `/ru/auth/start?role=teacher` → «Классы» → создать класс и код → «Battle» → «Новый Battle» → вопросы (или «Импорт из темы») → «Мои Battle» → «Запустить» → класс → «Создать игру».
3. Ученики (2–3 окна в режиме инкогнито): `/ru/auth/start?role=student` с кодом класса → «Battle» → ввести код игры.
4. Ведущий: «Начать» → ответы → «Далее» → … → пьедестал → «Подробные результаты» / «Экспорт CSV».

Скриншоты: `node e2e/scripts/battle-shots.mjs` (api с `RATE_LIMITS_DISABLED=true`) → `docs/media/battle/`.

## Отладка

- **События сессии в Redis:** `docker compose -f infra/docker-compose.yml exec redis redis-cli PSUBSCRIBE 'battle:*'` — видно каждое внутреннее событие (включая правильность — это канал между экземплярами api, клиентам он не отдаётся).
- **Поток как у клиента:** `curl -N -H "Cookie: sid=…" http://localhost:3001/api/student/battle-sessions/<sid>/events` — первым придёт `snapshot`, далее события с `id: {version}-{seq}`.
- **Состояние в БД:** `select status, phase, current_index, state_version, deadline_at from battle_sessions where id = '…'`; ответы — `battle_answers`, итоги — `battle_participants.final_rank`.
- **Вопрос не закрывается по времени** — не запущен worker (очередь `battle`). Досрочное закрытие «все ответили» работает и без него.
- **409 `staleState`** — клиент прислал старую `expectedVersion`; в теле ошибки — свежий `snapshot`, экран ведущего обновляется им.
- **Код «не найден»** — ученик не в классе сессии, сессия закончилась или код набран с ошибкой (ответ одинаков, BR-BTL-02).
- **nginx:** для `…/events` — отдельный `location` в `infra/nginx.conf` (`proxy_buffering off`, `gzip off`, `proxy_read_timeout 3600s`, `X-Accel-Buffering: no`, HTTP/1.1 к upstream).
- **Обезличивание по запросу «Мои данные»:** `pnpm battle:anonymize --student=<id>` (BR-BTL-11).

## Нагрузка и надёжность (этап B6)

| Сценарий | Команда | Цель (SPEC 7.12) |
|---|---|---|
| 1 сессия × 100, вопрос 10 с, ответы за 3 с | `node e2e/load/battle-load.mjs one` | p95 ответ → `answer_accepted` ≤ 300 мс; p95 закрытие → `question_revealed` у всех ≤ 1 с; без потерь |
| 20 сессий × 40 одновременно, 3 вопроса | `node e2e/load/battle-load.mjs many` | без ошибок, без потерь |
| Перезапуск api посреди вопроса | `node e2e/load/battle-load.mjs restart` (api запускает сам, порт свободен) | переподключение ≤ 10 с, ответы не потеряны, игра продолжилась |
| HTTP-ответы (k6) | `docker run --rm -i --add-host api:host-gateway -e BASE=http://api:3001 grafana/k6:0.54.0 run - < e2e/load/battle-answers.k6.js` | p95 POST ответа < 300 мс |

SSE-метрики снимает `battle-load.mjs` (в ядре k6 нет SSE-клиента). Время «закрытие → раскрытие» считается от ответа, закрывшего вопрос (закрытие выполняется в той же транзакции обработки), до получения `question_revealed` каждым клиентом. Через nginx: `--base=http://localhost:8088` при запущенном контейнере nginx с `infra/nginx.conf`.

Результаты прогона 2026-10-20 (один экземпляр api, локальная машина, Docker Desktop):

| Сценарий | Результат |
|---|---|
| 1 × 100 | p95 `answer_accepted` 39 мс; p95 раскрытие 2 мс; 100 из 100 ответов |
| 1 × 100 через nginx | p95 `answer_accepted` 35 мс; p95 раскрытие 5–6 мс; 100 из 100 |
| 20 × 40 | p95 `answer_accepted` 46 мс; p95 раскрытие 1 мс; 2400 из 2400; 20 из 20 сессий без ошибок |
| Перезапуск api | 30 клиентов переподключились за 3,2 с; 60 из 60 ответов; игра завершена |
| k6, 100 ответов | 100 % приняты; p95 POST ответа 17,5 мс |
