# WhaleScope

Wrtn Technologies Product Engineer 과제 전형용 프로젝트입니다. 선택 도메인은 `C. AI 요약/큐레이션 서비스`이며, 온체인 고래 지갑 모니터링, 규칙 기반 시그널 탐지, LLM 한국어 해설, Telegram 브리핑을 하나로 묶은 크립토 고래 큐레이션 서비스입니다.

> 본 서비스는 투자 조언을 제공하지 않습니다. 모든 브리핑은 참고 목적이며, 투자 판단과 책임은 사용자에게 있습니다.

> 배포 URL: [https://whalescope.6esk.com](https://whalescope.6esk.com) (Vercel). 공개 Telegram 채널: [@whalescope_alertz](https://t.me/whalescope_alertz). Render에서 정보수집 pipeline / Telegram bot / Telethon listener 3개 서비스가 상시 가동됩니다. 현재 운영 데이터 원천은 PostgreSQL primary이며, Google Sheets는 legacy/mirror 확인 경로로 축소했습니다.

**평가자용 빠른 동선**: 문제 정의·타겟·핵심 기능·지표·판단 기록은 루트의 [`ONE_PAGER.md`](ONE_PAGER.md)에 정리되어 있습니다. 실행 방법·기술 스택·아키텍처는 이 README로 확인할 수 있습니다.

## AI 협업 고지

이 저장소는 사람이 제품 방향과 최종 의사결정을 담당하고, AI 코딩 에이전트가 구현·검증·문서화 일부를 보조하는 방식으로 진행했습니다.

- `Codex (OpenAI)`는 최근 개선 사이클에서 병렬 개발, 회귀 수정, QA/빌드 검증, README·운영 문서 업데이트를 담당했습니다.
- `Claude Code / Claude + Obsidian`은 초기 구현, 리팩터링, 아키텍처 정리, 기획 문서 초안 작성에 활용했습니다.
- 탐지 규칙, 운영 정책, 제품 판단은 사람이 직접 결정했고, AI는 실행 및 정리 역할로 제한했습니다.

- 운영 runbook: [docs/operational-run-verification.md](docs/operational-run-verification.md)
- live chain contract: `pytest -q -m contract tests/contract` 또는 [`.github/workflows/chain_contract.yml`](.github/workflows/chain_contract.yml) `workflow_dispatch`
- 최근 반영 보고서: v6 개선 (2026-04-19, 하이브리드 브리핑·Render 관측·UX 폴리싱), 체인 커버리지 확장 완료 (2026-04-20, XRP/TRX/BTC/DOGE + TG mirror observability + BTC fallback), PostgreSQL 전환 및 운영/유저홈 점검 반영 (2026-04-24~27)

## Dashboard Split

이번 대시보드는 운영자용 화면과 사용자용 화면으로 분리해서 봅니다.

- `/`는 일반 사용자용 인사이트 홈입니다. 사람이 읽을 수 있는 고래 브리핑, 시장 분위기, 주요 시그널, 관심 목록, Telegram 연결 CTA를 중심으로 봅니다.
- `/admin`은 운영/관리 대시보드입니다. 정보수집 worker, Telegram worker, PostgreSQL 적재 상태, 최신 브리핑, 시스템 상태를 확인하는 용도입니다. Google Sheets는 legacy/mirror 상태 확인용으로만 남겨둡니다.
- `/insights`는 예전 사용자용 경로와 외부 링크 호환을 위해 `/`로 영구 redirect합니다.
- 디자인 기준은 `docs/demo_pic/admin_dashboard.html`과 `docs/demo_pic/user_dashboard.html`을 참고해 맞췄습니다. 이 HTML은 구현 참고용 디자인 레퍼런스이며 런타임 자산은 아닙니다.
- 사용자 홈의 Telegram 연결 CTA/QR은 현재 **WhaleScope 공개 채널** `@whalescope_alertz` ([https://t.me/whalescope_alertz](https://t.me/whalescope_alertz))로 연결됩니다. 클라이언트 번들은 `NEXT_PUBLIC_TELEGRAM_CHANNEL_USERNAME=whalescope_alertz`를 우선 참조합니다.
- Next.js 대시보드 공용 chrome은 저장된 값이 없을 때 기본 light theme로 시작합니다. 언어 선택은 현재 `ko/en`만 지원하며, `dashboard_lang` 쿠키와 `apps/dashboard/lib/i18n` dictionary를 통해 navbar/Telegram modal에 반영됩니다.

## 내가 실제로 실행해야 할 것들

WhaleScope는 하나의 서버만 켜는 앱이 아니라, 데이터 적재 worker와 사용자 접점, 대시보드를 분리해서 운영합니다. 실제 실행 단위는 아래 기준으로 보면 됩니다.

| 실행 단위 | 로컬 명령 | 배포 위치 | 역할 | 항상 실행 여부 |
|---|---|---|---|---|
| 초기 Sheets 세팅 | `python -m scripts.init_sheets` | 로컬 1회 실행 | Google Sheets 탭/헤더 생성 | 최초 1회 |
| 감시 주소 등록 | `python scripts/import_watched_addresses.py` | 로컬 1회 실행 | `watched_addresses` 시트에 기본 감시 주소 upsert | 최초 1회, CSV 변경 시 |
| 정보수집 파이프라인 worker | `python -m src.pipeline.run_all` | Render Cron Job | 온체인/TG 데이터 수집, 시그널 생성, 뉴스/스토리/브리핑/헬스체크 cadence 실행, PostgreSQL 저장, Telegram 브리핑 발송 | 주기 실행 |
| Telegram bot worker | `python scripts/run_bot.py` | Render Background Worker | `/start`, `/watchlist`, `/pause`, `/status` 같은 사용자 명령 처리 | 상시 실행 |
| Telegram listener worker | `TG_CHANNEL=@whale_alert_io python scripts/run_listener.py` | Render Background Worker | 공개 고래 알림 채널을 수신해 `tg_whale_events`에 저장하고 `system_log`에 listener heartbeat 기록 | 상시 실행 |
| Next.js 사용자 홈(`/`) | `npm run dashboard:dev` | Vercel | 사용자용 브리핑/인사이트 화면 제공 | 화면 확인 시 또는 Vercel 상시 배포 |
| Next.js 운영 대시보드(`/admin`) | `npm run dashboard:dev` | Vercel | PostgreSQL 데이터를 읽어 운영 화면/API 제공. listener 상태는 저장소 연결 여부가 아니라 `telethon_listener` heartbeat 우선, `tg_whale_events` 최신 기록 보조 기준으로 표시 | 화면 확인 시 또는 Vercel 상시 배포 |
| Next.js 레거시 redirect(`/insights`) | `npm run dashboard:dev` | Vercel | 기존 링크 호환용으로 `/`에 redirect | 자동 |
| Streamlit legacy 대시보드 | `streamlit run streamlit_app.py` | 로컬 전용 | 기존 로컬 진단용 화면 | 선택 실행 |

로컬에서 전체 흐름을 처음 확인할 때는 아래 순서로 실행합니다.

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env

python -m scripts.init_sheets
python scripts/import_watched_addresses.py --dry-run
python scripts/import_watched_addresses.py
python scripts/smoke_pipeline.py
python scripts/test_connection.py
python -m src.pipeline.run_all

npm install
npm run dashboard:dev
```

별도 터미널에서 상시 worker를 확인하려면 아래 두 프로세스를 각각 실행합니다.

```bash
python scripts/run_bot.py
TG_CHANNEL=@whale_alert_io python scripts/run_listener.py
```

주의할 점:

- worker마다 필요한 env가 다릅니다. `src.pipeline.run_all`은 `ETHERSCAN_API_KEY`, `TELEGRAM_BOT_TOKEN`, `GOOGLE_*`, LLM provider key 중 1개가 필요하지만, `run_listener.py`는 `GOOGLE_SHEET_ID`, `GOOGLE_CREDENTIALS_JSON`, `TELETHON_*`, `TG_CHANNEL`만으로도 실행할 수 있습니다. LLM key는 listener에서 선택 사항입니다.
- 공개 채널 브로드캐스트는 `broadcast_daily` 단계에서만 수행됩니다. 기본값은 `TELEGRAM_BROADCAST_ENABLED=false`, `TELEGRAM_BROADCAST_DRY_RUN=true`라서 환경변수를 따로 열지 않으면 실제 채널 발송은 일어나지 않고 `broadcast_log`에 상태만 남깁니다.
- `GOOGLE_CREDENTIALS_JSON`은 JSON 문자열이므로 `source .env`로 주입하지 마세요. Python은 `.env`를 직접 읽고, Next.js dashboard는 `apps/dashboard/.env.local` 또는 루트 `.env`를 server-side에서 직접 읽습니다.
- 운영자용 dashboard/API 인증은 `Authorization: Bearer <password>`를 권장합니다. `x-dashboard-password`는 로컬에서 curl로 빠르게 확인하거나 수동 검증할 때 쓰는 보조 헤더로 남겨두었습니다.
- 대시보드가 비어 있으면 대시보드 문제가 아니라 먼저 `python -m src.pipeline.run_all`이 PostgreSQL에 `transactions`, `signals`, `daily_brief`, `system_log`를 쌓았는지 확인합니다. legacy Sheets 모드로 실행할 때만 Google Sheets 적재 상태를 먼저 확인합니다.

## 과제 요약

- One Pager와 동작하는 구현체를 하나의 Git repo에 담는 과제 전형입니다.
- 평가 초점은 문제 정의, AI 활용 방식, 실행 가능성, 문서화, 코드 품질입니다.
- 실제 데모 경로는 LLM API 기반 실행을 우선으로 두고, smoke는 API 키/외부 의존성 부재 시 fallback으로 남깁니다.

One Pager (제출본): [ONE_PAGER.md](ONE_PAGER.md)

Next.js Dashboard 개발 계획: [docs/nextjs-dashboard-development-plan.md](docs/nextjs-dashboard-development-plan.md)

## Next.js 대시보드

`apps/dashboard`는 Vercel 배포용 Next.js App Router 대시보드입니다. 현재 운영 배포는 `DASHBOARD_DATA_BACKEND=postgres`와 `DATABASE_URL`을 사용해 PostgreSQL을 primary read source로 읽고, Google Sheets는 legacy/mirror fallback으로만 유지합니다. 앱 단독 실행 안내는 [apps/dashboard/README.md](apps/dashboard/README.md), 배포 설계는 [docs/nextjs-dashboard-development-plan.md](docs/nextjs-dashboard-development-plan.md)를 기준으로 봅니다.

현재 페이지 역할은 `/` 사용자 홈, `/admin` 운영 대시보드, `/insights` 레거시 redirect입니다. 상단 내비게이션의 `시그널`과 `리포트`는 독립 페이지가 아니라 사용자 홈 내부 섹션 또는 향후 확장 후보로 정리했습니다.

로컬 개발과 빌드는 루트 워크스페이스 명령으로 실행합니다. `npm run dashboard:dev`와 `npm run dashboard:build`는 먼저 `npm run env:sync`를 실행해 repo 루트 `.env/.env.local`의 허용 키만 `apps/dashboard/.env.local`로 동기화합니다. `GOOGLE_CREDENTIALS_JSON`은 JSON 문자열이므로 shell에서 `source`하지 마세요.

```bash
npm install
npm run dashboard:dev
npm run dashboard:build
```

루트 `.env`를 쓰지 않고 dashboard 전용 env를 분리하려면 아래처럼 생성합니다.

```bash
cp apps/dashboard/.env.example apps/dashboard/.env.local
```

직접 동기화만 다시 돌리고 싶으면 아래 명령을 사용합니다.

```bash
npm run env:sync
```

현재 dashboard API는 다음 route handler로 제공됩니다.

| Endpoint | 설명 |
|---|---|
| `/api/dashboard` | 지표, 최신 브리핑, 최근 거래, 최근 시그널, 시스템 로그 통합 snapshot |
| `/api/transactions?limit=20` | 최근 거래 목록 |
| `/api/signals?limit=20` | 최근 규칙 기반 시그널 목록 |
| `/api/system-log?limit=25` | 최근 pipeline/system log 목록 |
| `PATCH /api/signals/[id]` | 시그널 acknowledge 또는 dismiss 상태 기록 (in-memory 휘발성) |
| `GET\|PATCH /api/watchlist` | 대시보드 감시 주소 목록 조회 및 enabled 토글 |
| `GET\|POST /api/language` | 대시보드 표시 언어 쿠키 조회 및 설정 (`ko`, `en`) |

배포 기준은 다음과 같습니다.

- Vercel 프로젝트의 Root Directory는 `apps/dashboard`로 설정합니다.
- `GOOGLE_CREDENTIALS_JSON`, `GOOGLE_SHEET_ID`는 현재 dashboard 필수 server-only secret입니다.
- `DASHBOARD_PASSWORD`를 설정하면 `/api/dashboard`, `/api/transactions`, `/api/signals`, `/api/system-log` 운영 API에 인증이 적용됩니다. 운영 환경에서는 `Authorization: Bearer <password>`를 권장하고, `x-dashboard-password`는 로컬/수동 확인 편의용으로만 남겨두었습니다.
- `RENDER_PIPELINE_WEBHOOK_URL`, `RENDER_PIPELINE_WEBHOOK_SECRET`는 실행 트리거 확장용 reserved server-only secret입니다.
- `NEXT_PUBLIC_`에는 공개 가능한 표시용 값만 둡니다.
- Render는 `python -m src.pipeline.run_all`, `python scripts/run_bot.py`, `TG_CHANNEL=@whale_alert_io python scripts/run_listener.py`를 각각 독립 worker로 운영합니다.
- 정보수집, Telegram bot, Telegram listener를 하나의 프로세스로 합치지 않습니다.
- 운영 대시보드의 Telegram listener 카드는 Google Sheets 연결 성공만으로 정상 처리하지 않습니다. `system_log`의 `run_type=telethon_listener` heartbeat를 우선 읽고, heartbeat가 없을 때만 `tg_whale_events` 최신 수집 시각을 보조 기준으로 삼아 `정상`, `대기 중`, `인증 필요`, `확인 필요`를 표시합니다.

권장 배포 구조:

| 구성요소 | Runtime | 역할 |
|---|---|---|
| 정보수집 파이프라인 | Render Cron Job 또는 Worker | 온체인/TG 이벤트 수집, 시그널 생성, LLM 브리핑 생성, Sheets 저장 |
| Telegram bot | Render Worker | `/start`, `/watchlist`, `/pause`, `/status` 등 사용자 명령 처리 |
| Telegram listener | Render Worker | 공개 고래 알림 채널 수신 후 `tg_whale_events` 저장, `system_log`에 listener heartbeat 기록 |
| Dashboard | Vercel | `/` 사용자 홈과 `/admin` 운영 화면 |
| Legacy dashboard | Local Streamlit | 로컬 진단용 보조 UI |

## 현재 상태

- Whale Alert 유료 API 의존을 제거하고 Etherscan, Solscan, 공개 Telegram 채널 수신 기반 구조로 전환했습니다.
- `SignalEngine`이 8개 규칙으로 시그널을 만들고, 시그널이 있을 때는 레거시 `TransactionScorer` 경로를 건너뜁니다.
- LLM 호출은 자체 `LLMRouter`가 Anthropic, Gemini, Groq provider를 preferred/fallback 방식으로 라우팅합니다.
- Google Sheets는 MVP 영구 저장소로 사용하며 `Storage` Protocol을 통해 이후 SQLite/Postgres 전환 여지를 둡니다.
- Telegram 발송은 429, timeout, network error에 대해 재시도하며, 구독자별 관심 규칙 기반 개인화를 지원합니다.
- 로컬 기준 기본 검증 경로는 `pytest -q`와 `python scripts/smoke_pipeline.py`입니다.

### v6 이후 반영된 확장

v6(2026-04-19), 체인 커버리지 확장(2026-04-20 오전), 대시보드 성능·안정화 사이클(2026-04-20 후반~2026-04-21) 사이에 추가된 구조적 개선은 다음과 같습니다. 각 항목의 상세 변경 로그는 `docs/changelog.md`와 Obsidian 프로젝트 노트(`Projects/02015-WhaleScope/`)에 정리되어 있습니다.

- **체인 커버리지 구조적 확장**: `ChainCollectorRegistry`를 도입해 silent drop을 구조적으로 차단했고, 기존 ETH/ARB/BASE/BSC/POLYGON/SOL 위에 XRP / TRX / BTC / DOGE collector를 feature flag 기반으로 추가했습니다. BTC는 `mempool.space` primary 실패 시 Blockchair secondary로 자동 fallback하며, BTC/DOGE는 UTXO 특성상 대표 주소 seed 기준 partial view로 먼저 시작합니다 (UI에 `부분 관측 · cluster 미적용` 배지 노출).
- **TG mirror observability lane**: 공개 Telegram 채널 수신 이벤트를 `observation_source=tg_mirror`로 모델링하고, `external_only_observation` / `corroborated_move` 두 흐름으로 구분해 signal 규칙과 whale story UI에 반영했습니다. `/admin`에서 최근 24h TG mirror 건수, 신뢰도 분포, 상위 채널, 최신 관측 시각을 확인할 수 있습니다.
- **실시간 업데이트 SSE 레인**: Upstash Redis REST 기반 SSE로 brief/news/watchlist/stories 4개 섹션을 15초 주기로 스트리밍합니다. `WHALESCOPE_SSE_ENABLED` / `WHALESCOPE_REDIS_REST_URL` / `WHALESCOPE_REDIS_REST_TOKEN` 3-gate check로 feature disabled / redis missing / token missing 상태를 구분해 라이브·standby·disabled를 표시합니다.
- **하이브리드 브리핑 (full / incremental)**: KST 09/15/21시 slot은 전체 컨텍스트 full brief, 그 외 slot은 이전 brief 기반 incremental brief로 분기합니다. RSS top N + curated watchlist를 full slot에만 컨텍스트로 주입하고 JSONL 로그를 `data/brief_logs/`에 누적합니다. **Sonnet 기준 추정 월 비용이 약 $21에서 $9 수준으로 감소하는 설계**입니다. 다만 현 운영은 Anthropic API key를 활성화하지 않은 상태로 Gemini 2.5 Flash + Groq Llama 3.3 70B를 주력으로 사용 중이며, 실제 체감 비용은 위 추정치보다 낮습니다. 라우팅 매트릭스는 `config/llm_routing.yaml`에 외부 설정으로 선언되어 있어 키 추가만으로 Sonnet/Haiku 승격이 가능합니다.
- **Render observability 대시보드**: `/admin`에 Render REST API 기반 서비스/배포/인스턴스/로그 패널을 통합했습니다. `RENDER_API_KEY`, `RENDER_OWNER_ID`, `RENDER_SERVICE_ID_*`로 서비스 상태, 최근 배포, 인스턴스 수, 에러 로그 창을 pipeline / bot / listener 3개 worker에 대해 동시에 확인할 수 있습니다.
- **Service Health v2**: heartbeat 스키마에 `instance_id`, `job_name`, `last_success_at`, `last_failure_at`, `processed_count`, `lag_seconds`, `duration_ms`, `source_name`를 추가해 slot-based dispatcher(9개 job)의 개별 생존/실패/처리량을 단일 시트에서 관측할 수 있게 했습니다.
- **Market ticker + Fear & Greed + News RSS**: 사용자 홈(`/`)에 Binance/Upbit/Bitflyer/Kraken 멀티소스 ticker, 김치 프리미엄 컬럼, alternative.me 기반 Fear & Greed 게이지, 20+ 소스 News RSS 위젯(dual staleness: last-poll vs last-article)을 추가했습니다.
- **Whale Stories 섹션**: 시그널을 사용자 관점의 4-card 스토리 레인으로 재구성해 `외부 관측 · Whale Alert`, `채널 신뢰도`, `부분 관측 · cluster 미적용`, `교차확인` 배지를 카드 레벨로 노출합니다. 상세 모달은 전체 배열을 참조합니다.
- **Watched-address import validation & canary runbook**: `scripts/import_watched_addresses.py`에 header 검증, chain canonicalization, duplicate 차단, enabled/confidence validation, dry-run summary를 넣고, 신규 체인 canary rollout 순서를 운영 문서에 정리했습니다.
- **운영 진단 (2026-04-20)**: 운영 중 발견된 3건의 근본 원인 분석 — 프로덕션 Upbit API 중단 (WebSocket idle disconnect without keepalive), 프로덕션 Redis 실시간 비활성 (Vercel Production에 `WHALESCOPE_SSE_ENABLED` / REST URL / REST TOKEN 누락), Telegram bot 미발송 (`render.yaml`에 `TELEGRAM_BROADCAST_ENABLED` / `TELEGRAM_BROADCAST_DRY_RUN` 명시 선언 부재로 기본값 disabled/dry_run 유지) — 을 Obsidian 프로젝트 노트에 기록하고 대응 가이드를 운영 runbook에 반영했습니다.
- **Google Sheets 429 근본 해결 (Redis L1 + L2 캐시 2-tier)**: Google Sheets API `RATE_LIMIT_EXCEEDED` (60 read/min/user) 한계를 구조적으로 돌파하기 위해 `apps/dashboard/lib/redis-cache.ts`(Upstash REST, 2초 타임아웃, graceful degrade)를 도입하고 `lib/sheets.ts`에 L1(프로세스 내 Map, 45s TTL) + L2(`whalescope:sheet:tab:*` / `whalescope:sheet:batch:dashboard`, 60s TTL) 2단 캐시를 적용했습니다. `upsertWatchlistOverride` 경로에서는 L1/L2 양쪽 명시적 무효화를 수행합니다. 대시보드 1회 로드 기준 Sheets read 8~15회 → 상한 9 read/min으로 고정되어 유저·인스턴스 수와 무관하게 쿼터 안정성을 확보했습니다.
- **로딩 성능 개선 사이클 (Phase A~F, 2026-04-20 후반 ~ 2026-04-21)**: Obsidian `2026-04-20-17-WhaleScope-로딩성능-분석-개선계획.md` 기반으로 홈 루트 `await` 직렬 체인을 `Promise.all`로 병렬화하고, 홈에서는 admin 전용 extras(`brief_cost_ledger` / `broadcast_log` / `llm_budget_log` / `watched_addresses` / `loadRenderObservability`)를 차단해 Render REST cold 호출을 제거했습니다. 디테일 모달 4종(whale-story / signal / market-chart / curated-wallet)을 `next/dynamic`로 lazy load + prefetch-on-interaction 처리, 큐레이션 지갑 모달의 `recharts`를 경량 SVG 파이 차트로 교체, `next.config.ts`의 `experimental.optimizePackageImports`에 `lightweight-charts` / `lucide-react`를 추가했습니다. `/api/stream` `maxDuration` 300s → 60s로 묶고, 트랜잭션 스냅샷은 "최근 200건 + aggregate-only"로 슬림화했습니다. `yarn build` 결과 홈 `/` size 193 → 86.1 kB (−55%), First Load JS 312 → 206 kB (−34%), `/admin`은 0 회귀를 유지했습니다.
- **운영 안정화 패치 묶음 (2026-04-20)**: (1) 로컬 개발 환경에서 브라우저의 CORS 차단으로 Upbit/Bitflyer ticker가 끊기는 이슈를 `/api/proxy/upbit/[...path]` / `/api/proxy/bitflyer/[...path]` Next.js route handler로 우회, 응답에 `Cache-Control: s-maxage=5, stale-while-revalidate=10`을 얹어 QPS를 제한합니다. (2) 개별 Google Sheets 탭 1개가 실패해도 대시보드 전체가 500을 반환하지 않도록 per-tab try/catch 격리를 적용했습니다. (3) 누적 138k 건 수준의 트랜잭션 스냅샷에서 `arr.push(...spread)` 패턴이 call stack overflow를 유발하던 경로를 chunked append로 치환했습니다. (4) 대시보드 서버사이드 렌더링 전반에 `Asia/Seoul` 타임존을 `Intl.DateTimeFormat`으로 핀 고정해 SSR/CSR hydration mismatch를 제거했습니다. (5) Vercel serverless region을 `icn1`(Seoul)로 고정하고 Speed Insights를 활성화해 실측 LCP/INP/TTFB를 수집합니다.
- **모바일 접근성 / 레이아웃 패스 (WCAG 2.5.5)**: 모바일 뷰포트에서 터치 타깃이 24~36 px로 떨어지던 지점(차트 range chip, wallet 행 pill, 티커 상세 토글, 모달 close 버튼, preview/motion 앵커)을 전부 44 × 44 px로 승급했습니다. admin `grid-auto-fit` 그리드 및 서비스 카드·flex item이 좁은 뷰포트에서 가로 스크롤을 만들던 이슈는 `min-width: 0` / 명시적 `minmax()` 가드로 해소했습니다.
- **Wrtn 과제 브랜딩 & 큐레이션 상세 폴리싱 (2026-04-21)**: 네비게이션 헤더에 "Wrtn PE Assignment" 칩과 브랜디드 푸터(Link to `ONE_PAGER.md`와 공개 채널)를 추가해 제출 컨텍스트를 즉시 드러냈고, 큐레이션 감시 지갑 상세 모달의 다크 테마 토큰 정합 및 레이아웃 간격을 다듬었습니다. Bitflyer 프록시 응답의 `bare timestamp`를 UTC로 해석하도록 교정해 김치 프리미엄 계산과 시각 표기가 일관되게 KST로 표시됩니다.

## 아키텍처

```text
[소스 수집]                             [정규화]          [시그널/큐레이션]          [해설/배포]                      [사용자 접점]

Etherscan API v2  ----+
  ETH/ARB/BASE/       |
  BSC/POLYGON         |
                       |
XRPSCAN-compatible ---+
  XRP (feature flag)   |
TronGrid -------------+--> ChainCollectorRegistry
  TRX native + TRC20    |   (silent drop guard)
mempool.space primary +-->                         --> Event(dataclass) --> SignalEngine(8 rules + per-chain override) --> LLMAnalyzer --> Telegram Bot (channel + DM)
  + Blockchair secondary                             |                       |                                          via LLMRouter   Google Sheets
  BTC (UTXO partial view)                            |                       |                                          Anthropic→     Upstash Redis SSE
Blockchair -------+                                  |                       +--> TG mirror lane                         Gemini→Groq    (brief/news/watchlist/stories)
  DOGE (UTXO partial view)                           |                            (external_only / corroborated)                                         │
Solscan API v2 ---------                             |                                                                                                   ▼
  SOL                                                |                                                                                          Next.js Dashboard
Telethon listener -----+                             |                                                                                          (Vercel: / + /admin)
  public TG channels  +---------------> tg_whale_events  --> TG mirror observability (observation_source, confidence)
                                                     |
                                                     +---- Market ticker (Binance/Upbit/Bitflyer/Kraken + FX + Kimchi premium)
                                                     +---- Fear & Greed (alternative.me)
                                                     +---- News RSS (20+ sources, dual staleness)

watched_addresses.csv --> watched_addresses sheet --> collector address scope + rollout diagnostic
address_activity sheet --> baseline builder --> 3-sigma anomaly rules
user_interests sheet --> per-subscriber personalize --> Telegram message variant
service_health v2 sheet --> slot-based dispatcher heartbeat (9 jobs) --> /admin telemetry

Google Sheets  <--L2 cache--  Upstash Redis (whalescope:sheet:*, 60s TTL)  <--L1 cache--  Next.js server (Map, 45s TTL)
                              ↑ 동일 Redis 인스턴스가 SSE event stream(whalescope:live-update:*)도 함께 보관
                              ↑ upsertWatchlistOverride → L1/L2 동시 명시적 무효화
```

핵심 실행 흐름:

1. 감시 주소 목록을 Google Sheets에서 읽습니다.
2. `ChainCollectorRegistry`가 enabled feature flag를 기준으로 체인별 collector를 dispatch합니다 (ETH/ARB/BASE/BSC/POLYGON/SOL 상시, XRP/TRX/BTC/DOGE는 canary rollout). 미등록 체인은 silent drop 대신 `service_health`에 명시적으로 누적됩니다.
3. BTC는 mempool.space primary 실패 시 Blockchair secondary로 fallback하며, 모두 실패하면 빈 결과로 degrade해 파이프라인을 죽이지 않습니다.
4. Telethon listener가 공개 고래 알림 채널 메시지를 별도 수집해 `tg_whale_events`에 적재하고, `observation_source=tg_mirror` + confidence를 함께 기록합니다.
5. 수집 이벤트를 `Event`로 정규화합니다.
6. `SignalEngine`이 규칙 기반 시그널, per-chain override, TG mirror 레인(`external_only_observation` / `corroborated_move`)을 만듭니다.
7. 과거 `address_activity`를 기반으로 baseline을 계산해 spike rule에 주입합니다.
8. `LLMAnalyzer`가 시그널 목록을 하이브리드 전략 (KST 09/15/21 full, 그 외 incremental)으로 한국어 브리핑으로 변환합니다. full slot은 RSS top N + curated watchlist 컨텍스트를 추가 주입합니다.
9. Telegram Bot이 구독자별 관심 규칙을 반영해 DM을 발송하고, `broadcast_daily` 단계에서 공개 채널 브로드캐스트를 수행합니다 (`TELEGRAM_BROADCAST_ENABLED=true` + `DRY_RUN=false` 명시 필요).
10. 거래, 시그널, 브리핑, 시스템 로그, service health v2, broadcast log를 Google Sheets에 저장합니다.
11. 대시보드 server component는 먼저 Upstash Redis L2 캐시(`whalescope:sheet:*`)를 조회하고, miss 시에만 Google Sheets 원본을 호출한 뒤 L1(프로세스 내)·L2(공유)에 결과를 기록합니다. 라이브 섹션은 같은 Redis 인스턴스를 SSE event stream으로 활용해 brief/news/watchlist/stories를 브라우저에 push합니다. Vercel `icn1`(Seoul) 리전에 serverless function을 고정해 Upstash Seoul 리전과 왕복 latency를 10 ms 이하로 유지합니다.

## 기술 스택

| 분류 | 기술 | 용도 |
|---|---|---|
| 언어 | Python 3.11+ | 코어 런타임 |
| LLM | Anthropic, Gemini, Groq | 시그널 해석, 브리핑 생성, 파싱 fallback |
| 라우팅 | `src/llm/router.py` | provider preferred/fallback 라우팅 |
| 온체인 수집 | Etherscan API v2 | ETH, ARB, BASE, BSC, POLYGON |
| 온체인 수집 | XRPSCAN-compatible API | XRP, feature flag(`ENABLE_CHAIN_XRP=true`)로 선택 활성화 |
| 온체인 수집 | TronGrid | TRX native + TRC20(USDT), feature flag(`ENABLE_CHAIN_TRX=true`)로 선택 활성화 |
| 온체인 수집 | mempool.space compatible indexer | BTC, feature flag(`ENABLE_CHAIN_BTC=true`)로 선택 활성화 |
| 온체인 수집 | Blockchair-compatible Dogecoin indexer | DOGE, feature flag(`ENABLE_CHAIN_DOGE=true`)로 선택 활성화 |
| 온체인 수집 | Solscan API v2 | Solana |
| TG 수신 | Telethon | 공개 고래 알림 채널 수신 |
| 시장 데이터 | CoinGecko API | 토큰 USD 가격 보강 |
| 저장소 | Google Sheets, gspread | MVP 영구 저장소 |
| 배포 | Render Cron/Worker, Vercel | 백엔드 워커와 프론트 대시보드 분리 |
| 대시보드 | Next.js / Streamlit | Vercel target 프론트와 legacy local UI |
| CI/CD | GitHub Actions | 선택적 일일/주간 백업 스케줄러 |
| 테스트 | pytest, pytest-asyncio | 단위/통합 테스트 |

## AI 도구 / 모델 사용

| 항목 | 사용 방식 | 선택 이유 |
|---|---|---|
| Anthropic | 기본 LLM provider | 한국어 브리핑 품질과 안정성을 우선시한 기본 경로 |
| Gemini | fallback provider | 기본 provider 실패 시 브리핑 지속성 확보 |
| Groq | fallback provider | 낮은 지연시간과 추가 대체 경로 확보 |
| `LLMRouter` | task별 preferred/fallback 라우팅 | 하나의 모델 실패가 전체 브리핑 실패로 이어지지 않도록 함 |
| Prompt templates | `prompts/*.txt` | 브리핑, 주간 코멘터리, 의도 파악 프롬프트를 분리해 유지보수성을 높임 |

실제 LLM API는 요약/브리핑 생성에만 사용하고, 수집/정규화/시그널 판단은 규칙 기반으로 분리했습니다. 이렇게 하면 AI 출력이 바뀌어도 핵심 탐지 로직은 유지됩니다.

## 데이터 처리 안내

WhaleScope는 다음 데이터를 처리합니다.

| 데이터 종류 | 출처 | 처리 목적 |
|---|---|---|
| 온체인 트랜잭션 | Etherscan, Solscan 공개 API | 감시 주소 활동 수집, 시그널 생성 |
| 공개 Telegram 채널 메시지 | Telethon user session | 고래 이벤트 보조 수집, 교차검증 |
| Telegram 사용자 정보 | Bot `/start`, `/watchlist`, `/status` | 구독 관리와 개인화 |
| 사용자 관심 규칙 | Bot 또는 Sheets `user_interests` | 규칙별 가중치, 제외 처리 |
| LLM 입력 데이터 | 시그널 목록, 공개 이벤트 요약 | 한국어 브리핑 생성 |

PII는 Telegram `chat_id`, `username`, 관심 설정 정도만 저장합니다. 온체인 데이터는 공개 블록체인 데이터입니다. LLM 공급자 사용 시 Anthropic, Google Gemini, Groq의 데이터 처리 정책을 별도로 확인해야 합니다.

## Product Decisions / Tradeoffs

- Google Sheets를 1차 저장소로 사용했습니다. 구현 속도와 과제 재현성은 좋지만, 장기적으로는 스키마 제약과 동시성 한계가 있습니다.
- 규칙 기반 시그널과 LLM 요약을 분리했습니다. 탐지 로직과 설명 로직을 나눠서 결과의 일관성을 유지하려는 선택입니다.
- Telegram을 주요 배포 채널로 썼습니다. 과제에서 바로 체감 가능한 사용자 접점을 만들기 쉽기 때문입니다.
- 실제 LLM API를 기본 데모 경로로 둔 대신 smoke fallback을 유지했습니다. 과제 평가 환경에서 키/네트워크가 없을 때도 repo가 죽지 않게 하려는 선택입니다.
- 공개 Telegram listener는 운영 복잡도가 높지만, 온체인 수집만으로는 놓치는 맥락을 보완하기 위해 포함했습니다.

## 빠른 시작

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
```

`.env`에 최소 필수 값을 채운 뒤, 아래 순서로 진행합니다.

Python backend와 Next.js dashboard를 함께 확인하려면 다음 순서가 가장 짧습니다.

```bash
python -m scripts.init_sheets
python scripts/import_watched_addresses.py --dry-run
python scripts/import_watched_addresses.py
python -m src.main --dry-run
python -m src.pipeline.run_all

cp apps/dashboard/.env.example apps/dashboard/.env.local
npm install
npm run dashboard:dev
```

이미 repo 루트 `.env`에 `GOOGLE_SHEET_ID`와 `GOOGLE_CREDENTIALS_JSON`이 있으면 `apps/dashboard/.env.local` 생성은 생략할 수 있습니다.

대시보드가 비어 있으면 먼저 `transactions`, `signals`, `daily_brief`, `system_log` 시트에 데이터가 쌓였는지 확인합니다. Next.js dashboard는 데이터를 직접 수집하지 않고 Google Sheets snapshot을 읽습니다.

## Real LLM Quick Demo

과제 제출용 기본 데모 경로입니다. fixture 시그널을 사용해 비용과 실행 시간을 통제하되, 브리핑 생성은 실제 LLM API를 통과합니다. Google Sheets, Telegram, 외부 collector 없이 AI 요약/큐레이션 핵심 경험을 확인할 수 있습니다.

1. `.env`에 최소 1개 LLM provider key를 설정합니다.

- `ANTHROPIC_API_KEY`
- `GEMINI_API_KEY`
- `GROQ_API_KEY`

2. 실제 LLM 데모를 실행합니다.

```bash
python scripts/demo_real_llm.py
```

3. 선택적으로 markdown 결과를 저장합니다.

```bash
python scripts/demo_real_llm.py --output docs/demo-output.md
```

출력에는 fixture 기반 signal 요약과 실제 LLM이 생성한 한국어 브리핑이 포함됩니다.

운영과 동일한 전체 파이프라인을 보려면 Google Sheets 초기화, 감시 주소 등록, Telegram 설정 후 아래 명령을 실행합니다.

```bash
python -m scripts.init_sheets
python scripts/import_watched_addresses.py
python -m src.pipeline.run_all
```

- `daily_brief` 시트에 일일 브리핑이 저장됩니다.
- Telegram bot이 연결되어 있으면 브리핑이 발송됩니다.
- `TELEGRAM_BROADCAST_ENABLED=true`이고 bot이 채널 관리자 권한을 가진 경우에만 `TELEGRAM_BROADCAST_CHAT`으로 공개 채널 브로드캐스트를 보냅니다. 그렇지 않으면 파이프라인은 계속 진행하고 `broadcast_log`에 `skipped_*` 또는 `dry_run` 상태를 남깁니다.
- `analysis_log`에 LLM 호출 정보가 기록됩니다.

LLM 키가 없거나 외부 의존성을 배제한 확인이 필요하면 아래 smoke fallback을 사용합니다.

## Smoke Fallback

```bash
python scripts/smoke_pipeline.py
```

정상 출력 예시:

```text
Events : 23
Signals: 3
Brief  : 61 chars
Model  : dry_run
Status : completed
AnalLog: 1 row(s) written, log_ok=True
SMOKE OK
```

## 환경변수

`.env.example`을 기준으로 설정합니다.

### 필수

| 변수 | 설명 |
|---|---|
| `ETHERSCAN_API_KEY` | Etherscan API v2 키. EVM 체인 수집에 필요합니다. |
| `GOOGLE_SHEET_ID` | Google Spreadsheet ID입니다. |
| `GOOGLE_CREDENTIALS_JSON` | Google service account JSON 전체를 한 줄 문자열로 넣습니다. |
| `TELEGRAM_BOT_TOKEN` | BotFather에서 발급받은 Telegram bot token입니다. |

LLM provider key는 아래 중 최소 1개가 필요합니다.

| 변수 | 설명 |
|---|---|
| `ANTHROPIC_API_KEY` | Anthropic 기본 provider 키입니다. |
| `GEMINI_API_KEY` | Gemini provider 키입니다. Anthropic 없이도 fallback provider로 사용할 수 있습니다. |
| `GROQ_API_KEY` | Groq provider 키입니다. Anthropic/Gemini 없이도 fallback provider로 사용할 수 있습니다. |

### 선택

| 변수 | 설명 |
|---|---|
| `SOLSCAN_API_KEY` | Solana 수집 키입니다. 없으면 SOL 수집을 건너뜁니다. |
| `ENABLE_CHAIN_XRP` | XRP 수집 feature flag입니다. 기본값은 `false`이며, Phase 2a rollout 시에만 `true`로 켭니다. |
| `XRPSCAN_API_BASE` | XRP 수집 API base URL입니다. 기본값은 `https://api.xrpscan.com/api/v1`이며, self-hosted mirror나 호환 endpoint가 있을 때만 바꿉니다. |
| `ENABLE_CHAIN_TRX` | TRX 수집 feature flag입니다. 기본값은 `false`이며, TronGrid 연결을 준비한 뒤에만 켭니다. |
| `TRONGRID_API_KEY` | TRX collector rate limit 완화용 API 키입니다. 공개 기본 한도로도 동작하지만 운영에서는 설정을 권장합니다. |
| `TRONGRID_API_BASE` | TRX 수집 API base URL입니다. 기본값은 `https://api.trongrid.io`입니다. |
| `ENABLE_CHAIN_BTC` | BTC 수집 feature flag입니다. 기본값은 `false`이며, BTC indexer 확인 후에만 켭니다. |
| `BTC_INDEXER_BASE` | BTC primary indexer base URL입니다. 기본값은 `https://mempool.space/api`이며, primary 실패 시 collector가 Blockchair secondary를 자동 fallback으로 사용합니다. |
| `BTC_INDEXER_KEY` | BTC primary indexer에 별도 키가 필요할 때 쓰는 선택 값입니다. mempool.space 공개 endpoint만 쓰면 비워둘 수 있습니다. |
| `ENABLE_CHAIN_DOGE` | DOGE 수집 feature flag입니다. 기본값은 `false`이며, Blockchair 또는 호환 indexer 확인 후에만 켭니다. |
| `DOGE_INDEXER_BASE` | DOGE indexer base URL입니다. 기본값은 `https://api.blockchair.com/dogecoin`입니다. |
| `BLOCKCHAIR_API_KEY` | Blockchair 유료 티어를 사용할 때 쓰는 선택 키입니다. 현재 코드에서는 DOGE에 적용됩니다. 기존 `DOGE_INDEXER_KEY`도 alias로 계속 지원합니다. |
| `TELETHON_API_ID` | Telegram user API ID입니다. listener 실제 실행에 필요합니다. |
| `TELETHON_API_HASH` | Telegram user API hash입니다. listener 실제 실행에 필요합니다. |
| `TELETHON_SESSION` | Telethon session 이름입니다. 기본값은 `whalescope`입니다. |
| `TELETHON_PHONE` | 최초 로컬 로그인용 전화번호입니다. 반드시 국가번호 포함 국제 형식으로 입력합니다. 예: `+821012345678`. |
| `TELETHON_SESSION_STRING` | Render 같은 비대화형 worker에서 사용할 Telethon StringSession입니다. 설정하면 파일 기반 session 대신 이 값을 사용합니다. |
| `TG_CHANNEL` | 수신할 공개 채널입니다. 예: `@whale_alert_io`. |
| `TELEGRAM_CHANNEL_USERNAME` | WhaleScope 공개 채널의 핸들입니다. `@` 없이 입력합니다. 현재 값: `whalescope_alertz` (https://t.me/whalescope_alertz). 사용자 홈의 Telegram 연결 CTA/QR 링크 생성에 사용됩니다. |
| `NEXT_PUBLIC_TELEGRAM_CHANNEL_USERNAME` | 위 값과 동일해야 합니다. Next.js 대시보드(`apps/dashboard`)가 클라이언트 번들에서 참조하기 위해 `NEXT_PUBLIC_` 접두어가 필요합니다. 값 변경 시 루트 `TELEGRAM_CHANNEL_USERNAME`과 함께 갱신합니다. |
| `TELEGRAM_BROADCAST_ENABLED` | 공개 채널 브로드캐스트 스위치입니다. 기본값 `false`를 유지하면 파이프라인은 브로드캐스트를 시도하지 않고 명시적으로 skip 로그만 남깁니다. |
| `TELEGRAM_BROADCAST_DRY_RUN` | 공개 채널 브로드캐스트 dry-run 스위치입니다. 기본값 `true`입니다. `ENABLED=true`여도 이 값이 `true`면 실제 발송 없이 `broadcast_log`에 `dry_run` 상태만 기록합니다. |
| `TELEGRAM_BROADCAST_CHAT` | 공개 발송 대상 채널/채팅입니다. 예: `@whalescope_alertz`. |
| `TELEGRAM_BROADCAST_BOT_TOKEN` | 공개 채널 발송에 별도 bot을 쓸 때만 설정합니다. 비워두면 `TELEGRAM_BOT_TOKEN`을 재사용합니다. |
| `NEXT_PUBLIC_TELEGRAM_BROADCAST_CHANNEL` | 사용자 홈의 공개 채널 배지/링크에 표시할 채널 핸들입니다. `@` 없이 입력합니다. |
| `STREAMLIT_PASSWORD` | Streamlit 대시보드 비밀번호입니다. 비우면 인증이 비활성화됩니다. (Streamlit UI는 은퇴되었고, 레거시 스크립트 호환을 위해서만 유지됩니다.) |
| `DASHBOARD_PASSWORD` | Next.js 운영자 API 비밀번호입니다. 운영 환경에서는 `Authorization: Bearer <password>`를 권장하고, `x-dashboard-password`는 로컬/수동 확인 편의용입니다. |
| `WHALESCOPE_PUBLIC_ADMIN_PREVIEW` | 운영자 API를 로그인 없이 preview로 공개할지 여부입니다. 기본값 `false`이며, 평가자 공개 데모 목적일 때만 `true`로 설정합니다. |
| `WHALESCOPE_CURATED_DISABLE_SEED` | 큐레이션 watchlist seed 주입을 끌지 여부입니다. 기본값 `false`이며, 운영 시트가 이미 채워져 있으면 `true`로 두어 seed 덮어쓰기를 방지합니다. |

### 실시간 업데이트 / Redis (SSE + Sheets L2 캐시)

Upstash Redis REST 인스턴스 하나가 두 가지 역할을 동시에 수행합니다.

1. **SSE event stream** (`whalescope:live-update:*`): Next.js 대시보드의 brief / news / watchlist / stories 4개 섹션을 브라우저에 push합니다.
2. **Google Sheets L2 캐시** (`whalescope:sheet:*`, 60s TTL): 서버 컴포넌트가 Sheets API 원본을 호출하기 전에 먼저 조회합니다. Vercel serverless 인스턴스 간 캐시 공유로 Sheets API `RATE_LIMIT_EXCEEDED` (60 read/min/user)를 구조적으로 회피합니다.

| 변수 | 설명 |
|---|---|
| `WHALESCOPE_SSE_ENABLED` | SSE 기능 on/off feature flag. 기본값 `false`. 운영에서 켤 때 `true`. |
| `WHALESCOPE_REDIS_REST_URL` | Upstash Redis REST endpoint URL. SSE와 Sheets L2 캐시 양쪽에서 공유 사용. |
| `WHALESCOPE_REDIS_REST_TOKEN` | Upstash Redis REST token. server-only secret. |

아래 3-gate가 모두 충족되어야 `실시간 연결됨` 상태가 되며, 하나라도 빠지면 `실시간 비활성` (standby)으로 표시됩니다. Sheets L2 캐시는 REST URL/TOKEN만 충족되면 동작하고, Redis 자체가 불가용이어도 `redis-cache.ts`의 2초 타임아웃 + graceful degrade 덕에 원본 Sheets 경로로 자동 폴백합니다.

Vercel Production에서 Redis 연결이 활성화되지 않는 가장 흔한 원인은 이 3개 변수를 Preview 또는 Development 스코프에만 등록하고 Production 스코프에 누락한 경우입니다. Vercel 프로젝트의 Environment Variables 스코프를 반드시 확인하세요. 서버사이드 캐시 상태는 `/api/debug/dashboard?mode=redisPing`과 `/api/debug/dashboard?mode=env`로 점검할 수 있습니다 (DASHBOARD_DIAG_TOKEN 필요).

### Render API observability

`/admin` 화면에 Render 서비스/배포/인스턴스/로그 패널을 붙이려면 아래 서버 전용 secret을 Vercel dashboard env에 설정합니다.

| 변수 | 설명 |
|---|---|
| `RENDER_API_KEY` | Render REST API key. |
| `RENDER_OWNER_ID` | Render workspace owner ID. |
| `RENDER_SERVICE_ID_PIPELINE` | `whalescope-pipeline` 서비스 ID. |
| `RENDER_SERVICE_ID_BOT` | `whalescope-bot` 서비스 ID. |
| `RENDER_SERVICE_ID_LISTENER` | `whalescope-listener` 서비스 ID. |

env 누락 시 대시보드는 빈 섹션이 아니라 명시적인 `Render API unavailable` 안내 카드를 표시하고, 나머지 `/admin` 기능은 정상 동작합니다.

### Google credentials 입력 방식

`GOOGLE_CREDENTIALS_JSON`은 줄바꿈이 없는 JSON 문자열이어야 합니다.

```bash
GOOGLE_CREDENTIALS_JSON='{"type":"service_account","project_id":"..."}'
```

서비스 계정 이메일을 대상 Google Spreadsheet에 편집자 권한으로 공유해야 합니다.

## Google Sheets 초기화

새 스프레드시트에서는 전체 탭과 헤더를 먼저 만듭니다.

```bash
python -m scripts.init_sheets
```

기존 스프레드시트에 아키텍처 전환 이후 추가된 탭만 확인하려면 dry-run을 사용할 수 있습니다.

```bash
python scripts/migrate_sheets.py --dry-run
```

`scripts/migrate_sheets.py` 실제 실행은 `SHEET_ID`를 읽습니다. 기존 스크립트 호환 때문에 이름이 다릅니다.

```bash
SHEET_ID="$GOOGLE_SHEET_ID" python scripts/migrate_sheets.py
```

생성되는 주요 탭:

| 탭 | 용도 |
|---|---|
| `transactions` | 수집 및 분석된 거래 로그 |
| `daily_brief` | 일별 브리핑 저장 |
| `subscribers` | Telegram 구독자와 watchlist |
| `analysis_log` | LLM 호출, prompt version, 캐시 추적 |
| `system_log` | pipeline run, 운영 로그, 미지원 심볼 리포트 |
| `watched_addresses` | 감시 주소 registry |
| `address_activity` | 감시 주소별 온체인 활동 원천 로그 |
| `tg_whale_events` | Telegram 채널 파싱 이벤트 |
| `signals` | 규칙 기반 시그널 저장 |
| `weekly_trend` | 주간 트렌드 코멘터리 저장 |
| `user_interests` | 사용자별 규칙 가중치와 제외 설정 |

## 감시 주소 시드 등록

기본 시드는 [config/watched_addresses.csv](config/watched_addresses.csv)에 있습니다.

이 CSV는 이제 파일 상단에 `#` comment line을 둘 수 있습니다. 현재 기본 파일에는 아래 운영 메모가 포함되어 있습니다.

- chain enum: `ETH`, `ARB`, `BASE`, `BSC`, `POLYGON`, `SOL`, `XRP`, `TRX`, `BTC`, `DOGE`
- feature flag: `ENABLE_CHAIN_XRP`, `ENABLE_CHAIN_TRX`, `ENABLE_CHAIN_BTC`, `ENABLE_CHAIN_DOGE`
- partial view: `BTC`, `DOGE`는 UTXO 체인이라 대표 주소 seed 기준으로만 먼저 추적되며 UI에 `부분 관측 · cluster 미적용` 배지가 붙을 수 있습니다.

기본 seed에는 기존 ETH/SOL 외에 concrete BTC/XRP/TRX/DOGE 주소가 포함되어 있습니다. 단, 시트에 seed를 import해도 해당 체인의 collector가 자동 활성화되지는 않습니다. 새 체인은 아래 feature flag와 indexer env를 준비한 뒤 순차적으로 켜야 합니다.

먼저 dry-run으로 확인합니다.

```bash
python scripts/import_watched_addresses.py --dry-run
```

문제가 없으면 현재 storage backend에 upsert합니다. `STORAGE_BACKEND=postgres` 환경에서는 Render PostgreSQL의 `watched_addresses` 테이블에 쓰고, 기본값 또는 `--backend sheets`는 Google Sheets에 씁니다.

```bash
python scripts/import_watched_addresses.py
python scripts/import_watched_addresses.py --backend postgres
```

다른 CSV를 쓰려면 헤더를 `config/watched_addresses.csv`와 맞춘 뒤 `--csv`를 지정합니다.

```bash
python scripts/import_watched_addresses.py --csv path/to/watched_addresses.csv
```

신규 체인 canary 순서:

- XRP: `ENABLE_CHAIN_XRP=true`, 필요 시 `XRPSCAN_API_BASE`
- TRX: `ENABLE_CHAIN_TRX=true`, `TRONGRID_API_KEY`, 필요 시 `TRONGRID_API_BASE`
- BTC: `ENABLE_CHAIN_BTC=true`, `BTC_INDEXER_BASE`(primary mempool), 필요 시 `BTC_INDEXER_KEY`. collector는 primary 실패 시 Blockchair secondary를 자동 fallback으로 시도한다.
- DOGE: `ENABLE_CHAIN_DOGE=true`, `DOGE_INDEXER_BASE`, 필요 시 `BLOCKCHAIR_API_KEY` (`DOGE_INDEXER_KEY` alias 지원)

상세 절차와 검증 포인트는 [docs/operational-run-verification.md](docs/operational-run-verification.md)의 canary rollout 섹션을 따릅니다. 운영자가 가장 자주 쓰는 사전 검증 경로는 아래 두 가지입니다.

- 로컬 live contract test: `pytest -q -m contract tests/contract`
- GitHub Actions 수동 실행: [`.github/workflows/chain_contract.yml`](.github/workflows/chain_contract.yml) `Chain Contract`

## 실행 방법

운영 모드 실행은 실제 Google Sheets 쓰기, LLM API 호출, Telegram 발송을 포함합니다. 실행 전후 체크리스트와 합격 기준은 [docs/operational-run-verification.md](docs/operational-run-verification.md)를 기준으로 확인하세요.

### 1. 외부 API 없는 smoke test

fixture 이벤트 23건으로 파이프라인 핵심 경로를 검증합니다. credentials 없이도 동작하도록 외부 의존성을 mock 처리합니다.

```bash
python scripts/smoke_pipeline.py
python scripts/smoke_pipeline.py --verbose
```

확인하는 항목:

- fixture 이벤트 로드
- SignalEngine 실행
- signal 기반 top5 추출
- dry-run 브리핑 생성
- analysis_log mock 저장
- 전체 pipeline status

### 2. 일일 파이프라인 dry-run

`src.main` 자체 dry-run입니다. `.env` 필수값은 필요하지만 외부 수집과 Telegram 발송은 건너뜁니다.

```bash
python -m src.main --dry-run
```

### 3. 일일 파이프라인 실제 실행

온체인 수집, 시그널 생성, 뉴스/스토리/브리핑 cadence, Sheets 저장, Telegram 발송까지 production cadence 기준으로 실행합니다.

```bash
python -m src.pipeline.run_all
```

동일 기능을 수동 실행용 wrapper로 실행할 수도 있습니다.

```bash
python scripts/manual_brief.py
```

실행 전 체크:

- `.env` 필수값이 모두 설정되어 있어야 합니다.
- `python -m scripts.init_sheets`가 최소 1회 성공해야 합니다.
- `python scripts/import_watched_addresses.py`로 감시 주소가 등록되어 있어야 합니다.
- Telegram bot에 구독자가 없다면 발송 결과는 `sent=0`일 수 있습니다.

### 4. Telegram listener

공개 Telegram 채널 메시지를 수신해 `tg_whale_events`에 저장합니다.

파서만 검증:

```bash
python scripts/run_listener.py --dry-run
```

실제 수신:

```bash
TG_CHANNEL=@whale_alert_io python scripts/run_listener.py
```

최초 로컬 로그인:

```bash
TELETHON_PHONE=+821012345678 TG_CHANNEL=@whale_alert_io python scripts/run_listener.py
```

전화번호는 `010...` 형식이 아니라 국가번호를 포함한 `+82...` 형식이어야 합니다. 한국 번호는 앞의 `0`을 빼고 `+82`를 붙입니다. 인증 코드 입력이 성공하면 `TELETHON_SESSION` 이름 기준의 `.session` 파일이 생성되고, 이후에는 `TELETHON_PHONE` 없이 실행할 수 있습니다. `.session` 파일은 로그인 세션이므로 git에 올리지 않습니다.

Render secret용 StringSession 생성:

```bash
TELETHON_PHONE=+821012345678 python scripts/create_telethon_session.py
```

출력된 `TELETHON_SESSION_STRING`은 Telegram 계정 접근 권한이 있는 secret입니다. 터미널 출력값을 Render Environment Variables에 넣고, 저장소나 문서에는 커밋하지 않습니다.

실제 수신 전 필요 조건:

- `TELETHON_API_ID`, `TELETHON_API_HASH`, `TELETHON_SESSION` 설정
- 최초 실행 시 `TELETHON_PHONE=+82...`로 Telethon 인증 절차 완료
- `TG_CHANNEL` 설정
- Google Sheets credentials 설정
- LLM provider key는 선택 사항입니다. 설정하면 정규식 파싱 실패 시 LLM fallback을 사용하고, 없으면 정규식 파싱만으로 동작합니다.

listener는 상시 프로세스입니다. GitHub Actions보다는 로컬, Render, Fly.io, VPS 같은 long-running 환경에서 실행하는 것을 권장합니다. Render처럼 입력 프롬프트를 받을 수 없는 환경에서는 `scripts/create_telethon_session.py`로 만든 `TELETHON_SESSION_STRING`을 secret으로 넣거나, Render persistent disk에 `.session` 파일을 유지해야 합니다.

운영 상태 기록:

- listener 시작 시 `system_log`에 `run_type=telethon_listener`, `event=listener_start`가 기록됩니다. `event=listener_start`는 `client.connect()`와 인증 성공 이후에 남기므로, 연결 실패 상태에서는 heartbeat가 기록되지 않습니다.
- 메시지 저장 성공 시 `event=message_processed`가 기록되고, 운영 대시보드의 listener 카드가 이 heartbeat를 기준으로 `정상` 또는 `대기 중`을 표시합니다.
- `scripts/run_listener.py`는 실행 중 별도 asyncio 태스크로 5분 간격 `_heartbeat_loop`을 돌립니다. 매 주기마다 `TelethonListener.health_status()`를 조회해 `status`, `last_message_at`, `staleness_seconds`, `message_count`, `error_count`를 로그로 남기고, 마지막 수신 이후 900초(15분) 이상 경과하면 `stale` 경고를 출력합니다.
- heartbeat가 아직 없지만 `tg_whale_events`에 최신 수집 기록이 있으면, 대시보드는 이를 listener 활동의 fallback 근거로 사용합니다.
- 세션 미인증이나 전화번호 형식 오류는 `event=auth_error`로 기록되며, 운영 대시보드에는 `인증 필요`로 표시됩니다.
- 저장소/처리 오류는 `event=message_error`로 기록되며, 운영 대시보드에는 `확인 필요`로 표시됩니다.
- Google Sheets 자체가 연결되어 있어도 `telethon_listener` heartbeat 또는 최신 `tg_whale_events` 기록이 없으면 listener는 정상으로 간주하지 않습니다.

### 5. Telegram bot long polling

사용자 명령을 처리합니다.

```bash
python scripts/run_bot.py
```

지원 명령:

| 명령 | 설명 |
|---|---|
| `/start` | 구독 등록 또는 재활성화 |
| `/watchlist` | 현재 관심 코인 조회 |
| `/watchlist ETH BTC SOL` | 관심 코인 설정 |
| `/pause` | 알림 일시중지 |
| `/status` | 구독 상태 조회 |
| `/language` | 현재 언어 조회 |
| `/language ko\|en\|ja` | 브리핑 언어 설정 (한국어/영어/일본어) |

주의: `run_bot.py`는 명령 처리용 long-polling 프로세스입니다. production cadence 실행은 Render pipeline의 `python -m src.pipeline.run_all`이 담당하고, GitHub Actions는 수동 복구용 workflow_dispatch만 유지합니다.

### 6. 주간 트렌드

주간 누적 흐름 코멘터리를 생성합니다.

```bash
python scripts/run_weekly_trend.py
```

이 스크립트는 `load_config()`를 호출하므로 일일 파이프라인과 동일한 필수 환경변수가 필요합니다.

### 7. LLM provider smoke

설정된 provider별로 짧은 호출을 수행합니다. 키가 없는 provider는 skip합니다.

```bash
python scripts/smoke_llm.py
```

### 8. 연결 테스트

외부 API 연결을 실제로 확인합니다.

```bash
python scripts/test_connection.py
```

확인 대상:

- Etherscan
- CoinGecko
- Anthropic
- Google Sheets
- Telegram Bot API

실제 API 호출이 발생하므로 로컬 smoke test와 달리 네트워크와 유효한 키가 필요합니다.

### 9. Next.js 대시보드

Vercel 배포 대상 dashboard입니다. Google Sheets를 server side에서 읽고 browser에는 secret을 노출하지 않습니다.

```bash
cp apps/dashboard/.env.example apps/dashboard/.env.local
npm install
npm run dashboard:dev
```

검증 명령:

```bash
npm run dashboard:lint
npm run dashboard:typecheck
npm run dashboard:build
```

자세한 내용은 [apps/dashboard/README.md](apps/dashboard/README.md)를 확인하세요.

### 10. Streamlit 대시보드

Google Sheets의 거래와 브리핑 데이터를 읽어 대시보드를 띄웁니다.

```bash
streamlit run streamlit_app.py
```

대시보드 인증:

- `STREAMLIT_PASSWORD`가 있으면 비밀번호 입력 후 접근합니다.
- 비어 있으면 인증 없이 접근되며 화면에 경고가 표시됩니다.
- Streamlit은 현재 Vercel 대상이 아니라 legacy local dashboard입니다.

## Render / Vercel 배포

현재 권장 production 구성은 Render가 Python worker를 담당하고, Vercel이 Next.js dashboard를 담당하는 분리 구조입니다.

### Render services

| Service | Type | Start command | 역할 |
|---|---|---|---|
| `whalescope-pipeline` | Cron Job | `python -m src.pipeline.run_all` | KST cadence 기준으로 signals, curated balance, news, stories, brief, broadcast, channel health, weekly trend를 단일 오케스트레이터에서 실행 |
| `whalescope-bot` | Background Worker | `python scripts/run_bot.py` | Telegram 사용자 명령 처리 |
| `whalescope-listener` | Background Worker | `TG_CHANNEL=@whale_alert_io python scripts/run_listener.py` | 공개 Telegram 채널 이벤트 수신 |

Render에는 worker 역할별로 env를 나눠 등록하는 편이 안전합니다. `whalescope-pipeline`은 `ETHERSCAN_API_KEY`, `GOOGLE_SHEET_ID`, `GOOGLE_CREDENTIALS_JSON`, `TELEGRAM_BOT_TOKEN`, LLM provider key 중 1개가 필요합니다. 추가 체인은 `render.yaml`에 정의된 feature flag를 기본값 `false`로 두고 canary로 켭니다: XRP는 `ENABLE_CHAIN_XRP=true`와 필요 시 `XRPSCAN_API_BASE=https://api.xrpscan.com/api/v1`, TRX는 `ENABLE_CHAIN_TRX=true`와 `TRONGRID_API_KEY` 및 필요 시 `TRONGRID_API_BASE=https://api.trongrid.io`, BTC는 `ENABLE_CHAIN_BTC=true`와 `BTC_INDEXER_BASE=https://mempool.space/api` 및 필요 시 `BTC_INDEXER_KEY`를 사용합니다. BTC collector는 primary 오류나 rate limit 상황에서 Blockchair secondary를 자동 fallback으로 시도합니다. DOGE는 `ENABLE_CHAIN_DOGE=true`와 `DOGE_INDEXER_BASE=https://api.blockchair.com/dogecoin` 및 필요 시 `BLOCKCHAIR_API_KEY`를 사용합니다. 코드 레벨에서는 기존 `DOGE_INDEXER_KEY`도 alias로 계속 읽습니다. BTC와 DOGE는 UTXO 체인이라 대표 주소 seed 기준 partial view로 먼저 시작한다는 점을 운영자가 알고 켜야 합니다.

공개 채널 브로드캐스트를 켤 때는 `render.yaml` 또는 Render Environment에 반드시 `TELEGRAM_BROADCAST_ENABLED=true`와 `TELEGRAM_BROADCAST_DRY_RUN=false`를 **명시적으로 선언**해야 합니다. 둘 다 선언이 없으면 코드 기본값(`ENABLED=false`, `DRY_RUN=true`)이 유지되어 파이프라인은 정상 실행되지만 실제 채널 발송은 일어나지 않고 `broadcast_log`에 skip 상태만 남습니다. 이때 `TELEGRAM_BROADCAST_CHAT=@whalescope_alertz`도 함께 설정하고, bot을 해당 채널의 관리자에 올립니다.

`whalescope-listener`는 `GOOGLE_SHEET_ID`, `GOOGLE_CREDENTIALS_JSON`, `TELETHON_API_ID`, `TELETHON_API_HASH`, `TELETHON_SESSION`, `TELETHON_SESSION_STRING`, `TG_CHANNEL`이 최소값이며, LLM provider key는 선택 사항입니다. production cron 정의는 저장소 루트 `render.yaml`을 기준으로 관리합니다.

### Vercel dashboard

| Setting | Value |
|---|---|
| Root Directory | `apps/dashboard` |
| Install Command | `npm install` |
| Build Command | `npm run build` |
| Serverless Region | `icn1` (Seoul) — `next.config.mjs`의 `serverRuntimeConfig` / per-route `export const runtime = 'nodejs'; export const preferredRegion = 'icn1';` 로 Google Sheets / Render API RTT를 단축 |
| Speed Insights | 활성화 (`@vercel/speed-insights/next`). 실사용자 LCP/FCP/CLS/TTFB를 Production 스코프에서 수집해 Day 10 성능 회귀를 감시 |

Vercel에는 dashboard server-only env만 등록합니다.

| Variable | 설명 |
|---|---|
| `GOOGLE_SHEET_ID` | Google Spreadsheet ID |
| `GOOGLE_CREDENTIALS_JSON` | Google service account JSON |
| `NEXT_PUBLIC_APP_NAME` | 선택 표시값 |
| `NEXT_PUBLIC_TELEGRAM_CHANNEL_USERNAME` | 사용자 홈 CTA용 공개 채널 핸들 (`@` 제외) |
| `NEXT_PUBLIC_TELEGRAM_BROADCAST_CHANNEL` | broadcast 채널 배지용 |
| `WHALESCOPE_SSE_ENABLED` | SSE feature flag (`true`로 설정 시 활성화) |
| `WHALESCOPE_REDIS_REST_URL` | Upstash Redis REST endpoint |
| `WHALESCOPE_REDIS_REST_TOKEN` | Upstash Redis REST token |
| `RENDER_API_KEY` | `/admin` Render observability 패널 |
| `RENDER_OWNER_ID` | Render workspace owner ID |
| `RENDER_SERVICE_ID_PIPELINE` | `whalescope-pipeline` 서비스 ID |
| `RENDER_SERVICE_ID_BOT` | `whalescope-bot` 서비스 ID |
| `RENDER_SERVICE_ID_LISTENER` | `whalescope-listener` 서비스 ID |
| `DASHBOARD_PASSWORD` | 운영자 API 인증 비밀번호 |

env 스코프 주의: Vercel은 Production / Preview / Development 스코프를 분리해서 관리합니다. SSE 3-gate 변수(`WHALESCOPE_SSE_ENABLED` / `WHALESCOPE_REDIS_REST_URL` / `WHALESCOPE_REDIS_REST_TOKEN`)는 반드시 **Production 스코프**에 함께 등록해야 배포본에서 `실시간 연결됨`으로 동작합니다. 이 변수들이 Preview에만 등록되어 있으면 Production 빌드에서는 standby 상태가 유지됩니다.

대시보드는 읽기 전용입니다. 데이터가 비어 있으면 Vercel 문제가 아니라 Render pipeline 또는 Google Sheets 데이터 적재 상태를 먼저 확인합니다.

## GitHub Actions

GitHub Actions는 수동 복구용 실행 경로입니다. 현재 권장 production 경로는 Render cron/worker와 Vercel dashboard입니다.

### Weekly Trend Commentary

파일: [.github/workflows/weekly_trend.yml](.github/workflows/weekly_trend.yml)

- 수동 실행: GitHub Actions `workflow_dispatch`
- 실행 명령: `python scripts/run_weekly_trend.py`
- concurrency group: `weekly-trend`

### 등록할 GitHub Secrets

Settings -> Secrets and variables -> Actions에 등록합니다.

| Secret | 필수 여부 | 설명 |
|---|---:|---|
| `ANTHROPIC_API_KEY` | 조건부 | LLM provider. 아래 LLM 키 중 최소 1개 필요 |
| `GEMINI_API_KEY` | 조건부 | LLM provider. 아래 LLM 키 중 최소 1개 필요 |
| `GROQ_API_KEY` | 조건부 | LLM provider. 아래 LLM 키 중 최소 1개 필요 |
| `ETHERSCAN_API_KEY` | 필수 | EVM 체인 수집 |
| `SOLSCAN_API_KEY` | 선택 | Solana 수집 |
| `ENABLE_CHAIN_XRP` | 선택 | XRP 수집 feature flag. 기본값 `false` |
| `XRPSCAN_API_BASE` | 선택 | XRP 수집 API base override |
| `ENABLE_CHAIN_TRX` | 선택 | TRX 수집 feature flag. 기본값 `false` |
| `TRONGRID_API_KEY` | 선택 | TronGrid API key |
| `TRONGRID_API_BASE` | 선택 | TronGrid API base override |
| `ENABLE_CHAIN_BTC` | 선택 | BTC 수집 feature flag. 기본값 `false` |
| `BTC_INDEXER_BASE` | 선택 | BTC indexer base override. 기본값 `https://mempool.space/api` |
| `BTC_INDEXER_KEY` | 선택 | BTC 유료 indexer key |
| `ENABLE_CHAIN_DOGE` | 선택 | DOGE 수집 feature flag. 기본값 `false` |
| `DOGE_INDEXER_BASE` | 선택 | DOGE indexer base override. 기본값 `https://api.blockchair.com/dogecoin` |
| `BLOCKCHAIR_API_KEY` | 선택 | Dogecoin Blockchair API key (`DOGE_INDEXER_KEY` alias 지원) |
| `GOOGLE_SHEET_ID` | 필수 | Spreadsheet ID |
| `GOOGLE_CREDENTIALS_JSON` | 필수 | 서비스 계정 JSON 전체 |
| `TELEGRAM_BOT_TOKEN` | 필수 | Telegram bot token |
| `DASHBOARD_PASSWORD` | 권장 | Vercel 운영자 API 접근 비밀번호. 운영 환경은 Bearer 인증 권장, `x-dashboard-password`는 로컬/수동 확인용 |

Telethon listener는 GitHub Actions에서 상시 실행하기 어렵기 때문에 별도 runtime에 배포하는 것을 권장합니다. signals, brief, stories, news, broadcast, channel health, weekly trend의 자동 cadence도 Render에서만 돌리고, GitHub Actions는 workflow_dispatch만 유지합니다.

## 모듈 구조

```text
src/
├── main.py                    # 10단계 일일 파이프라인
├── config.py                  # .env 로드와 Config dataclass
├── llm/
│   ├── base.py                # LLMProvider Protocol, LLMResult
│   ├── router.py              # preferred/fallback 라우터
│   ├── anthropic_provider.py
│   ├── gemini_provider.py
│   ├── groq_provider.py
│   └── usage.py               # 사용량/비용 보조 로직
├── signals/
│   ├── baseline.py            # address_activity 기반 baseline 계산
│   ├── engine.py              # rule 실행, corroboration, personalize
│   ├── rules.py               # 8개 시그널 규칙
│   └── models.py              # Event, Signal, RuleContext
├── ingestion/
│   ├── etherscan.py           # EtherscanCollector
│   ├── solscan.py             # SolscanCollector
│   ├── normalizer.py          # raw tx -> Event
│   └── telethon_listener.py   # 공개 TG 채널 수신
├── analyzer/
│   ├── claude_analyzer.py     # LLMAnalyzer, ClaudeAnalyzer compat alias
│   ├── prompt_loader.py       # mtime/sha1 cached prompt loader
│   ├── price_service.py       # CoinGecko price cache, unknown symbol report
│   └── scoring.py             # legacy fallback-only scorer
├── storage/
│   ├── protocol.py            # Storage Protocol
│   ├── schema.py              # Sheets tab headers
│   └── sheets_client.py       # Google Sheets implementation
├── distributor/
│   ├── telegram_bot.py        # command handlers, send retry, personalization, /language
│   └── formatters.py
├── i18n/
│   └── languages.py           # Language dataclass, SUPPORTED_LANGUAGES (ko/en/ja)
└── utils/
    ├── datetime_utils.py      # ISO 8601 parse_dt / parse_dt_strict 공용 유틸
    ├── errors.py
    ├── http_backoff.py        # 공유 HTTP 백오프 (429/5xx 지수 재시도)
    ├── logger.py
    ├── number_utils.py        # safe_float 공용 유틸
    └── retry.py               # sync/async retry helpers
```

```text
config/
├── llm_routing.yaml           # 태스크별 preferred/fallback 모델
├── signals.yaml               # 시그널 룰 임계값
└── watched_addresses.csv      # 감시 주소 시드 + chain/feature-flag/partial-view 안내 주석

prompts/
├── daily_brief.system.txt
├── daily_brief.user.txt
├── weekly_trend.system.txt
└── nl_intent.system.txt
```

## 시그널 규칙

| 규칙 | 설명 | 기본 심각도 |
|---|---|---|
| `cex_outflow_spike` | CEX 유출 24h 흐름이 baseline 대비 3σ 이상 | medium |
| `cex_inflow_spike` | CEX 유입 24h 흐름이 baseline 대비 3σ 이상 | medium |
| `cold_to_hot_transfer` | cold wallet에서 hot wallet로 500만 달러 이상 이동 | high |
| `smart_money_accumulation` | 감시 주소 3곳 이상이 24h 내 동시 매집 | high |
| `token_whale_concentration_shift` | 상위 고래 보유 집중도 2% 이상 변화 | medium |
| `tg_cex_inflow_burst` | TG 채널에서 10분 내 CEX 유입 3건 이상 감지 | medium |
| `corroborated_move` | 온체인 수집과 TG 수신이 같은 이벤트를 교차 확인 | boosted |
| `weekly_net_accumulation` | 주간 순유입이 과거 흐름 대비 2σ 이상 | low |

## 개인화

사용자 개인화는 `user_interests` 탭을 통해 규칙 단위로 적용됩니다.

현재 `SignalEngine.personalize()`가 읽는 대표 필드:

| 필드 | 의미 |
|---|---|
| `chat_id` | Telegram chat ID |
| `dimension` | 현재 rule 기반 개인화는 `rule` 사용 |
| `value` | rule 이름. 예: `cex_outflow_spike` |
| `weight` | 점수 가중치. 엔진에서 0.7x에서 1.5x 범위로 clamp |
| `source` | 설정 출처 |
| `updated_at` | 갱신 시각 |

Telegram 발송 시 구독자별로 `list_user_interests(chat_id)`를 읽고, signal 목록을 개인화한 뒤 별도 메시지를 생성합니다. 개인화 결과가 비어 있으면 `"오늘은 관심 기준에 부합하는 시그널이 없습니다."`를 보냅니다.

## 다국어 브리핑

LLM 브리핑과 Telegram 메시지는 구독자별로 `ko`, `en`, `ja` 중 하나를 선택할 수 있습니다. 구현은 다음과 같이 분리되어 있습니다.

| 모듈 | 역할 |
|---|---|
| `src/i18n/languages.py` | `Language` dataclass와 `SUPPORTED_LANGUAGES` 레지스트리 (`prompt_suffix`, `disclaimer` 포함) |
| `src/storage/sheets_client.py` | `SUBSCRIBERS_HEADERS_EXT`로 `subscribers` 탭에 `language` 컬럼을 확장하고 upsert 시 기본값 `ko` 사용 |
| `src/analyzer/*` | 프롬프트에 `prompt_suffix`를 합성해 선택 언어로 응답하도록 유도 |
| `src/distributor/telegram_bot.py` | `/language` 명령으로 구독자 선호 언어를 조회/설정하고, 일일 브리핑 발송 시 해당 언어 템플릿을 사용 |

`subscribers` 탭에 `language` 컬럼이 없는 기존 워크시트도 자동 확장 됩니다 (누락 컬럼은 `ko`로 기본 세팅). Bot 명령은 앞 절 `지원 명령` 표의 `/language` 항목을 참고하세요.

## 대시보드 인터랙션

대시보드는 Google Sheets 기반 읽기 전용이 기본이지만, 데모 편의를 위해 몇 가지 인터랙션을 in-memory 휘발성 상태로 지원합니다. 서버 재시작 시 상태는 초기화됩니다.

| 컴포넌트 | 위치 | 엔드포인트 | 동작 |
|---|---|---|---|
| `SignalActionCard` | `apps/dashboard/components/signal-action-card.tsx` | `PATCH /api/signals/[id]` | 시그널 단위 acknowledge/dismiss 토글. 상태 머신(`idle → saving → acknowledged/dismissed/error`) 으로 double-fire 방지 |
| `WatchlistEditor` | `apps/dashboard/components/watchlist-editor.tsx` | `GET\|PATCH /api/watchlist` | 감시 주소 enabled 토글. `useEffect` + `AbortController` + empty deps + optimistic update with revert-on-error |
| `LanguageSelector` | `apps/dashboard/components/language-selector.tsx` | `GET\|POST /api/language` | 대시보드 언어(ko/en) 쿠키 설정. `dashboard_lang` 쿠키에 1년 TTL로 저장하고, shared navbar / Telegram modal chrome에 즉시 반영 |

`PATCH /api/signals/[id]`, `GET\|PATCH /api/watchlist` 같은 운영성 인터랙션은 `requireDashboardAuth` + `rateLimit`을 통과합니다. `GET\|POST /api/language`는 사용자 홈에서도 동작해야 하므로 `rateLimit`만 적용되는 public cookie endpoint로 분리했습니다. in-memory 저장소는 데모용이며 실제 영속화가 필요하면 Google Sheets 또는 별도 RDB로 교체할 수 있습니다.

## 테스트

전체 테스트:

```bash
pytest -q
```

현재 로컬 기준:

```text
402 passed
```

dashboard 쪽 별도 검증:

```bash
npm run dashboard:typecheck
npm run dashboard:lint
npm run dashboard:build
npm run dashboard:e2e -- tests/e2e/dashboard-whale-story-observation-lane.spec.tsx
```

모두 통과 상태입니다. `dashboard:typecheck`는 `.next/types`를 읽기 때문에 build와 병렬로 돌리면 흔들릴 수 있어, 운영 검증에서는 build 후 직렬로 실행하는 것을 권장합니다.

주요 targeted 테스트:

```bash
pytest tests/test_main.py -q
pytest tests/test_distributor.py -q
pytest tests/test_baseline.py tests/test_storage.py -q
pytest tests/test_rules/test_rules.py -q
```

주의:

- 테스트는 외부 API를 mock 처리합니다.
- 실제 API 연결 검증은 `python scripts/test_connection.py`를 별도로 실행합니다.
- `pytest-asyncio`가 필요하므로 `pip install -r requirements.txt` 또는 `pip install -e ".[dev]"`를 사용하세요. `pyproject.toml`에 동일한 의존성과 `pytest` 설정이 포함되어 있습니다.

## 운영 순서

처음 운영 환경을 만들 때 권장 순서입니다.

1. Python 가상환경 생성 및 의존성 설치
2. `.env.example` 복사 후 `.env` 작성
3. Google service account를 Spreadsheet에 공유
4. `python -m scripts.init_sheets`
5. `python scripts/import_watched_addresses.py --dry-run`
6. `python scripts/import_watched_addresses.py`
7. `python scripts/smoke_pipeline.py`
8. `python scripts/test_connection.py`
9. `python -m src.main --dry-run`
10. `python -m src.pipeline.run_all`
11. `python scripts/run_bot.py`를 long-running 프로세스로 실행
12. `TG_CHANNEL=@whale_alert_io python scripts/run_listener.py`를 별도 long-running 프로세스로 실행
13. Render에 pipeline, bot, listener 서비스를 분리 등록
14. Vercel에 `apps/dashboard` dashboard 배포
15. 필요하면 GitHub Actions secrets 등록 후 daily/weekly workflow를 백업 경로로 수동 실행

## 트러블슈팅

### `Missing required environment variable`

`src/config.py`는 아래 값을 필수로 요구합니다.

```text
ETHERSCAN_API_KEY
GOOGLE_SHEET_ID
GOOGLE_CREDENTIALS_JSON
TELEGRAM_BOT_TOKEN
```

또한 LLM provider key는 아래 중 최소 1개가 필요합니다.

```text
ANTHROPIC_API_KEY
GEMINI_API_KEY
GROQ_API_KEY
```

### Google Sheets 초기화 실패

- `GOOGLE_CREDENTIALS_JSON`이 한 줄 JSON인지 확인합니다.
- 서비스 계정 이메일이 Spreadsheet에 편집자로 공유되어 있는지 확인합니다.
- Spreadsheet ID가 URL 전체가 아니라 ID 부분만 들어갔는지 확인합니다.

### `scripts/migrate_sheets.py`가 `SHEET_ID`를 요구함

이 스크립트는 기존 호환 때문에 `GOOGLE_SHEET_ID`가 아니라 `SHEET_ID`를 읽습니다.

```bash
SHEET_ID="$GOOGLE_SHEET_ID" python scripts/migrate_sheets.py
```

새 환경에서는 `python -m scripts.init_sheets`를 우선 사용하세요.

### Telethon listener가 시작되지 않음

- `TELETHON_API_ID`, `TELETHON_API_HASH`, `TG_CHANNEL`을 확인합니다.
- 최초 실행 시 user session 인증이 필요할 수 있습니다.
- Bot API token과 Telethon user API는 다른 인증 체계입니다.

### 브리핑은 생성되는데 Telegram 발송이 0건

- `subscribers` 탭에 `status=active` 구독자가 있는지 확인합니다.
- 사용자가 bot에 `/start`를 보냈는지 확인합니다.
- 사용자가 bot을 차단하면 `blocked`로 분류됩니다.

### 시그널이 너무 적음

- `watched_addresses` 탭에 enabled 감시 주소가 있는지 확인합니다.
- `address_activity`가 7일 미만이면 baseline 기반 spike rule은 자연스럽게 약하게 동작합니다.
- CoinGecko 미지원 심볼은 `system_log`의 `price_unknown_symbols` category로 쌓입니다.

### dry-run은 되는데 실제 실행이 실패함

`scripts/smoke_pipeline.py`는 외부 의존성을 mock 처리합니다. 실제 실행 문제는 `scripts/test_connection.py`로 API별 연결을 먼저 분리해서 확인하세요.

### 로컬은 `실시간 연결됨` / 배포본은 `실시간 비활성`

Vercel Production 스코프에 `WHALESCOPE_SSE_ENABLED=true`, `WHALESCOPE_REDIS_REST_URL`, `WHALESCOPE_REDIS_REST_TOKEN` 3개 변수가 모두 등록되어 있는지 확인합니다. Preview 스코프에만 등록되어 있으면 Production 빌드에서는 3-gate 중 어느 하나가 빠져 standby 상태가 유지됩니다. 로컬은 `.env`를 직접 읽기 때문에 같은 3개 변수가 있으면 즉시 라이브 상태가 됩니다.

### Telegram 채널에 공지가 올라오지 않음

`broadcast_log` 시트에서 가장 최근 `run_type=broadcast_daily` 또는 `broadcast_periodic` 레코드의 `status` 컬럼을 먼저 확인합니다. `skipped_disabled`는 `TELEGRAM_BROADCAST_ENABLED` 미설정, `dry_run`은 `TELEGRAM_BROADCAST_DRY_RUN=true` 또는 미설정 상태를 의미합니다. Render Environment 또는 `render.yaml`에 `TELEGRAM_BROADCAST_ENABLED=true`와 `TELEGRAM_BROADCAST_DRY_RUN=false`를 **둘 다 명시적으로** 선언해야 실제 발송이 일어납니다. bot이 채널 관리자에 올라가 있는지도 함께 확인합니다.

### Upbit/Binance 티커가 잠시 뒤 멈춤

사용자 홈의 market ticker는 브라우저 직접 WebSocket/REST 구조입니다. Upbit WSS가 유휴 상태로 일정 시간 경과 후 끊기는 경우, 클라이언트에서 keepalive ping과 idle 재연결 로직이 동작해야 합니다. 프로덕션에서 티커가 짧게 멈추는 현상은 대부분 keepalive 누락 또는 reconnect backoff 정책 부재가 원인입니다. CSP `connect-src` 화이트리스트가 `next.config.ts`에서 production 조건으로만 적용되므로, 프로덕션 빌드에서 새 소스를 추가할 때는 반드시 이 allowlist도 함께 갱신합니다. 브라우저 CORS로 직접 호출이 막히는 경우를 위해 서버 사이드 proxy(`/api/proxy/upbit/[...path]`, `/api/proxy/bitflyer/[...path]`)가 `Cache-Control: s-maxage=5, stale-while-revalidate=10` 으로 붙어 있으므로, 프런트는 proxy 경로로 fallback 할 수 있습니다.

### Google Sheets `RATE_LIMIT_EXCEEDED` / 429

Google Sheets API는 유저당 분당 60 read 쿼터가 걸려 있어, Vercel 다인스턴스에서 대시보드가 동시에 읽으면 쉽게 터집니다. Day 10에서 Upstash Redis L2 캐시(`whalescope:sheet:*`, 60s TTL) + 프로세스 로컬 L1 Map(45s TTL)로 **구조적으로** 해결했습니다.

- 1차 확인: `/api/debug/dashboard?mode=redisPing`. 200이 아니면 Redis 연결 자체가 끊긴 것이며, 이때 코드는 자동으로 graceful degrade 되어 Sheets 원본을 직접 호출합니다 — 단, 이 상태가 지속되면 429가 다시 나올 수 있으므로 Upstash 대시보드에서 연결을 먼저 복구합니다.
- 2차 확인: admin override (`upsertWatchlistOverride`) 직후에는 L1/L2가 같이 명시적 무효화되어야 정상입니다. 무효화가 누락되면 최대 60초 동안 stale 데이터가 보일 수 있습니다.
- 3차 확인: Speed Insights 또는 Vercel function logs에서 `whalescope:sheet:batch:dashboard` hit rate를 확인합니다. hit rate가 0에 가까우면 TTL이 너무 짧거나 캐시 키가 어긋났을 가능성이 있습니다.

### Telegram bot `Conflict: terminated by other getUpdates request`

Telegram Bot API long polling은 같은 bot token에 대해 한 인스턴스만 `getUpdates`를 붙잡을 수 있습니다. 이 로그가 반복되면 Render에 같은 `TELEGRAM_BOT_TOKEN`을 쓰는 bot worker가 둘 이상 떠 있거나, 재배포 직후 이전 인스턴스가 아직 종료되지 않은 상태입니다.

코드 레벨에서는 `scripts/run_bot.py`가 `drop_pending_updates=True`로 polling을 시작하고 Render 기본 SIGTERM 처리를 사용하도록 `stop_signals=None`를 제거했습니다. `WhaleScopeBot`도 error handler를 등록해 Conflict를 명확한 운영 로그로 남깁니다.

운영 조치:

1. Render에서 `python scripts/run_bot.py`를 실행하는 서비스가 정확히 1개인지 확인합니다.
2. 중복 서비스가 있으면 하나를 stop/delete 하거나 `TELEGRAM_BOT_TOKEN`을 제거합니다.
3. 남길 bot worker를 Manual Restart 합니다.
4. 공개 채널 브로드캐스트는 bot polling과 별개로 `whalescope-pipeline`의 `broadcast_periodic`/`broadcast_daily`가 담당합니다. 채널 발송이 안 되면 `/api/dashboard`의 `adminObservability.periodic` 또는 `broadcast_log`에서 `skipped_empty`, `skipped_disabled`, `dry_run`, `failed` 중 무엇인지 먼저 확인합니다.

### 대시보드 모바일 레이아웃 깨짐 / 터치 타깃 44px 미만

- `/admin` grid에서 카드가 가로로 넘치면 grid child에 `min-width: 0` 누락 혹은 `minmax(0, 1fr)` 미사용이 원인인 경우가 많습니다. Day 10 사이클에서 전체 그리드를 훑어 explicit `minmax()`로 통일했습니다.
- 차트 섹션 chip, 지갑 pill, 모달 닫기, preview/motion anchor 등 주요 터치 타깃은 WCAG 2.5.5 기준 44×44 CSS px 이상을 유지합니다. 새 인터랙션을 추가할 때는 해당 기준을 먼저 확인한 뒤 dev tools의 mobile viewport (393px)에서 실제 hit area를 검증합니다.
- SSR/CSR timezone 불일치로 날짜가 하이드레이션 경계에서 튀는 경우, `Intl.DateTimeFormat(..., { timeZone: 'Asia/Seoul' })` 로 서버·클라이언트를 동일 로케일에 고정하세요.

## 라이선스

Private. All rights reserved.
