---
type: execution-plan
date: 2026-04-24
seq: "04"
status: ready-for-implementation
tags:
  - WhaleScope
  - postgresql
  - render
  - storage
  - google-sheets
  - incident-recovery
related:
  - 2026-04-24-01-WhaleScope-Sheets-10M셀한도-진단리포트.md
  - 2026-04-24-02-WhaleScope-Sheets-10M한도-Option-A-실행계획.md
  - 2026-04-24-03-WhaleScope-Sheets-10M복구-검증리포트.md
---

# WhaleScope PostgreSQL 전환 개선계획 — Render Cron 유지 전제

## 0. 결정 요약

Render cron은 중단하지 않는다. 대신 Google Sheets를 primary operational database로 계속 쓰는 전략을 중단하고, **PostgreSQL을 primary write/read 저장소**로 승격한다.

핵심 판단:

- Google Sheets 10M 셀 한도는 일시 장애가 아니라 저장소 선택의 구조적 한계다.
- `transactions`, `address_activity`, `service_health`, `system_log`, `market_snapshots`처럼 고빈도 append 탭은 Sheets에 적합하지 않다.
- Render cron을 살려두려면 append 실패가 전체 job 실패로 전파되지 않게 만들고, 쓰기 대상은 Postgres로 우회해야 한다.
- Sheets는 심사용 요약, 수동 확인, 저빈도 mirror 용도로 축소한다.

## 1. 현재 장애와 방향 전환 이유

### 1.1 현재 에러

Render cron `python -m src.pipeline.run_all` 실행 중 여러 쓰기 경로가 같은 오류로 실패한다.

```text
gspread.exceptions.APIError: [400]:
This action would increase the number of cells in the workbook above the limit of 10000000 cells.
```

실패 지점:

| 파일 | 함수/로직 | 실패 이유 |
|---|---|---|
| `src/storage/sheets_client.py` | `append_transactions` | `transactions` append 시 workbook grid 확장 필요 |
| `src/storage/sheets_client.py` | `append_address_activity` | `address_activity` append 시 workbook grid 확장 필요 |
| `src/storage/sheets_client.py` | `append_system_log` | `system_log` append 시 workbook grid 확장 필요 |
| `src/storage/sheets_client.py` | `log_run` | `system_log` append 시 workbook grid 확장 필요 |
| `src/storage/sheets_client.py` | `append_service_health` | `service_health` append 시 workbook grid 확장 필요 |
| `src/pipeline/run_all.py` | `_record_job_heartbeat`, final dispatcher heartbeat | heartbeat write 실패가 job failure로 전파 |

### 1.2 Option A만으로 부족한 이유

`2026-04-24-02`의 Option A는 워크북 셀 수를 줄이는 복구 수단이다. 하지만 Render cron을 계속 살려두면 다음 문제가 남는다.

- 15분마다 `signals`, `curated_balance`, `news_rss`, `broadcast_periodic`가 돌며 고빈도 탭을 다시 증가시킨다.
- `service_health`와 `system_log`는 운영 관측을 위해 자주 쓰이지만 Sheets에서는 가장 먼저 한도를 밀어올린다.
- purge/resize를 반복하는 운영은 데이터 보존 정책이 아니라 임시 청소에 가깝다.

따라서 단기적으로는 Sheets 쓰기를 줄이고, 중기적으로는 Postgres로 primary storage를 이전한다.

## 2. 목표 아키텍처

```text
Render Cron / Workers
  ├─ src.pipeline.run_all
  ├─ scripts.run_bot
  └─ scripts.run_listener

Storage boundary
  ├─ PostgresClient  ← primary write/read
  ├─ SheetsClient    ← legacy mirror / low-volume report
  └─ MirrorStorage   ← optional: Postgres primary + Sheets summary mirror

Dashboard
  ├─ /              ← Postgres read first
  ├─ /admin         ← Postgres observability first
  └─ /about         ← repo markdown + docs/obsidian manifest
```

운영 원칙:

- cron은 계속 살아있어야 한다.
- 고빈도 append는 Postgres에만 쓴다.
- Sheets write 실패는 cron exit 1의 직접 원인이 되지 않아야 한다.
- Sheets mirror는 저빈도/저용량 summary만 허용한다.

## 3. 신규 환경변수

### 3.1 Render pipeline/bot/listener 공통

| Env | 값 | 기본값 | 설명 |
|---|---|---|---|
| `STORAGE_BACKEND` | `sheets`, `postgres`, `dual`, `mirror` | `sheets` | 저장소 선택. 운영 전환 후 `postgres` 권장 |
| `DATABASE_URL` | Postgres connection URL | 없음 | Render PostgreSQL 또는 외부 Postgres URL |
| `SHEETS_WRITE_MODE` | `full`, `summary_only`, `disabled` | `full` | Sheets write 범위 |
| `SHEETS_QUOTA_ERRORS_FATAL` | `true`, `false` | `false` | Sheets quota error가 cron 실패로 전파될지 |
| `POSTGRES_SSLMODE` | `require`, `prefer`, `disable` | `require` | Render/Supabase/Neon 연결용 |
| `STORAGE_MIGRATION_BATCH_SIZE` | 정수 | `1000` | Sheets → Postgres import 배치 크기 |

### 3.2 Vercel dashboard

| Env | 값 | 기본값 | 설명 |
|---|---|---|---|
| `DASHBOARD_DATA_BACKEND` | `sheets`, `postgres` | `sheets` | dashboard read source |
| `DATABASE_URL` | Postgres connection URL | 없음 | server-only secret |
| `GOOGLE_SHEET_ID` | legacy mirror read | 유지 | fallback 또는 about/debug용 |
| `GOOGLE_CREDENTIALS_JSON` | legacy mirror read | 유지 | fallback 또는 about/debug용 |

## 4. 관련 파일과 함수

### 4.1 Python storage boundary

| 파일 | 현재 역할 | 변경 방향 |
|---|---|---|
| `src/storage/protocol.py` | `Storage` Protocol 정의 | Postgres 구현이 따라야 할 계약으로 확장 |
| `src/storage/sheets_client.py` | Google Sheets read/write 전체 구현 | low-volume mirror 및 legacy fallback으로 격하 |
| `src/storage/schema.py` | Sheets tab headers | Postgres table schema와 매핑 테이블의 단일 참조로 활용 |
| `src/storage/queries.py` | row/dict 변환, `now_iso` | Postgres row normalization에도 재사용 |
| `src/pipeline/common.py` | `build_sheets_client`, `load_pipeline_env`, persist helpers | `build_storage_client`, `StorageEnv`, `SHEETS_WRITE_MODE` 추가 |
| `src/pipeline/run_all.py` | cron orchestrator | heartbeat failure non-fatal, duplicate guard Postgres화 |
| `src/observability/service_health.py` | `append_service_heartbeat` | storage backend에 맞게 fatal/non-fatal 정책 분리 |

우선 구현할 신규 파일:

| 파일 | 목적 |
|---|---|
| `src/storage/postgres_client.py` | `Storage` Protocol 구현 |
| `src/storage/postgres_schema.py` | `CREATE TABLE`, index, upsert SQL 정의 |
| `src/storage/factory.py` | `STORAGE_BACKEND` 기반 client 생성 |
| `src/storage/mirror_client.py` | Postgres primary + Sheets summary mirror 선택 구현 |
| `scripts/init_postgres.py` | Postgres schema 생성 |
| `scripts/migrate_sheets_to_postgres.py` | 최근 Sheets 데이터 import |
| `scripts/validate_postgres_counts.py` | import 후 row count 검증 |

### 4.2 Pipeline write 경로

| 파일 | 함수 | Postgres 전환 시 주의점 |
|---|---|---|
| `src/pipeline/common.py` | `persist_chain_activity` | `append_address_activity`, `append_transactions`는 Postgres primary |
| `src/pipeline/common.py` | `log_unknown_price_symbols` | `append_system_log`는 Postgres primary, Sheets mirror off |
| `src/pipeline/signals.py` | `run_signals_pipeline` | `log_run`, signal 저장, service health 모두 Postgres |
| `src/pipeline/brief.py` | `run_brief_pipeline` | `list_transactions`, `save_daily_brief`, `append_brief_cost_ledger`, `log_run` |
| `src/pipeline/stories.py` | `run_stories_pipeline` | `list_transactions`, `log_run`, story 저장 |
| `src/pipeline/broadcast_periodic.py` | `run_broadcast_periodic` | `list_transactions`, `append_broadcast_log`, `log_run` |
| `src/pipeline/broadcast_daily.py` | `run_broadcast_daily` | `append_broadcast_log`, `log_run` |
| `src/pipeline/channel_health.py` | `run_channel_health` | `append_channel_health`, `log_run` |
| `src/ingestion/news_rss.py` | `run_news_rss_refresh` | `news_feed`는 Postgres upsert + Sheets optional mirror |
| `src/ingestion/telethon_listener.py` | `_handle_message`, heartbeat | `tg_whale_events`, `system_log`, `service_health`를 Postgres primary |

### 4.3 Dashboard read 경로

| 파일 | 현재 역할 | 변경 방향 |
|---|---|---|
| `apps/dashboard/lib/env.ts` | Google Sheets env 파싱 | `DATABASE_URL`, `DASHBOARD_DATA_BACKEND` 추가 |
| `apps/dashboard/lib/sheets.ts` | Sheets read client | fallback 또는 legacy mirror read로 유지 |
| `apps/dashboard/lib/metrics.ts` | `getDashboardData`, sheet rows aggregate | `readDashboardSnapshotSafe()`를 backend factory로 감싸기 |
| `apps/dashboard/lib/schema.ts` | Sheets row types | Postgres row type과 공통 normalization 유지 |
| `apps/dashboard/app/admin/page.tsx` | 운영 관측 화면 | Postgres 기반 service/system/broadcast health를 우선 표시 |
| `apps/dashboard/app/page.tsx` | 사용자 홈 | Postgres 기반 brief/signal/story/news data 사용 |
| `apps/dashboard/app/api/dashboard/route.ts` | dashboard API | backend에 무관한 normalized response 유지 |

신규 파일 후보:

| 파일 | 목적 |
|---|---|
| `apps/dashboard/lib/postgres.ts` | server-side Postgres read client |
| `apps/dashboard/lib/data-source.ts` | `DASHBOARD_DATA_BACKEND` 선택 factory |
| `apps/dashboard/lib/postgres-schema.ts` | TypeScript row mapping 또는 SQL query constants |

### 4.4 프롬프트 관련 파일

프롬프트는 storage migration의 직접 변경 대상이 아니다. 다만 브리핑 컨텍스트 조회 경로가 Postgres로 바뀌어도 입력 payload 구조는 유지해야 한다.

| 프롬프트 | 영향 | 가드 |
|---|---|---|
| `prompts/daily_brief.full.system.txt` | 직접 변경 없음 | 입력 데이터 필드명 유지 |
| `prompts/daily_brief.full.user.txt` | 직접 변경 없음 | `transactions`, `signals`, `news` 컨텍스트 shape 유지 |
| `prompts/daily_brief.incremental.system.txt` | 직접 변경 없음 | incremental/full 분기 유지 |
| `prompts/daily_brief.incremental.user.txt` | 직접 변경 없음 | 최근 window query가 Postgres로 바뀌어도 prompt payload 동일 |
| `prompts/weekly_trend.system.txt` | 직접 변경 없음 | weekly trend SQL 결과를 기존 row shape로 변환 |
| `prompts/nl_intent.system.txt` | 직접 변경 없음 | Telegram bot intent와 무관 |

프롬프트 회귀 기준:

- `brief.py`에서 LLM에 넘기는 dict key가 migration 전후 동일해야 한다.
- prompt 파일을 건드리는 변경은 별도 PR로 분리한다.
- Postgres 전환 PR에서는 prompt text diff가 없어야 한다.

## 5. Postgres 테이블 설계 초안

### 5.1 원칙

- append-only 로그는 `id bigserial primary key`를 추가한다.
- 외부 중복 키가 있는 도메인은 unique index를 둔다.
- dashboard 최신 조회 경로에 필요한 timestamp index를 둔다.
- JSON 성격의 `details`, `extra_json`, `payload`는 `jsonb`.
- Sheets header 이름과 최대한 동일한 column name을 유지해 migration 비용을 줄인다.

### 5.2 핵심 테이블

```sql
create table if not exists transactions (
  id bigserial primary key,
  raw_response_hash text unique,
  hash text,
  timestamp timestamptz,
  blockchain text,
  symbol text,
  amount numeric,
  amount_usd numeric,
  from_address text,
  from_owner_type text,
  from_owner text,
  to_address text,
  to_owner_type text,
  to_owner text,
  created_at timestamptz not null default now()
);
create index if not exists idx_transactions_created_at on transactions(created_at desc);
create index if not exists idx_transactions_hash on transactions(hash);
create index if not exists idx_transactions_chain_symbol on transactions(blockchain, symbol);

create table if not exists address_activity (
  id bigserial primary key,
  tx_hash text,
  chain text,
  block_time timestamptz,
  watched_address text,
  direction text,
  counterparty text,
  counterparty_category text,
  token text,
  amount_token numeric,
  amount_usd numeric,
  collected_at timestamptz not null default now(),
  unique(tx_hash, watched_address, direction)
);
create index if not exists idx_address_activity_collected_at on address_activity(collected_at desc);

create table if not exists service_health (
  id bigserial primary key,
  ts timestamptz not null default now(),
  service text,
  component text,
  status text,
  heartbeat_key text,
  details jsonb,
  error text,
  instance_id text,
  job_name text,
  last_success_at timestamptz,
  last_failure_at timestamptz,
  processed_count integer,
  lag_seconds integer,
  duration_ms integer,
  source_name text,
  supported_chains text,
  unsupported_chain_count integer,
  unsupported_chain_names text,
  per_chain_event_count text
);
create index if not exists idx_service_health_ts on service_health(ts desc);
create index if not exists idx_service_health_job_ts on service_health(job_name, ts desc);

create table if not exists system_log (
  id bigserial primary key,
  run_id text,
  run_type text,
  status text,
  started_at timestamptz,
  finished_at timestamptz,
  transactions_count integer,
  errors text,
  details jsonb
);
create index if not exists idx_system_log_started_at on system_log(started_at desc);
create index if not exists idx_system_log_run_type on system_log(run_type, started_at desc);
```

추가 테이블은 `src/storage/schema.py`의 headers 기준으로 다음 순서로 만든다.

| 우선순위 | 테이블 | 이유 |
|---:|---|---|
| P0 | `transactions`, `address_activity`, `system_log`, `service_health` | 현재 장애 직접 원인 |
| P1 | `signals`, `daily_briefs`, `tg_whale_events`, `broadcast_log` | dashboard와 Telegram 운영 핵심 |
| P2 | `news_feed`, `market_snapshots`, `brief_cost_ledger`, `llm_budget_log` | observability와 brief 품질 |
| P3 | `subscribers`, `user_interests`, `watched_addresses`, `curated_wallets`, `wallet_aliases`, `curated_wallet_balances` | config/upsert 성격 |

## 6. 구현 Phase

### Phase 0 — Cron 생존 핫픽스

목표: Render cron은 계속 실행하되 Sheets 한도 초과가 cron exit 1을 만들지 않게 한다.

변경 파일:

- `src/utils/errors.py`
- `src/utils/retry.py`
- `src/storage/sheets_client.py`
- `src/pipeline/run_all.py`
- `src/observability/service_health.py`
- `src/pipeline/common.py`

구현 항목:

- [x] `StorageQuotaExceeded` 예외 추가.
- [x] gspread `APIError [400] This action would increase...10000000 cells`를 retry하지 않고 즉시 `StorageQuotaExceeded`로 변환.
- [x] `append_service_heartbeat` 실패를 `run_all` fatal로 전파하지 않는 safe wrapper 추가.
- [x] `SHEETS_WRITE_MODE=summary_only|disabled|full` 추가.
- [x] `summary_only`에서 skip할 write: `transactions`, `address_activity`, `service_health`, `system_log`, `tg_whale_events`. `market_snapshots`는 현재 writer가 없어 추가 skip 대상 없음.
- [x] `summary_only`에서 허용할 write: `daily_brief`, `signals` 최신 summary, `channel_health` 정도로 제한.
- [x] `run_all.main()`은 job 자체 실패만 exit 1로 처리하고, quota성 observability write 실패는 exit 0 가능하게 분리.

QA:

- [x] unit: Sheets quota error는 retry 3회 하지 않음.
- [x] unit: final dispatcher heartbeat 실패에도 `run_all()` summary 반환.
- [x] unit: `SHEETS_WRITE_MODE=summary_only`에서 high-churn writes skip.
- [ ] Render: 다음 cron 1회가 exit 0 또는 controlled `completed_with_errors`로 종료.

### Phase 1 — Postgres schema와 client 추가

목표: Postgres에 primary write 가능한 저장소 구현.

변경 파일:

- `requirements.txt`
- `pyproject.toml`
- `src/storage/postgres_schema.py`
- `src/storage/postgres_client.py`
- `src/storage/factory.py`
- `tests/test_postgres_client.py`
- `tests/test_storage_factory.py`
- `scripts/init_postgres.py`

라이브러리 후보:

- Python: `psycopg[binary]` 또는 `psycopg2-binary`
- 추천: `psycopg[binary]` because psycopg3가 최신이고 typed row handling이 깔끔함.

구현 항목:

- [x] `DATABASE_URL` 기반 connection 생성.
- [x] `init_postgres.py`로 schema idempotent 생성.
- [x] `PostgresClient.append_transactions` upsert 구현.
- [x] `PostgresClient.append_address_activity` upsert 구현.
- [x] `PostgresClient.log_run`, `append_system_log`, `append_service_health` 구현.
- [x] `PostgresClient.list_transactions`, `list_tg_whale_events`, `list_broadcast_log`, `list_brief_cost_ledger` 구현.
- [x] `Storage` Protocol과 signature 정합화.
- [x] Postgres 장애 시 명확한 `StorageError` wrapping.

QA:

- [x] unit: SQL parameter binding 사용, string interpolation 금지.
- [ ] integration: local Postgres 또는 testcontainer가 가능하면 schema init + basic CRUD.
- [x] fallback: CI에서 DB 없으면 integration skip.

### Phase 2 — Pipeline storage factory 적용

목표: pipeline이 SheetsClient를 직접 만들지 않고 storage factory를 통해 backend를 선택하게 한다.

변경 파일:

- `src/pipeline/common.py`
- `src/pipeline/run_all.py`
- `src/main.py`
- `scripts/run_bot.py`
- `scripts/run_listener.py`
- `scripts/run_weekly_trend.py`
- `src/ingestion/news_rss.py`
- `src/ingestion/curated_balance_refresh.py`

구현 항목:

- [x] `build_sheets_client(env)`를 유지하되 신규 `build_storage_client(env)` 추가.
- [x] `PipelineEnv`에 `storage_backend`, `database_url`, `sheets_write_mode` 추가.
- [x] `run_all`의 `_ensure_sheets_client`를 `_ensure_storage_client`로 rename.
- [x] 운영 pipeline runner가 `Storage` Protocol만 의존하도록 정리.
- [x] 운영 runner의 `SheetsClient` 직접 생성 지점을 `storage.factory`로 이전.
- [x] listener는 `STORAGE_BACKEND=postgres`에서도 `tg_whale_events` 저장 가능.

QA:

- [x] `pytest -q tests/test_run_all.py tests/test_signals_pipeline.py tests/test_brief_fallback.py`
- [ ] `python -m src.pipeline.run_all` dry-run 또는 fake storage smoke.
- [x] Sheets backend 기존 테스트 유지.

### Phase 3 — Dashboard read backend 전환

목표: `/`, `/admin`, `/api/dashboard`가 Postgres를 primary read source로 사용한다.

변경 파일:

- `apps/dashboard/lib/env.ts`
- `apps/dashboard/lib/postgres.ts`
- `apps/dashboard/lib/data-source.ts`
- `apps/dashboard/lib/metrics.ts`
- `apps/dashboard/lib/types.ts`
- `apps/dashboard/app/api/dashboard/route.ts`
- `apps/dashboard/app/admin/page.tsx`
- `apps/dashboard/app/page.tsx`

구현 항목:

- [x] `getDashboardPostgresEnv()` 추가.
- [x] `DASHBOARD_DATA_BACKEND=postgres|sheets` 추가.
- [x] `readPostgresDashboardSnapshotSafe()` 구현.
- [x] 기존 `DashboardSheetSnapshot`과 동일한 normalized shape 반환.
- [x] `getDashboardData()`는 backend factory 결과만 소비.
- [ ] Postgres 실패 시 운영 페이지에 source degraded 표시.
- [x] Sheets fallback은 명시적으로 `DASHBOARD_DATA_BACKEND=sheets`일 때만 사용.

QA:

- [x] `npm run dashboard:typecheck`
- [x] `npm run dashboard:lint`
- [x] `npm run dashboard:build`
- [ ] component/e2e: `/admin`에 `source=postgres` 표시.
- [ ] local: `DASHBOARD_DATA_BACKEND=sheets` fallback 정상.

### Phase 4 — Migration

목표: Sheets의 최근 운영 데이터를 Postgres로 가져온다.

변경 파일:

- `scripts/migrate_sheets_to_postgres.py`
- `scripts/validate_postgres_counts.py`
- `docs/ops/postgres-migration-runbook.md`

마이그레이션 정책:

| 데이터 | 범위 | 이유 |
|---|---:|---|
| `transactions` | 최근 90일 | 사용자 홈과 brief context |
| `address_activity` | 최근 60일 | 감시지갑 최근성 |
| `tg_whale_events` | 최근 30일 | external observation lane |
| `service_health` | 최근 14일 | 운영 관측 |
| `system_log` | 최근 14일 | cron 상태 |
| `daily_brief` | 전체 또는 최근 180일 | 산출물 가치 높음 |
| `signals` | 전체 또는 최근 180일 | 사용자 홈/리뷰 가치 |
| `brief_cost_ledger` | 전체 | 비용 감사 |
| `broadcast_log` | 최근 30일 | 운영 감사 |

체크리스트:

- [ ] import 전 `scripts.backup_sheets_snapshot` 실행.
- [ ] Postgres schema init 완료.
- [ ] `--dry-run`으로 table별 import 예정 row count 확인.
- [ ] batch import 실행.
- [ ] `validate_postgres_counts.py`로 Sheets source count와 Postgres count 비교.
- [ ] dashboard backend를 staging/local에서 Postgres로 전환.
- [ ] Render env `STORAGE_BACKEND=postgres` 적용.

### Phase 5 — Sheets mirror 축소

목표: Sheets를 primary DB가 아니라 사람이 보는 summary mirror로 유지한다.

Mirror 허용 탭:

- `daily_brief`: 최신 90행
- `signals`: 최신 300행
- `channel_health`: 최신 30행
- `weekly_trend`: 최신 52주

Mirror 금지 탭:

- `transactions`
- `address_activity`
- `service_health`
- `system_log`
- `market_snapshots`
- `tg_whale_events`
- `broadcast_log`
- `analysis_log`
- `llm_budget_log`
- `brief_cost_ledger`

구현 항목:

- [ ] `SheetsMirrorClient` 또는 `MirrorStorage`에서 low-volume 탭만 write.
- [x] 부분 완료: `SHEETS_WRITE_MODE=summary_only`에서 high-churn write를 차단하고 cron 성공 여부에 영향 없도록 축소.
- [ ] mirror write 실패는 warning만 남기고 cron 성공 여부에 영향 없음.
- [ ] daily mirror job은 하루 1~3회 이하로 제한.
- [ ] `scripts/diagnose_sheets_cells.py`를 주간 점검 도구로 유지.

## 7. 운영 전환 순서

1. Render cron은 유지한다.
2. Phase 0 핫픽스를 먼저 배포해 Sheets 한도 초과가 cron exit 1을 만들지 않게 한다.
3. Render PostgreSQL을 생성하고 `DATABASE_URL`을 pipeline/bot/listener/dashboard에 넣는다.
4. `scripts/init_postgres.py` 실행.
5. `STORAGE_BACKEND=postgres`, `SHEETS_WRITE_MODE=disabled` 또는 `summary_only`로 pipeline부터 전환.
6. dashboard는 `DASHBOARD_DATA_BACKEND=postgres`로 전환.
7. 최근 데이터 migration 실행.
8. Sheets는 mirror 또는 legacy fallback으로만 유지.
9. 24시간 동안 Render logs, `/admin`, Postgres row growth, Telegram broadcast를 관측.

## 8. 롤백 전략

| 상황 | 롤백 |
|---|---|
| Postgres connection 실패 | `STORAGE_BACKEND=sheets`, `SHEETS_WRITE_MODE=summary_only`로 임시 복귀 |
| dashboard Postgres read 실패 | `DASHBOARD_DATA_BACKEND=sheets`로 Vercel env 전환 |
| migration 중복 import | unique key 기준 upsert 또는 staging table truncate 후 재실행 |
| Postgres schema 오류 | migration 전 dump/DDL version 기록 후 schema patch |
| Sheets mirror 실패 | mirror disable. primary 운영에는 영향 없음 |

주의: Sheets가 이미 10M 한도에 걸린 상태라 `STORAGE_BACKEND=sheets`로의 완전 복귀는 제한적이다. 실질 롤백은 `summary_only` 또는 `disabled`다.

## 9. 서브에이전트 병렬 개발 분할안

### Agent A — Phase 0 hotfix

쓰기 범위:

- `src/utils/errors.py`
- `src/utils/retry.py`
- `src/storage/sheets_client.py`
- `src/pipeline/run_all.py`
- `src/observability/service_health.py`
- `tests/test_run_all.py`
- `tests/test_storage.py`

완료 기준:

- [x] Sheets 10M quota error retry 중단.
- [x] heartbeat/log quota failure non-fatal.
- [x] `pytest -q tests/test_run_all.py tests/test_storage.py`.

### Agent B — Postgres schema/client

쓰기 범위:

- `requirements.txt`
- `pyproject.toml`
- `src/storage/postgres_schema.py`
- `src/storage/postgres_client.py`
- `src/storage/factory.py`
- `scripts/init_postgres.py`
- `tests/test_postgres_client.py`
- `tests/test_storage_factory.py`

완료 기준:

- [x] `PostgresClient`가 `Storage` 핵심 메서드 구현.
- [x] SQL injection 방지: 모든 query parameterized.
- [x] DB 없는 환경에서는 integration test skip.

### Agent C — Pipeline integration

쓰기 범위:

- `src/pipeline/common.py`
- `src/pipeline/run_all.py`
- `src/main.py`
- `scripts/run_bot.py`
- `scripts/run_listener.py`
- `scripts/run_weekly_trend.py`
- `src/ingestion/news_rss.py`

완료 기준:

- [x] `STORAGE_BACKEND`로 backend 선택.
- [x] 기존 Sheets mode 유지.
- [x] pipeline tests 통과.

### Agent D — Dashboard Postgres read

쓰기 범위:

- `apps/dashboard/lib/env.ts`
- `apps/dashboard/lib/postgres.ts`
- `apps/dashboard/lib/data-source.ts`
- `apps/dashboard/lib/metrics.ts`
- `apps/dashboard/lib/types.ts`
- `apps/dashboard/app/admin/page.tsx`

완료 기준:

- [x] `DASHBOARD_DATA_BACKEND=postgres` 지원.
- [x] `/admin`에 data source 표시.
- [x] `npm run dashboard:typecheck`, `lint`, `build` 통과.

### Agent E — Migration and docs

쓰기 범위:

- `scripts/migrate_sheets_to_postgres.py`
- `scripts/validate_postgres_counts.py`
- `docs/ops/postgres-migration-runbook.md`
- `docs/obsidian/*PostgreSQL*`

완료 기준:

- [x] connection-free `--dry-run` migration plan.
- [ ] batch import.
- [x] validation report template.

## 10. QA 체크리스트

### Python

- [x] `pytest -q tests/test_storage.py tests/test_storage_new_tabs.py`
- [x] `pytest -q tests/test_run_all.py`
- [x] `pytest -q tests/test_signals_pipeline.py tests/test_brief_fallback.py tests/test_stories_pipeline.py`
- [x] `pytest -q tests/test_broadcast_periodic.py`
- [x] `python -m scripts.init_postgres --dry-run`
- [x] `python -m scripts.migrate_sheets_to_postgres --dry-run --since-days 90`

### Dashboard

- [x] `npm run dashboard:typecheck`
- [x] `npm run dashboard:lint`
- [x] `npm run dashboard:build`
- [ ] `/admin`에서 `source=postgres` 또는 degraded reason 표시.
- [ ] `/` 사용자 홈에서 brief/signal/story/news 정상 렌더.
- [ ] `DASHBOARD_DATA_BACKEND=sheets` fallback smoke.

### Render

- [ ] pipeline cron 2회 연속 exit 0 또는 controlled status.
- [ ] `service_health` Postgres row 증가.
- [ ] `system_log` Postgres row 증가.
- [ ] Sheets 10M error가 Render log에서 재발하지 않음.
- [ ] Telegram bot/listener가 Postgres backend로 동작.

### 데이터 정합성

- [ ] `transactions.raw_response_hash` 중복 없음.
- [ ] `address_activity(tx_hash, watched_address, direction)` 중복 없음.
- [ ] 최신 `daily_brief`가 dashboard와 Telegram에 동일하게 보임.
- [ ] `broadcast_log.delivery_mode`가 dry_run/live/skipped 중 하나.
- [ ] `brief_cost_ledger` 누적 비용이 기존 Sheets 기준과 크게 어긋나지 않음.

## 11. 구현 프롬프트 초안

### Phase 0 hotfix prompt

```text
WhaleScope에서 Render cron은 유지해야 한다. Google Sheets 10M cell quota error가 append_transactions/log_run/append_service_health에서 발생해도 run_all 전체가 exit 1로 죽지 않도록 Phase 0 hotfix를 구현하라.

범위:
- StorageQuotaExceeded 예외 추가
- gspread APIError [400] workbook above limit of 10000000 cells 감지
- 해당 오류는 retry하지 않음
- run_all job heartbeat/final heartbeat는 safe wrapper로 non-fatal
- SHEETS_WRITE_MODE=full|summary_only|disabled 지원
- summary_only/disabled에서 high-churn writes는 skip

수정 파일:
src/utils/errors.py
src/utils/retry.py
src/storage/sheets_client.py
src/pipeline/common.py
src/pipeline/run_all.py
src/observability/service_health.py
tests/test_run_all.py
tests/test_storage.py

검증:
pytest -q tests/test_run_all.py tests/test_storage.py
pytest -q tests/test_signals_pipeline.py
```

### Postgres migration prompt

```text
WhaleScope storage backend를 PostgreSQL primary로 전환하라. 기존 SheetsClient는 유지하되, Storage Protocol을 만족하는 PostgresClient와 storage factory를 추가한다.

범위:
- DATABASE_URL 기반 Postgres connection
- init_postgres schema 생성
- transactions/address_activity/system_log/service_health/signals/daily_brief 우선 구현
- STORAGE_BACKEND=sheets|postgres 지원
- pipeline common의 build_sheets_client 호출부를 build_storage_client로 이전
- dashboard read 전환은 별도 phase로 남김

검증:
pytest -q tests/test_postgres_client.py tests/test_storage_factory.py
pytest -q tests/test_run_all.py tests/test_signals_pipeline.py
```

## 12. 완료 판정

- [ ] Render cron이 살아있는 상태에서 24시간 동안 Sheets 10M error로 exit 1이 재발하지 않는다.
- [ ] Postgres에 `transactions`, `address_activity`, `service_health`, `system_log`가 정상 증가한다.
- [ ] `/admin`이 Postgres 기반 운영 상태를 표시한다.
- [ ] `/` 사용자 홈이 Postgres 기반 최신 brief/signal/story를 표시한다.
- [ ] Sheets는 summary mirror 또는 legacy fallback으로만 남는다.
- [ ] `2026-04-24-01/02/03`의 Option A는 emergency tool로 보존하되, primary 전략은 Postgres 전환으로 대체한다.

## 13. 2026-04-24 구현 상태 업데이트

### Phase별 체크

- [x] Phase 0: Cron 생존 핫픽스 구현
- [x] Phase 0: `StorageQuotaExceeded` 추가 및 Sheets 10M cell quota retry 중단
- [x] Phase 0: `SHEETS_WRITE_MODE=full|summary_only|disabled` 추가
- [x] Phase 0: `transactions`, `address_activity`, `system_log`, `service_health`, `tg_whale_events` high-churn write skip
- [x] Phase 0: `run_all` job heartbeat/final heartbeat write failure non-fatal 처리
- [x] Phase 0 QA: `pytest -q tests/test_storage.py tests/test_run_all.py`
- [ ] Phase 0 운영 QA: Render cron 2회 연속 exit 0 확인
- [x] Phase 1: `src/storage/postgres_schema.py` 추가
- [x] Phase 1: `src/storage/postgres_client.py` 추가
- [x] Phase 1: `src/storage/factory.py` 추가
- [x] Phase 1: `scripts/init_postgres.py` 추가
- [x] Phase 1: 핵심 pipeline/bot/listener 메서드용 Postgres table 및 method 추가
- [x] Phase 1 QA: `pytest -q tests/test_postgres_client.py tests/test_storage_factory.py`
- [x] Phase 1 QA: `python -m scripts.init_postgres --dry-run`
- [x] Phase 1 운영 QA: 실제 Render PostgreSQL `DATABASE_URL` 대상 schema init 실행
- [x] Phase 2: `PipelineEnv.storage_backend`, `database_url`, `sheets_write_mode` 추가
- [x] Phase 2: `build_storage_client(env)` 추가 및 `build_sheets_client(env)` compatibility alias 유지
- [x] Phase 2: `run_all` storage factory 연결
- [x] Phase 2: `src.main`, bot, listener, weekly trend, news RSS storage factory 연결
- [x] Phase 2 QA: pipeline focused tests 통과
- [ ] Phase 2 운영 QA: `STORAGE_BACKEND=postgres` Render cron manual run
- [x] Phase 3: `DASHBOARD_DATA_BACKEND=postgres|sheets` 추가
- [x] Phase 3: dashboard Postgres read client 추가
- [x] Phase 3: `readDashboardSnapshotSafe()` backend routing 추가
- [x] Phase 3: optional admin observability table Postgres read 추가
- [x] Phase 3: dashboard source 표시를 `postgres`/`google_sheets`로 분리
- [x] Phase 3 QA: `npm run dashboard:typecheck`
- [x] Phase 3 QA: `npm run dashboard:lint`
- [x] Phase 3 QA: `npm run dashboard:build`
- [x] Phase 3 QA: `npm run dashboard:e2e` 20개 통과
- [ ] Phase 3 운영 QA: Vercel `DASHBOARD_DATA_BACKEND=postgres` 적용 후 `/admin` 육안 확인
- [x] Phase 4: `scripts/migrate_sheets_to_postgres.py` 추가
- [x] Phase 4: `scripts/validate_postgres_counts.py` 추가
- [x] Phase 4: `docs/ops/postgres-migration-runbook.md` 추가
- [x] Phase 4 QA: migration/validation dry-run은 외부 연결 없이 통과
- [x] Phase 4 운영 QA: `--read-source` dry-run 및 7일 범위 실제 migration 완료
- [x] Phase 4 운영 QA: migration 재실행용 `--truncate-before` 및 탭별 progress log 추가
- [ ] Phase 4 운영 QA: 90일 범위 전체 migration 및 count validation
- [ ] Phase 5: 별도 `MirrorStorage`/`SheetsMirrorClient` 구현
- [x] Phase 5 부분 완료: `SHEETS_WRITE_MODE=summary_only`로 high-churn Sheets write 축소
- [ ] Phase 5 운영 QA: Sheets mirror 탭/보존 기간 확정 및 적용

### 구현 파일 요약

- Python storage: `src/storage/postgres_schema.py`, `src/storage/postgres_client.py`, `src/storage/factory.py`
- Pipeline 연결: `src/pipeline/common.py`, `src/pipeline/run_all.py`, `src/main.py`, `scripts/run_bot.py`, `scripts/run_listener.py`, `scripts/run_weekly_trend.py`, `src/ingestion/news_rss.py`
- Dashboard 연결: `apps/dashboard/lib/env.ts`, `apps/dashboard/lib/postgres.ts`, `apps/dashboard/lib/sheets.ts`, `apps/dashboard/lib/metrics.ts`
- Migration/runbook: `scripts/init_postgres.py`, `scripts/migrate_sheets_to_postgres.py`, `scripts/validate_postgres_counts.py`, `docs/ops/postgres-migration-runbook.md`

### 남은 운영 작업

- Render PostgreSQL 생성 및 로컬 `DATABASE_URL` 연결 확인 완료
- Render pipeline/listener/bot env에 `DATABASE_URL`, `STORAGE_BACKEND=postgres`, `SHEETS_WRITE_MODE=summary_only` 적용
- Vercel env에 `DATABASE_URL`, `DASHBOARD_DATA_BACKEND=postgres` 적용
- `python -m scripts.init_postgres` 실제 실행 완료
- migration `--dry-run --read-source`와 7일 범위 실제 import 완료
- `/admin`에서 source, row growth, service health를 확인

### 2026-04-24 로컬 통합 검증 결과

- [x] `pytest -q`: 481 passed, 5 skipped
- [x] `npm run dashboard:typecheck`: 통과
- [x] `npm run dashboard:lint`: 통과
- [x] `npm run dashboard:build`: 통과
- [x] `npm run dashboard:e2e`: 20 passed
- [x] 실제 PostgreSQL 연결 검증: Render PostgreSQL schema init 성공
- [x] 7일 범위 Sheets -> PostgreSQL import 완료: transactions 961, address_activity 1000, signals 5, daily_brief 91, system_log 1000, service_health 1000, news_feed 1000, broadcast_log 389, brief_cost_ledger 91, llm_budget_log 77, channel_health 5
- [ ] Render cron 검증: `STORAGE_BACKEND=postgres` 전환 후 manual run 및 2회 예약 실행 확인 필요
- [ ] Vercel 검증: `DASHBOARD_DATA_BACKEND=postgres` 전환 후 `/`, `/admin` 육안 확인 필요
