# WhaleScope 운영 실행 검증 가이드

이 문서는 `python -m src.pipeline.run_all`을 실제 운영 모드로 실행하기 전에 확인해야 할 준비 조건, 실행 순서, 합격 기준, 장애 대응 절차를 정의한다.

대상 프로젝트는 뤼튼테크놀로지스 Product Engineer 과제 전형용 WhaleScope이며, 선택 도메인은 `C. AI 요약/큐레이션 서비스`다. 운영 실행은 온체인 API 호출, Google Sheets 쓰기, LLM API 호출, Telegram 발송까지 포함하므로 단순 테스트와 분리해서 검증해야 한다.

## 현재 기준

- 기준 브랜치: `main`
- 기준 커밋: 검증 시점의 `main` HEAD
- 실행 명령: `python -m src.pipeline.run_all`
- 대시보드 실행: `npm run dashboard:dev`
- 운영 저장소: Google Sheets
- 운영 발송 채널: Telegram Bot
- 자동 테스트 기준 명령: `pytest -q`
- 프런트 회귀 기준 명령: `npm run dashboard:e2e`

## 검증 목표

운영 실행 검증의 목적은 "명령이 종료 코드 0으로 끝나는지"만 보는 것이 아니다. 아래 조건을 모두 확인해야 한다.

| 영역 | 검증 목표 |
|---|---|
| 환경변수 | 필수 key 누락 없이 config가 로드된다. |
| Google Sheets | 탭이 존재하고 서비스 계정이 쓰기 권한을 가진다. |
| 감시 주소 | `watched_addresses`에 수집 대상 주소가 등록되어 있다. |
| 온체인 수집 | Etherscan/Solscan 수집이 timeout 없이 진행된다. |
| 선저장 | LLM 실패 전에도 `transactions`, `address_activity`가 저장된다. |
| Signal | 생성된 시그널이 있으면 `signals` 탭에 저장된다. |
| LLM 브리핑 | provider fallback을 포함해 한국어 브리핑이 생성되거나, skip/cached/fallback 사유가 별도 원장에 기록된다. |
| Telegram | 구독자가 있으면 브리핑 발송 결과가 기록되고, periodic broadcast의 skip/dedup/live 상태가 추적된다. |
| Dashboard | 실행 후 Next.js 대시보드에서 거래/시그널/브리핑을 읽을 수 있다. |
| 로그 | `system_log`, `analysis_log`에 추적 가능한 실행 기록이 남는다. |

## 사전 조건

### 1. 코드 상태

```bash
git checkout main
git pull origin main
git status --short --branch
pytest -q
```

합격 기준:

- 현재 브랜치가 `main`이다.
- working tree가 깨끗하다.
- 전체 테스트가 통과한다.

### 2. 환경변수

`.env`에 아래 값이 설정되어 있어야 한다.

필수:

| 변수 | 검증 기준 |
|---|---|
| `ETHERSCAN_API_KEY` | Etherscan API v2 호출 가능 |
| `GOOGLE_SHEET_ID` | 대상 Spreadsheet ID |
| `GOOGLE_CREDENTIALS_JSON` | 서비스 계정 JSON 전체, 한 줄 문자열 |
| `TELEGRAM_BOT_TOKEN` | BotFather 발급 token |

LLM provider는 아래 중 최소 1개가 필요하다.

| 변수 | 비고 |
|---|---|
| `ANTHROPIC_API_KEY` | 기본 provider로 사용 가능 |
| `GEMINI_API_KEY` | Anthropic 없이 fallback 가능 |
| `GROQ_API_KEY` | Anthropic/Gemini 없이 fallback 가능 |

선택:

| 변수 | 비고 |
|---|---|
| `SOLSCAN_API_KEY` | 없으면 Solana 수집은 제한될 수 있다. |
| `ENABLE_CHAIN_XRP` | XRP collector canary flag. 기본값 `false` |
| `XRPSCAN_API_BASE` | XRP contract/live 수집 base. 기본값 `https://api.xrpscan.com/api/v1` |
| `ENABLE_CHAIN_TRX` | TRX collector canary flag. 기본값 `false` |
| `TRONGRID_API_KEY` | TronGrid rate limit 완화용. contract/live 검증에서 권장 |
| `TRONGRID_API_BASE` | TRX contract/live 수집 base. 기본값 `https://api.trongrid.io` |
| `ENABLE_CHAIN_BTC` | BTC collector canary flag. 기본값 `false` |
| `BTC_INDEXER_BASE` | BTC primary contract/live 수집 base. 기본값 `https://mempool.space/api`이며, primary 실패 시 Blockchair secondary를 자동 fallback으로 사용 |
| `BTC_INDEXER_KEY` | BTC primary indexer에 별도 키가 필요할 때만 사용 |
| `ENABLE_CHAIN_DOGE` | DOGE collector canary flag. 기본값 `false` |
| `DOGE_INDEXER_BASE` | DOGE contract/live 수집 base. 기본값 `https://api.blockchair.com/dogecoin` |
| `BLOCKCHAIR_API_KEY` | Blockchair key. 현재 코드는 DOGE에 사용하고 `DOGE_INDEXER_KEY` alias도 함께 읽는다 |
| `TELETHON_API_ID` | Telegram channel listener 운영 시 필요 |
| `TELETHON_API_HASH` | Telegram channel listener 운영 시 필요 |
| `TELETHON_SESSION` | 기본값 `whalescope` |
| `TG_CHANNEL` | 예: `@whale_alert_io` |
| `STREAMLIT_PASSWORD` | 대시보드 인증용 |
| `PIPELINE_TIMEOUT_SECONDS` | Streamlit 버튼 실행 timeout, 기본 300초 |

민감정보는 터미널 출력, 문서, 커밋에 남기지 않는다.

### 3. Google Sheets 권한

서비스 계정 이메일을 대상 Spreadsheet에 `편집자` 권한으로 공유해야 한다.

초기화:

```bash
python -m scripts.init_sheets
```

감시 주소 확인:

```bash
python scripts/import_watched_addresses.py --dry-run
python scripts/import_watched_addresses.py
```

합격 기준:

- `watched_addresses` 탭에 감시 주소가 존재한다.
- `transactions`, `daily_brief`, `system_log`, `address_activity`, `signals`, `broadcast_log`, `brief_cost_ledger`, `channel_health` 탭이 존재한다.
- 초기화 명령이 예외 없이 끝난다.

### 4. 외부 연결

```bash
python scripts/test_connection.py
python scripts/smoke_llm.py
```

합격 기준:

- Etherscan 연결이 성공한다.
- Google Sheets 연결이 성공한다.
- Telegram Bot API 연결이 성공한다.
- 설정된 LLM provider 중 최소 1개가 성공한다.

주의:

- CoinGecko는 rate limit이 발생할 수 있다. 현재 파이프라인은 가격 실패를 치명 오류로 취급하지 않아야 한다.
- Anthropic key가 없어도 Gemini 또는 Groq key가 있으면 정상이다.

### 5. Live chain contract preflight

체인 collector canary 전에는 live contract test를 먼저 돌린다. contract test는 해당 base env가 없으면 skip되므로, 대상 체인의 base URL만 명시해도 된다.

대표 수동 실행:

```bash
XRPSCAN_API_BASE="${XRPSCAN_API_BASE:-https://api.xrpscan.com/api/v1}" \
TRONGRID_API_BASE="${TRONGRID_API_BASE:-https://api.trongrid.io}" \
BTC_INDEXER_BASE="${BTC_INDEXER_BASE:-https://mempool.space/api}" \
DOGE_INDEXER_BASE="${DOGE_INDEXER_BASE:-https://api.blockchair.com/dogecoin}" \
pytest -q -m contract tests/contract
```

체인별로 하나씩 볼 때는 대상 base env만 켜고 같은 명령을 재사용하면 된다. TRX는 필요 시 `TRONGRID_API_KEY`, DOGE는 필요 시 `BLOCKCHAIR_API_KEY` 또는 기존 alias `DOGE_INDEXER_KEY`를 함께 넣는다. BTC는 `BTC_INDEXER_BASE`를 mempool primary로 유지하고, primary 오류나 rate limit 상황에서는 collector가 Blockchair secondary를 자동 fallback으로 시도한다.

GitHub Actions 수동 경로:

- workflow 파일: [`../.github/workflows/chain_contract.yml`](../.github/workflows/chain_contract.yml)
- Actions UI 이름: `Chain Contract`
- 입력값: `btc_indexer_base`, `xrpscan_api_base`, `trongrid_api_base`, `doge_indexer_base`

합격 기준:

- 대상 체인의 contract test가 skip이 아니라 pass로 끝난다.
- 스키마 오류, 404, 권한 오류가 없다.

## 체인 커버리지 canary rollout

최근 확장 체인은 반드시 `XRP → TRX → BTC → DOGE` 순서로 한 체인씩 켠다. 이전 체인이 `/admin`과 시트에서 안정화되기 전에는 다음 체인을 같이 켜지 않는다.

공통 원칙:

- `config/watched_addresses.csv`에는 XRP/TRX/BTC/DOGE concrete seed가 이미 포함되어 있다.
- import 전에는 항상 `python scripts/import_watched_addresses.py --dry-run`으로 seed 목록을 확인한다.
- 실제 import는 `python scripts/import_watched_addresses.py`를 사용한다. 중복 row는 storage 레이어에서 건너뛰므로 재실행이 안전하다.
- BTC와 DOGE는 UTXO 체인이라 대표 주소 기준의 부분 관측만 먼저 제공된다. UI에 `부분 관측 · cluster 미적용` 배지가 보이면 정상 동작이다.

| 순서 | 체인 | 켤 env | 권장/선택 env | 시트/import | 최소 검증 포인트 |
|---|---|---|---|---|---|
| 1 | XRP | `ENABLE_CHAIN_XRP=true` | `XRPSCAN_API_BASE` | 기본 CSV dry-run 후 import | `transactions` 또는 `address_activity`에 `chain=XRP`가 쌓이거나, 최소한 contract test pass + `/admin`에서 XRP가 unsupported로 남지 않는다. |
| 2 | TRX | `ENABLE_CHAIN_TRX=true` | `TRONGRID_API_KEY`, `TRONGRID_API_BASE` | 기본 CSV dry-run 후 import | `chain=TRX` 이벤트가 들어오고, TRC20 활동이 있으면 `token=USDT`까지 확인한다. |
| 3 | BTC | `ENABLE_CHAIN_BTC=true` | `BTC_INDEXER_BASE`, 필요 시 `BTC_INDEXER_KEY` | 기본 CSV dry-run 후 import | `/admin` 또는 사용자 카드에서 BTC partial-view 문구가 기대대로 보이고, BTC가 unsupported로 남지 않는다. primary가 실패해도 fallback으로 전체 수집이 중단되지 않는다. |
| 4 | DOGE | `ENABLE_CHAIN_DOGE=true` | `DOGE_INDEXER_BASE`, `BLOCKCHAIR_API_KEY` 또는 `DOGE_INDEXER_KEY` alias | 기본 CSV dry-run 후 import | DOGE partial-view가 기대대로 보이고, DOGE가 unsupported로 남지 않는다. |

권장 canary 절차:

1. 대상 체인을 제외한 다른 `ENABLE_CHAIN_*` 확장 플래그는 모두 `false`로 둔다.
2. `python scripts/import_watched_addresses.py --dry-run`으로 seed가 보이는지 확인한다.
3. `python scripts/import_watched_addresses.py`로 시트에 반영한다.
4. `pytest -q -m contract tests/contract` 또는 GitHub Actions `Chain Contract` workflow로 대상 체인 endpoint 스키마를 검증한다.
5. `python -m src.pipeline.run_all` 1회를 수동 실행한다.
6. `/admin`과 Google Sheets에서 아래를 확인한다.
   - enabled chain이 chain coverage/unsupported 경고에 남아 있지 않다.
   - 활동이 있는 경우 `transactions`, `address_activity`, 필요 시 `signals`에 대상 체인이 보인다.
   - 활동이 적어도 `system_log`가 silent drop이 아니라 정상 완료 또는 `completed_empty`로 끝난다.
   - BTC/DOGE는 partial-view badge가 보이면 정상이며, cluster 미적용 한계를 숨기지 않는다.

## 단계별 검증 절차

### Step 1. 로컬 smoke

외부 API와 운영 저장소에 의존하지 않는 최소 검증이다.

```bash
python scripts/smoke_pipeline.py
```

합격 기준:

- `SMOKE OK`가 출력된다.
- fixture 이벤트가 signal로 변환된다.
- dry-run brief와 analysis log mock 저장이 성공한다.

실패 시 조치:

- 의존성 설치 상태를 먼저 확인한다.
- `pytest tests/test_main.py -q`로 파이프라인 단위 테스트를 확인한다.

### Step 2. `src.main` dry-run

운영 entrypoint 자체를 dry-run으로 검증한다.

```bash
python -m src.main --dry-run
```

합격 기준:

- fixture 이벤트를 로드한다.
- Telegram 발송과 실제 온체인 수집은 수행하지 않는다.
- 실행 결과 status가 `completed` 또는 dry-run 성공 상태로 끝난다.

실패 시 조치:

- `.env` 필수값 누락을 확인한다.
- LLM provider key가 최소 1개 있는지 확인한다.

### Step 3. 운영 실행 전 row count 기록

운영 실행은 실제 Google Sheets에 쓰기를 수행하므로 실행 전 상태를 기록한다.

확인할 탭:

- `transactions`
- `address_activity`
- `signals`
- `daily_brief`
- `analysis_log`
- `system_log`
- `subscribers`
- `brief_cost_ledger`
- `broadcast_log`
- `channel_health`

권장 기록 형식:

| 탭 | 실행 전 row count | 실행 후 row count | 기대 변화 |
|---|---:|---:|---|
| `transactions` |  |  | 최근 감시 주소 이벤트가 있으면 증가 |
| `address_activity` |  |  | 최근 감시 주소 이벤트가 있으면 증가 |
| `signals` |  |  | signal 생성 시 증가 |
| `daily_brief` |  |  | brief 생성 시 증가 |
| `analysis_log` |  |  | LLM 호출 성공 시 증가 |
| `system_log` |  |  | 매 실행마다 증가 |
| `subscribers` |  |  | 상태 변경 시 `status_changed_at` 갱신 |
| `brief_cost_ledger` |  |  | brief 실행마다 1행 증가 |
| `broadcast_log` |  |  | broadcast_daily 또는 broadcast_periodic 실행 시 증가 |
| `channel_health` |  |  | channel health 워커 실행 시 증가 |

주의:

- 최근 24시간 내 감시 주소 활동이 없으면 `transactions`와 `address_activity`가 증가하지 않을 수 있다.
- 이 경우 `system_log`에 `completed_empty`가 남는 것이 정상이다.

### Step 4. 운영 1회 실행

운영 실행은 아래 명령으로 수행한다.

```bash
python -m src.pipeline.run_all
```

대시보드는 별도 터미널에서 실행해 결과를 확인한다.

```bash
npm run dashboard:dev
```

합격 기준:

- 실행이 timeout 없이 종료된다.
- `system_log`에 run 결과가 기록된다.
- 수집 이벤트가 있으면 `transactions`와 `address_activity`가 먼저 저장된다.
- LLM 실패 또는 rate limit이 있어도 원천 수집 데이터가 남는다.

부분 합격:

- Stage 8 이후 LLM 또는 Telegram 발송이 실패해도 `transactions`, `address_activity`, `system_log`가 남으면 수집/저장 경로는 정상이다.
- `signals`가 0건이어도 rule 조건에 맞는 이벤트가 없으면 정상일 수 있다.

실패 시 조치:

- `CoinGecko rate limited (429)`는 치명 오류가 아니다. 같은 심볼 반복 실패가 negative cache로 줄어드는지 확인한다.
- Etherscan timeout이 반복되면 감시 주소 수, chain scope, `max_pages`, concurrency 설계를 재검토한다.
- Google Sheets `RemoteDisconnected`는 read/write 재시도 대상이다. 대시보드는 warning과 empty state로 살아 있어야 한다.

### Step 5. 실행 후 Google Sheets 검증

운영 실행 후 아래를 확인한다.

| 탭 | 확인 내용 |
|---|---|
| `system_log` | 최신 run의 `status`, `errors`, `details` |
| `transactions` | `raw_response_hash`, `hash`, `timestamp`, `symbol`, `amount_usd` |
| `address_activity` | `tx_hash`, `watched_address`, `direction`, `counterparty_category` |
| `signals` | `signal_id`, `rule`, `severity`, `score`, `summary` |
| `daily_brief` | `date`, `summary`, `top_transactions`, `alert_count` |
| `analysis_log` | `task`, `model_id`, `tokens_in`, `tokens_out`, `latency_ms` |
| `subscribers` | `chat_id`, `status`, `status_changed_at`, `updated_at` |
| `brief_cost_ledger` | `slot_key`, `decision`, `llm_called`, `cost_usd`, `input_fingerprint`, `reason` |
| `broadcast_log` | `kind`, `status`, `message_length`, `content_hash`, `slot_key`, `delivery_mode` |
| `channel_health` | `chat_id`, `username`, `member_count`, `status`, `error` |

합격 기준:

- `system_log` 최신 row가 이번 실행과 연결된다.
- 이벤트가 수집된 경우 `transactions`와 `address_activity`가 증가한다.
- `raw_response_hash` 기준 중복 저장이 방지된다.
- 시그널이 생성된 경우 `signals`에 저장된다.
- 브리핑이 생성된 경우 `daily_brief`에 저장된다.
- chain canary 중이면 대상 체인이 `/admin`의 chain coverage 또는 운영 요약에서 unsupported로 남지 않는다.
- `subscribers.status_changed_at`이 상태 변경 시각 기준으로 갱신된다.
- `brief_cost_ledger`는 brief 실행 경로마다 반드시 1행 기록된다.
- `broadcast_periodic`가 비어 있거나 중복 내용이면 `broadcast_log`에 skip 사유가 남는다.
- 실제 발송 또는 dry-run 모두 `broadcast_log.message_length <= 1500` 기준을 만족한다.

### Step 6. Next.js dashboard 검증

```bash
npm run dashboard:dev
```

확인할 화면:

- `/` 사용자 홈의 브리핑, 시장 티커, 뉴스, Telegram CTA
- `/admin` 운영 대시보드의 거래/시그널/로그/상태 카드

합격 기준:

- Google Sheets 연결 실패가 앱 전체 traceback으로 노출되지 않는다.
- 거래가 있으면 `/admin` 최근 거래 영역에 표시된다.
- 시그널이 있으면 `/admin` 또는 사용자 홈 시그널 카드에 `rule`, `severity`, `score`, `source`, `summary`가 표시된다.
- BTC/DOGE 카드가 보일 때 `부분 관측 · cluster 미적용` 배지는 정상 동작으로 본다.
- 데이터가 없으면 empty state 문구가 표시된다.
- 사용자 홈의 Telegram CTA가 공개 채널 링크/QR을 정상 표시한다.

### Step 7. Telegram bot 명령 검증

Telegram 명령 처리용 long polling은 별도 프로세스다.

```bash
python scripts/run_bot.py
```

Telegram 앱에서 확인:

| 입력 | 기대 응답 |
|---|---|
| `안녕` | `/start`, `/watchlist`, `/pause`, `/status`, `/help` 안내 |
| `/help` | 사용 가능한 명령 안내 |
| `/start` | 구독 등록 또는 재활성화 |
| `/watchlist ETH BTC SOL` | 관심 코인 설정 |
| `/status` | 현재 구독 상태 |
| `/pause` | 알림 일시중지 |

합격 기준:

- 일반 텍스트가 무시되지 않는다.
- `/help`가 정상 응답한다.
- `/start` 이후 `subscribers` 탭에 row가 생성 또는 갱신된다.

주의:

- `python -m src.pipeline.run_all`은 Render production cadence를 실행하는 단일 오케스트레이터다.
- `python scripts/run_bot.py`는 사용자 명령 처리 담당이다.
- 둘은 같은 Telegram bot token을 쓰지만 역할이 다르다.

### Step 8. Telegram listener 검증

공개 고래 알림 채널 수신은 별도 long-running 프로세스다.

파서 검증:

```bash
python scripts/run_listener.py --dry-run
```

실제 수신:

```bash
TG_CHANNEL=@whale_alert_io python scripts/run_listener.py
```

합격 기준:

- 최초 Telethon 인증이 완료된다.
- 채널 메시지가 수신되면 `tg_whale_events`에 저장된다.
- 정규식 파싱 실패 시 설정된 LLM provider fallback이 동작한다.

주의:

- GitHub Actions는 long-running listener에 적합하지 않다.
- listener는 로컬, VPS, Render, Fly.io 같은 상시 실행 환경에서 운용하는 편이 맞다.

### Step 9. 관리자 관측치 검증

`/admin`에서 아래 운영 요약치를 직접 확인한다.

| 카드/지표 | 합격 기준 |
|---|---|
| 최근 24h brief 실행 횟수 | `brief_cost_ledger` 최근 24시간 합계와 일치 |
| generated / cached / skipped_inactive / skipped_budget 비율 | `brief_cost_ledger.decision` 집계와 일치 |
| 실제 LLM 호출 횟수 | `brief_cost_ledger.llm_called=true` 건수와 일치 |
| periodic 실행 횟수 | `broadcast_log.kind=broadcast_periodic` 최근 24시간 합계와 일치 |
| skipped_empty / skipped_duplicate_content 비율 | `broadcast_log.status`, `delivery_mode` 집계와 일치 |
| 최근 메시지 길이 | `broadcast_log.message_length` 최신 row와 일치 |
| 최근 brief 생성 시각 / 최근 periodic 발송 시각 | 각 원장 최신 row 시각과 일치 |
| SSE live updates 상태 | `WHALESCOPE_SSE_ENABLED`, Redis REST 구성, `service_health` 최근 시각과 정합 |
| SSE 진단 | `lastEventId`, 최근 이벤트 지연, 섹션별 revalidate 시각이 `/admin`에 표시되고, 브라우저 reconnect 안정성은 Step 10에서 별도 확인 |
| 시장 소스 진단 | `binance/upbit/bitflyer/kraken/fx/snapshot/fear_greed` 별 `transport`, `status`, `freshness`, `failureReason`이 `/admin`에 표시되고, 수동 확인 대상은 이유 문구로 바로 식별 가능 |
| Telegram 운영 요약 | 활성/일시중지/차단/비활성 구독자 수, `unsubscribe24h`, `unsubscribeRate24h`, 최근 `channel_health`, 최근 `broadcast_log` 상태가 `/admin`에 표시 |

운영자가 시트 raw row를 뒤지지 않고 `/admin`에서 바로 판정 가능해야 한다.

### Step 10. 배포 환경 수동 검증

아래 항목은 로컬 자동화가 아니라 실제 배포 환경에서 판정한다.

| 영역 | 확인 방법 | 합격 기준 |
|---|---|---|
| SSE 연결 | Vercel 배포 브라우저 DevTools Network에서 `/api/stream` 확인 | `content-type: text/event-stream` 유지 |
| UI 갱신 지연 | Render 파이프라인 수동 실행 후 10초 내 Vercel `/` 또는 `/admin` 갱신 | 최근 상태/카드가 10초 내 반영 |
| `/admin` live updates 카드 | `/admin`에서 상태/사유/poll/heartbeat/`lastEventId`/지연/revalidate 시각 확인 | 배포 환경 설정과 실제 최근 갱신 시각이 모순 없이 표시 |
| 시장 소스 카드 | `/admin`에서 `binance/upbit/bitflyer/kraken/fx/snapshot/fear_greed` 상태 확인 | 수동 확인 대상과 자동 확인 대상이 구분되어 표시 |
| Alternative.me 실값 | 공개 지수 페이지와 `/admin`·사용자 홈의 게이지 비교 | 숫자/분류가 동일 |
| Bitflyer / Kraken 값 | Vercel 사용자 홈 시장 티커와 `/admin` 진단 카드 확인 | 지연 시 stale/fallback 설명이 정합 |
| Telegram shadow/live | Telegram 채널과 `broadcast_log`, `channel_health`, `/admin` Telegram 카드 비교 | shadow 기간 실패 없음, live 전환 후 단일 채널 도착 확인 |
| 장시간 연결 | 30분 유지 후 Vercel 브라우저와 Render 로그 동시 관찰 | listener/SSE 모두 crash 없이 재연결 |

### Step 10.5. 잔여 체크리스트 판정 매트릭스

아래 표는 "코드가 미완료인지"와 "배포 관측만 남았는지"를 혼동하지 않기 위한 기준이다.

| 마일스톤 | 항목 | 로컬 증빙 | 배포 관측 위치 | 닫힘 기준 |
|---|---|---|---|---|
| M1 | Fear & Greed fallback, reduced motion, ko/en aria-label | `npm run dashboard:e2e -- tests/e2e/dashboard-accessibility.spec.tsx` | 배포 브라우저, 스크린리더 | 로컬 spec 통과 후, 배포 브라우저에서 실제 읽기와 값 일치 확인 |
| M1 | CURATED_NOTE_POOL 21개 도달 가능성 | `npm run dashboard:e2e -- tests/e2e/dashboard-curated-watchlist.spec.ts` | 운영 로그 또는 별도 관찰 기록 | 로컬 reachability 확인 후, 실제 1주 운영 분포 관측 |
| M1 | Binance/Upbit/Bitflyer/Kraken live 상태와 가격 갱신 | 없음. 로컬은 `/admin` 진단 문구와 카드 렌더까지만 본다. | Vercel 사용자 홈, `/admin`, 브라우저 console/network | 네 소스 상태와 Bitflyer/Kraken 가격 갱신이 배포 환경에서 확인 |
| M1 | Alternative.me 실값 일치 | 로컬에서는 실패 주입과 fallback만 검증 | 사용자 홈, `/admin`, Alternative.me 공개 페이지 | 사용자 홈 게이지 값/분류가 원본과 일치 |
| M3 | SSE payload 메타데이터, disabled reason, refresh/reconnect 로직 | `npm run dashboard:e2e -- tests/e2e/dashboard-live-updates.spec.tsx` | Vercel DevTools, `/admin`, Upstash console | `event-stream`, 10초 내 반영, 30분 안정성, Upstash 사용량 확인 |
| M4 | brief / periodic cadence 슬롯 로직 | `pytest tests/test_run_all.py -q` | Render logs, Google Sheets, `/admin` | 실제 시간대 실행과 `/admin` 집계가 일치 |
| M4 | brief ledger/skip/budget 경로 | `pytest tests/test_brief_fallback.py -q` | Google Sheets `brief_cost_ledger`, `/admin` | 24h decision 비율과 `llm_called` count 관측 가능 |
| M4 | periodic dedup / empty skip / 1500자 cap | `pytest tests/test_broadcast_periodic.py -q` | Google Sheets `broadcast_log`, Telegram channel, `/admin` | 15분 cadence, skip 비율, 1500자 cap, 실제 채널 도착 확인 |
| M4 | Telegram churn 집계 | `pytest tests/test_storage.py -q tests/test_distributor.py -q` | Google Sheets `subscribers`, `/admin` Telegram 카드 | `status_changed_at` 기준 `unsubscribe24h` / `unsubscribeRate24h`가 운영값과 일치 |

원칙:

- 로컬 테스트로 닫히는 항목은 코드/QA 완료로 본다.
- 24시간/7일 추세, 브라우저 네트워크, 실제 Telegram 도착, 실시간 외부 API 값 일치는 배포 관측 없이는 닫지 않는다.
- `/admin` 카드가 보여주는 값과 원장 시트(`brief_cost_ledger`, `broadcast_log`, `channel_health`, `subscribers`)가 다르면 배포 관측 실패로 본다.

현재 기준, 코드/로컬 QA 후에도 배포 전용으로 남는 항목:

- M1: Binance/Upbit/Bitflyer/Kraken 칩 실제 live 상태
- M1: Bitflyer BTC_JPY / Kraken XBT/USD 30초 내 갱신
- M1: CURATED_NOTE_POOL 21개 실제 운영 분포 1주 관측
- M1: Alternative.me 실값과 사용자 홈 게이지 값 일치
- M1: 스크린리더 실제 낭독 품질
- M3: DevTools `event-stream` 확인
- M3: 파이프라인 완료 후 10초 내 revalidate 반영
- M3: Upstash Redis 사용량 일 100 command 이하
- M3: 30분 연결 안정성
- M4: brief 시간당 실행과 평균 skip rate 40%+
- M4: 실제 `llm_called=true` 일 평균 8~10회
- M4: `broadcast_periodic` 15분 cadence와 빈 슬롯 skip률 50%+
- M4: `@whalescope_alertz` 실제 채널 도착과 1500자 초과 없음
- M4: 24h 구독 해지율 `< 5%`

## 운영 실행 판정 기준

### 통과

아래 조건을 만족하면 운영 1회 실행 검증 통과로 본다.

- `pytest -q` 통과
- `python scripts/test_connection.py`에서 필수 외부 연결 통과
- `python -m src.main --dry-run` 통과
- `python -m src.pipeline.run_all` 실행 후 `system_log` 기록 생성
- 이벤트가 수집된 경우 `transactions`와 `address_activity` 저장 확인
- `brief_cost_ledger`에 이번 brief 경로가 기록됨
- `broadcast_log`에 periodic/daily broadcast 상태가 기록됨
- 대시보드가 traceback 없이 렌더링
- Telegram bot long polling 상태에서 일반 텍스트와 `/help` 응답 확인

### 조건부 통과

아래는 서비스 구조상 허용 가능한 조건부 통과다.

- 최근 24시간 감시 주소 활동이 없어 `completed_empty`가 기록된다.
- signal rule 조건을 만족하지 않아 `signals`가 0건이다.
- Telegram active subscriber가 없어 `sent=0`이다.
- CoinGecko rate limit으로 일부 `amount_usd`가 unknown이다.

### 실패

아래는 운영 검증 실패로 본다.

- config load 단계에서 필수 환경변수 오류 발생
- Google Sheets 초기화 또는 쓰기 권한 오류 발생
- Etherscan 수집이 반복적으로 timeout되어 Stage 3을 통과하지 못함
- 수집 이벤트가 있는데도 `transactions`와 `address_activity`가 저장되지 않음
- 대시보드가 Sheets 오류를 traceback으로 노출하며 중단됨
- Telegram bot long polling 상태에서도 일반 텍스트와 `/help`가 응답하지 않음

## 장애 대응 체크리스트

### Google Sheets read/write 실패

증상:

- `RemoteDisconnected`
- `gspread.exceptions.APIError`
- 권한 오류

대응:

- 서비스 계정 이메일이 Spreadsheet에 편집자로 공유되어 있는지 확인한다.
- `GOOGLE_CREDENTIALS_JSON`이 올바른 한 줄 JSON인지 확인한다.
- API quota 일시 초과면 재시도한다.
- 대시보드에서는 traceback 대신 warning + empty state가 떠야 한다.

### Etherscan 수집 지연

증상:

- Stage 3에서 오래 멈춘 것처럼 보임
- 전체 실행 timeout

대응:

- `getblocknobytime` 기반 startblock이 적용되는지 확인한다.
- 주소 수와 chain scope를 줄여 1회 실행 시간을 측정한다.
- 오래 걸리는 주소를 별도 로그로 분리한다.
- 장기적으로 concurrency 2-3, 주소별 timeout, run progress log를 추가한다.

### LLM provider 실패

증상:

- Anthropic key 없음
- provider timeout
- rate limit

대응:

- Gemini 또는 Groq fallback key를 설정한다.
- `python scripts/smoke_llm.py`로 provider별 상태를 확인한다.
- brief 생성 실패가 원천 데이터 저장 실패로 이어지지 않는지 확인한다.

### Telegram 무응답

증상:

- Telegram으로 인사를 보내도 답이 없음

대응:

- `python scripts/run_bot.py`가 실행 중인지 확인한다.
- `getUpdates` pending update가 쌓이는지 확인한다.
- `/help`와 일반 텍스트 handler가 등록되어 있는지 확인한다.
- webhook이 설정되어 있다면 long polling과 충돌할 수 있으므로 상태를 확인한다.

## 운영 실행 기록 템플릿

실제 운영 실행 후 아래 형식으로 기록한다.

```markdown
## 운영 실행 기록

- 실행일:
- 실행자:
- branch/commit:
- 실행 방식: CLI / Streamlit button / GitHub Actions
- 명령:
- 시작 시각:
- 종료 시각:
- 종료 상태:
- 실행 시간:

### 사전 row count

| 탭 | rows |
|---|---:|
| transactions |  |
| address_activity |  |
| signals |  |
| daily_brief |  |
| analysis_log |  |
| system_log |  |
| brief_cost_ledger |  |
| broadcast_log |  |
| channel_health |  |

### 사후 row count

| 탭 | rows |
|---|---:|
| transactions |  |
| address_activity |  |
| signals |  |
| daily_brief |  |
| analysis_log |  |
| system_log |  |
| brief_cost_ledger |  |
| broadcast_log |  |
| channel_health |  |

### 관찰 로그

- Stage 3 수집 결과:
- Stage 5 signal 수:
- Stage 8 brief 생성 여부:
- Stage 9 관리자 관측치 확인:
- Stage 10 Telegram 발송 결과:
- errors:

### 판정

- 통과 / 조건부 통과 / 실패
- 근거:
- 후속 조치:
```

## 다음 개선 권장 순서

운영 실행 검증을 더 안정적으로 만들기 위한 우선순위는 다음과 같다.

1. `pipeline_runs` 또는 `system_log` 확장으로 stage별 elapsed/count를 저장한다.
2. Etherscan 주소별 진행률 로그와 timeout을 추가한다.
3. Streamlit 버튼 실행에 중복 실행 lock을 추가한다.
4. Google Sheets read/write retry와 마지막 정상 snapshot cache를 추가한다.
5. GitHub Actions 수동 실행 결과를 README 또는 Obsidian 실행 기록에 연결한다.
6. Vercel 전환 시 Streamlit 버튼 구조를 API route + external worker trigger로 대체한다.
