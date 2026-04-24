---
type: diagnostic-report
date: 2026-04-24
seq: "01"
status: awaiting-user-decision
tags:
  - WhaleScope
  - incident
  - google-sheets
  - gspread
  - storage
  - retention
related:
  - 2026-04-20-04-WhaleScope-Sheets-Redis캐싱-429해결-구현계획.md
  - 2026-04-22-02-WhaleScope-다관점리뷰-개선안-실행계획.md
---

# WhaleScope 운영 장애 — Google Sheets 10M 셀 워크북 한도 초과 진단 리포트

## 0. 한 줄 요약

Render.com 크론 `python -m src.pipeline.run_all` 가 `gspread.exceptions.APIError: [400] This action would increase the number of cells in the workbook above the limit of 10000000 cells.` 로 실패함. 원인은 **20개 이상의 append-only 탭에 대해 retention/purge 로직이 전혀 존재하지 않아**, 워크북 전체 셀 수가 Google Sheets 하드 리밋 10,000,000 을 돌파한 구조적 문제임. 재시도(@retry 3회)로 풀릴 성질의 오류가 아님.

## 1. 사고 현황

### 1.1 스택 트레이스 핵심 구간

```
2026-04-23 23:47:20  append_address_activity  → retry 3회 → StorageError 재전파
2026-04-23 23:49:35  append_transactions      → retry 3회 → StorageError
2026-04-23 23:51:38  append_system_log        → retry 3회 → StorageError
2026-04-23 23:52:11  log_run                  → retry 3회 → StorageError
2026-04-23 23:52:28  append_service_health    → retry 3회 → StorageError  (run_all 최종 heartbeat)
→ gspread.exceptions.APIError: [400] "This action would increase the number of
   cells in the workbook above the limit of 10000000 cells."
→ cron exit status 1
```

### 1.2 동반 경고 (부차적, 본 장애와 별개이지만 기록)

- **CoinGecko 429** — free tier rate limit. `2026-04-20-04` Redis L2 캐싱 문서에서 이미 해결 계획이 있음. (본 장애 아님)
- **Solscan 404** — 일부 주소 조회 404. 데이터 미수신이지만 블로커 아님.
- **tg_whale_events header layout unexpected, skipping auto-extension** — `_ensure_append_only_header_schema()` 가 기대 스키마와 실제 헤더 불일치 감지. 로깅만 하고 skip. 별도 후속 작업 필요하나 본 장애와 무관.

## 2. 근본 원인 분석

### 2.1 Google Sheets의 워크북 셀 한도

Google Sheets 의 하드 리밋은 워크북 전체 **10,000,000 셀** 이다 (2023년 이전은 5,000,000). 여기서 "셀" 은 `rows × cols` 의 **그리드 크기** 를 의미하며, 빈 셀도 포함된다. 모든 워크시트의 그리드 합이 한도에 포함된다.

### 2.2 현재 워크북 구성 (20 탭)

`src/storage/schema.py` 의 `TAB_HEADERS` 에서 추출한 컬럼 수:

| 탭 이름 | cols | 쓰기 유형 | 일일 증가 (추정) | 핵심 호출 위치 |
|---|---:|---|---:|---|
| `transactions` | 14 | append-only | 50–200 | `append_transactions` (line 216) |
| `daily_brief` | 10 | append-only | 1–3 | `save_daily_brief` |
| `subscribers` | 8 | upsert | ≈0 | - |
| `analysis_log` | 14 | append-only | 10–100 | `save_analysis` (line 654) |
| `system_log` | 8 | append-only | 200–600 | `log_run` (line 669), `append_system_log` (line 683) |
| `watched_addresses` | 9 | config | ≈0 | - |
| `address_activity` | 11 | append-only (dedup on tx+wallet+dir) | 100–500 | `append_address_activity` (line 1107) |
| `tg_whale_events` | 16 | append-only | 200–1000 | `append_row` (line 1190) |
| `signals` | 12 | append-only | 5–30 | (line 590 등) |
| `weekly_trend` | 7 | append-only | ≈0.1 | - |
| `user_interests` | 6 | upsert | ≈0 | - |
| `curated_wallets` | 18 | config | ≈0 | - |
| `wallet_aliases` | 6 | config | ≈0 | - |
| `watchlist_overrides` | 5 | append | <1 | - |
| `news_feed` | 11 | append-only (dedup on hash) | 50–300 | - |
| `market_snapshots` | 9 | append-only | ≈288 (5분 주기) | - |
| `wallet_activity_snapshots` | 9 | append-only | 50–200 | - |
| `whale_stories` | 9 | append-only | 1–10 | - |
| `broadcast_log` | 13 | append-only | 100–1000 | - |
| `llm_budget_log` | 9 | append-only | 50–200 | - |
| `brief_cost_ledger` | 13 | append-only | 3–50 | - |
| `curated_wallet_balances` | 11 | upsert | ≈0 | - |
| `channel_health` | 7 | append-only | 1–5 | `append_channel_health` (line 1780) |
| **`service_health`** | **19** | **append-only** | **~500** (크론 15분 슬롯 × 5-8 job/슬롯) | `append_service_health` (line 1806) |

> **Top 셀 소비자 (col × 일일 rows)**
> 1. `service_health`  19 × 500 = **9,500 cells/day**
> 2. `tg_whale_events` 16 × 600 = **9,600 cells/day**
> 3. `broadcast_log`   13 × 500 = **6,500 cells/day**
> 4. `transactions`    14 × 150 = **2,100 cells/day**
> 5. `address_activity` 11 × 300 = **3,300 cells/day**
> 6. `analysis_log`    14 × 50  = **700 cells/day**
> 7. `system_log`       8 × 400 = **3,200 cells/day**
> 8. `market_snapshots` 9 × 288 = **2,592 cells/day**
> 
> 일일 합계 약 **37,500 cells/day** → **~270 일이면 10M 한도 도달** (누적 다른 탭 포함시 실제 도달일은 더 빠름). 프로젝트 운영 시작이 2026-04-14 전후이므로 **9개월 연속 운영** 이었다면 이미 한도 근접 → 과거 백필/시뮬레이션 데이터가 누적됐을 가능성 높음.

### 2.3 "왜 지금 터졌는가"

두 요인이 결합:

1. **`add_worksheet(rows=1000, cols=len(headers))`** (line 171-173) — 초기 생성 시 1,000행 할당. 그리고 gspread 의 `append_row` / `append_rows` 는 행이 가득 차면 **자동으로 그리드를 확장** 한다. 즉 한 번 확장되기 시작하면 셀 소비가 급증.
2. **Retention/purge 로직이 단 한 줄도 없음.** `src/` 전체와 `scripts/` 전체에서 `retention`, `purge`, `archive`, `rotate`, `trim`, `delete_rows`, `cleanup` 키워드 0건 (Grep 검증 완료). 모든 high-churn 탭이 월 단위, 분기 단위로 append-only 누적 중.

결과적으로 워크북 전체 그리드 합이 10M 에 도달한 순간, **어느 탭이든 append 를 시도하면** (행 확장이 필요하면) 동일한 400 에러를 뱉는다. 스택의 5개 함수가 모두 실패한 것은 원인 탭이 하나가 아니라 **워크북 공통 한도** 때문이다.

### 2.4 왜 3회 재시도가 의미가 없는가

`src/utils/retry.py` 의 `@retry(max_retries=3, base_delay=2.0)` 는 지수 백오프 기반 **transient error** 처리용. 그러나 10M 한도 초과는 **결정론적 서버 거절** 이다. 재시도해도 결과 동일.

### 2.5 왜 크론이 exit 1 로 종료됐는가

```python
# run_all.py
def main() -> None:
    summary = run_all()                     # ← 이 안에서 예외 전파
    if summary["failed_jobs"]:              # ← 여기까지 도달 못함
        raise SystemExit(1)
```

- 각 due job 의 실패는 `run_all` 의 try/except (line 303) 에서 catch → `failed_jobs` dict 에 기록만 하고 계속 진행.
- 그러나 **마지막 dispatcher heartbeat** (line 327 `append_service_heartbeat("pipeline.run_all", ...)`) 는 try/except **바깥** 이다.
- 이 마지막 쓰기가 똑같이 10M 한도에 막혀 `StorageError` 를 던짐 → `run_all()` 자체가 미처 `return summary` 하지 못하고 예외 전파 → `main()` 에서 잡히지 않음 → Python runtime 이 non-zero exit.

## 3. 복구·개선 옵션 (우선순위순)

> **공통 원칙**: 지금 필요한 것은 "서비스 복구" + "동일 사고의 재발 방지". 두 가지를 분리해서 실행한다. 코드 수정은 사용자 컨펌 후 별도 PR/티켓으로 진행.

### Option A — 즉시 복구 (코드 변경 없음, 소요 ~30-60분)

**목표: 크론이 다시 돌도록 워크북 셀 수를 한도 아래로 떨어뜨린다.**

1. Google Sheets UI 또는 `scripts/` 에 one-off 클린업 스크립트로 다음 탭의 과거 데이터 삭제:
   - `service_health` → **최근 14일만 유지** (약 7,000행 × 19 = 133K cells)
   - `system_log` → 최근 14일만 유지
   - `tg_whale_events` → 최근 30일만 유지
   - `broadcast_log` → 최근 30일만 유지
   - `market_snapshots` → 최근 14일만 유지
   - `address_activity` → 최근 60일만 유지
   - `transactions` → 최근 90일만 유지
   - `analysis_log` → 최근 60일만 유지
2. 각 워크시트 그리드 축소: `ws.resize(rows=<현재 data row 수 + 여유 1000>)` — 빈 그리드가 셀 수에 포함되므로 resize 필수.
3. 수동 re-run: `python -m src.pipeline.run_all` 실행 후 성공 확인.

**트레이드오프**: 히스토리컬 데이터 일부 소실. 하지만 service_health/system_log/market_snapshots 등은 "운영 추적용" 이며 재구성 가능. transactions/address_activity 는 상대적으로 보수적 보존 (60-90일).

### Option B — 단기 재발 방지 (코드 변경, 소요 ~2-3시간)

**목표: Retention 로직을 `sheets_client.py` 에 추가해 매 cron 실행마다 오래된 행을 자동 삭제.**

1. `sheets_client.py` 에 헬퍼 추가:
   ```python
   def purge_old_rows(
       self,
       tab_name: str,
       *,
       timestamp_col: str,
       max_age_days: int,
       batch_size: int = 500,
   ) -> int:
       """타임스탬프 컬럼 기준으로 오래된 행을 batch_size 단위로 delete_rows."""
   ```
2. `run_all.py` 끝부분에 retention 호출 블록 추가:
   ```python
   _RETENTION_RULES = {
       "service_health": ("ts", 14),
       "system_log": ("started_at", 14),
       "tg_whale_events": ("collected_at", 30),
       "broadcast_log": ("ts", 30),
       "market_snapshots": ("ts", 14),
       "address_activity": ("collected_at", 60),
       "analysis_log": ("created_at", 60),
       # transactions, signals 는 보수적으로 90일 유지
   }
   for tab, (col, days) in _RETENTION_RULES.items():
       try:
           sheets_client.purge_old_rows(tab, timestamp_col=col, max_age_days=days)
       except StorageError as exc:
           logger.warning("Retention purge failed tab=%s: %s", tab, exc)
   ```
3. 하루 1회 (예: 09:00 KST slot) 에만 실행하도록 guard (`if slot.hour == 9 and slot.minute == 0:`). 매 슬롯 호출하면 gspread quota 낭비.
4. `ws.resize(rows=현재 데이터 행 수 + 1000)` 를 purge 후 호출 — 이것이 실제로 그리드를 축소시키는 핵심 단계.
5. `_ensure_worksheets` 의 `rows=1000` 을 `rows=200` 으로 줄임 — 처음 생성되는 탭의 초기 allocation 축소.

**트레이드오프**:
- 매일 1회 퍼지로 cron 실행 시간 +10-30초.
- `delete_rows` 는 API call 이므로 quota 소비 (Redis L2 캐시로 완화 가능).
- 로직이 단순 (시간 기반 cutoff) → 엣지 케이스 적음.

### Option C — 중기 아키텍처 개선 (소요 ~1주)

**목표: "운영 텔레메트리" 성격의 high-churn 데이터를 Sheets 에서 분리.**

Sheets 에 남길 것 (인간/심사위원 가시성 중요):
- `subscribers`, `curated_wallets`, `watched_addresses`, `wallet_aliases`, `watchlist_overrides` (config)
- `daily_brief`, `whale_stories`, `signals` (display artifact, 최근 30일)
- `analysis_log` (최근 30일, 비용 감사용)

Upstash Redis 로 이관 (TTL 기반 자동 정리):
- `service_health` → Redis Streams 또는 List, TTL 7일
- `market_snapshots` → Redis Sorted Set (timestamp score), TTL 14일
- `channel_health` → Redis Hash + TTL

Postgres (Supabase 등) 또는 SQLite on-disk 로 이관:
- `broadcast_log` (감사 필수, 장기 보관)
- `address_activity` (알림 판단의 primary source of truth)
- `transactions` (장기 히스토리)
- `tg_whale_events` (외부 채널 아카이브)

이 옵션은 Option A + B 완료 후에 착수하는 것이 안전하다. 다관점 리뷰 실행계획 (`2026-04-22-02`) 의 Phase 2/3 와 함께 검토 권장.

### Option D — 전략적 (2주+)

Sheets 를 **설정·공유용** 으로만 쓰고, 운영 데이터는 Supabase (Postgres + Redis 번들) 로 전환. 평가 기간 종료 후 검토할 수 있는 "차기 버전" 아키텍처.

## 4. 권장 실행 순서

| Phase | 옵션 | 소요 | 담당 | 산출물 |
|---|---|---|---|---|
| P0 — 지금 | A (수동 퍼지 + resize) | 30-60분 | 사용자 (UI) + Claude (스크립트 작성) | 크론 정상 동작 |
| P1 — 오늘/내일 | B (retention 코드) | 2-3시간 | Claude | PR: retention helper + run_all 통합 |
| P2 — 이번 주 | C (Redis/Postgres 분리) | 1주 | 사용자 + Claude | 아키텍처 설계 문서 + 단계적 마이그레이션 |
| P3 — 평가 이후 | D (Supabase 전환) | 2주+ | - | 차기 버전 스펙 |

## 5. 평행 Claude Code 세션 상태 확인

본 세션이 볼 수 있는 모든 기록 (Obsidian 볼트 `Projects/02015-WhaleScope/`, 레포 `docs/obsidian/`, git log, git worktree, TASKS.md 등) 을 스캔한 결과, **"10M 셀 한도" 를 명시적으로 다룬 핸드오프 노트는 존재하지 않음.** 사용자가 평행 Claude Code 세션에 구두/메모리로 지시했거나 아직 티켓이 없는 상태로 판단.

- 가장 가까운 스토리지 관련 문서는 `2026-04-20-04-WhaleScope-Sheets-Redis캐싱-429해결-구현계획.md` — HTTP **429 rate quota** 해결용 Redis L2 캐싱. 본 **10M 셀 워크북 한도** 와는 별개 문제.
- 다관점 리뷰 실행계획 `2026-04-22-02` 의 Phase 2/3 에도 Sheets 셀 한도 대응 항목 없음.

따라서 **평행 세션과의 코드 충돌 리스크는 현재 시점에서 없음.** 다만 사용자가 확인 후 평행 세션에도 본 문서를 공유하는 것이 안전.

## 6. 사용자 의사결정 요청

다음 중 어느 순서로 실행할지 컨펌 요청:

- **(A1) Option A 를 지금 즉시 실행** — Claude 가 one-off 클린업 스크립트를 `scripts/purge_sheets_once.py` 로 작성하고, 사용자가 직접 실행하여 복구.
- **(A2) 사용자 수동으로 Google Sheets UI 에서 퍼지 + resize** — Claude 는 어떤 탭을 얼마나 자를지 표로만 제공.
- **(B 만) 즉시 Option B 코드 배포** — 단, B 는 retention 이 돌려면 cron 이 한 번 성공해야 하므로 A 선행 필요.
- **(전체 보류) 평행 Claude Code 세션 확인 후 재결정.**

코드 수정은 의사결정 후 착수함. 본 문서 작성까지가 현재까지의 작업 범위.

## 변경 로그

- 2026-04-24 — 초안 작성. 스택 트레이스 분석, 20탭 스키마 조사, retention 부재 확인, 4단계 옵션 정리. 사용자 의사결정 대기.
