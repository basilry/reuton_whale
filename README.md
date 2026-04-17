# WhaleScope

Wrtn Technologies Product Engineer 과제 전형용 프로젝트입니다. 선택 도메인은 `C. AI 요약/큐레이션 서비스`이며, 온체인 고래 지갑 모니터링, 규칙 기반 시그널 탐지, LLM 한국어 해설, Telegram 브리핑을 하나로 묶은 크립토 고래 큐레이션 서비스입니다.

> 본 서비스는 투자 조언을 제공하지 않습니다. 모든 브리핑은 참고 목적이며, 투자 판단과 책임은 사용자에게 있습니다.

> 배포 URL은 현재 없습니다. 이 저장소와 로컬 실행 경로를 기준으로 평가할 수 있게 구성했습니다.

## Dashboard Split

이번 대시보드는 운영자용 화면과 사용자용 화면으로 분리해서 봅니다.

- `/`는 운영/관리 대시보드입니다. 정보수집 worker, Telegram worker, Google Sheets 적재 상태, 최신 브리핑, 시스템 상태를 확인하는 용도입니다.
- `/insights`는 사용자용 인사이트 대시보드입니다. 사람이 읽을 수 있는 브리핑과 시그널 해설을 중심으로 보는 화면입니다.
- 디자인 기준은 `docs/demo_pic/admin_dashboard.html`과 `docs/demo_pic/user_dashboard.html`을 참고해 맞췄습니다. 이 HTML은 구현 참고용 디자인 레퍼런스이며 런타임 자산은 아닙니다.

## 내가 실제로 실행해야 할 것들

WhaleScope는 하나의 서버만 켜는 앱이 아니라, 데이터 적재 worker와 사용자 접점, 대시보드를 분리해서 운영합니다. 실제 실행 단위는 아래 기준으로 보면 됩니다.

| 실행 단위 | 로컬 명령 | 배포 위치 | 역할 | 항상 실행 여부 |
|---|---|---|---|---|
| 초기 Sheets 세팅 | `python -m scripts.init_sheets` | 로컬 1회 실행 | Google Sheets 탭/헤더 생성 | 최초 1회 |
| 감시 주소 등록 | `python scripts/import_watched_addresses.py` | 로컬 1회 실행 | `watched_addresses` 시트에 기본 감시 주소 upsert | 최초 1회, CSV 변경 시 |
| 정보수집 파이프라인 worker | `python -m src.main` | Render Cron Job 또는 Worker | 온체인/TG 데이터 수집, 시그널 생성, LLM 브리핑 생성, Sheets 저장, Telegram 브리핑 발송 | 주기 실행 |
| Telegram bot worker | `python scripts/run_bot.py` | Render Background Worker | `/start`, `/watchlist`, `/pause`, `/status` 같은 사용자 명령 처리 | 상시 실행 |
| Telegram listener worker | `TG_CHANNEL=@whale_alert_io python scripts/run_listener.py` | Render Background Worker | 공개 고래 알림 채널을 수신해 `tg_whale_events`에 저장하고 `system_log`에 listener heartbeat 기록 | 상시 실행 |
| Next.js 운영 대시보드(`/`) | `npm run dashboard:dev` | Vercel | Google Sheets 데이터를 읽어 운영 화면/API 제공. listener 상태는 Sheets 연결 여부가 아니라 `telethon_listener` heartbeat 우선, `tg_whale_events` 최신 기록 보조 기준으로 표시 | 화면 확인 시 또는 Vercel 상시 배포 |
| Next.js 인사이트 대시보드(`/insights`) | `npm run dashboard:dev` | Vercel | 사용자용 브리핑/인사이트 화면 제공 | 화면 확인 시 또는 Vercel 상시 배포 |
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
python -m src.main

npm install
npm run dashboard:dev
```

별도 터미널에서 상시 worker를 확인하려면 아래 두 프로세스를 각각 실행합니다.

```bash
python scripts/run_bot.py
TG_CHANNEL=@whale_alert_io python scripts/run_listener.py
```

주의할 점:

- `GOOGLE_SHEET_ID`, `GOOGLE_CREDENTIALS_JSON`, `TELEGRAM_BOT_TOKEN`, `ETHERSCAN_API_KEY`, LLM provider key 중 1개는 실제 실행에 필요합니다.
- `GOOGLE_CREDENTIALS_JSON`은 JSON 문자열이므로 `source .env`로 주입하지 마세요. Python은 `.env`를 직접 읽고, Next.js dashboard는 `apps/dashboard/.env.local` 또는 루트 `.env`를 server-side에서 직접 읽습니다.
- 운영자용 dashboard/API 인증은 `Authorization: Bearer <password>`를 권장합니다. `x-dashboard-password`는 로컬에서 curl로 빠르게 확인하거나 수동 검증할 때 쓰는 보조 헤더로 남겨두었습니다.
- 대시보드가 비어 있으면 대시보드 문제가 아니라 먼저 `python -m src.main`이 Sheets에 `transactions`, `signals`, `daily_brief`, `system_log`를 쌓았는지 확인합니다.

## 과제 요약

- One Pager와 동작하는 구현체를 하나의 Git repo에 담는 과제 전형입니다.
- 평가 초점은 문제 정의, AI 활용 방식, 실행 가능성, 문서화, 코드 품질입니다.
- 실제 데모 경로는 LLM API 기반 실행을 우선으로 두고, smoke는 API 키/외부 의존성 부재 시 fallback으로 남깁니다.

One Pager: [docs/one-pager.md](docs/one-pager.md)

Next.js Dashboard 개발 계획: [docs/nextjs-dashboard-development-plan.md](docs/nextjs-dashboard-development-plan.md)

## Next.js 대시보드

`apps/dashboard`는 Vercel 배포용 Next.js App Router 대시보드입니다. 현재 구현은 Google Sheets를 읽기 전용 데이터 소스로 사용해 거래, 시그널, 일일 브리핑, 시스템 로그를 보여줍니다. 앱 단독 실행 안내는 [apps/dashboard/README.md](apps/dashboard/README.md), 배포 설계는 [docs/nextjs-dashboard-development-plan.md](docs/nextjs-dashboard-development-plan.md)를 기준으로 봅니다.

로컬 개발과 빌드는 루트 워크스페이스 명령으로 실행합니다. dashboard는 `apps/dashboard/.env.local`을 우선 읽고, 없으면 로컬 편의를 위해 repo 루트 `.env`도 fallback으로 읽습니다. `GOOGLE_CREDENTIALS_JSON`은 JSON 문자열이므로 shell에서 `source`하지 마세요.

```bash
npm install
npm run dashboard:dev
npm run dashboard:build
```

루트 `.env`를 쓰지 않고 dashboard 전용 env를 분리하려면 아래처럼 생성합니다.

```bash
cp apps/dashboard/.env.example apps/dashboard/.env.local
```

현재 dashboard API는 다음 route handler로 제공됩니다.

| Endpoint | 설명 |
|---|---|
| `/api/dashboard` | 지표, 최신 브리핑, 최근 거래, 최근 시그널, 시스템 로그 통합 snapshot |
| `/api/transactions?limit=20` | 최근 거래 목록 |
| `/api/signals?limit=20` | 최근 규칙 기반 시그널 목록 |
| `/api/system-log?limit=25` | 최근 pipeline/system log 목록 |

배포 기준은 다음과 같습니다.

- Vercel 프로젝트의 Root Directory는 `apps/dashboard`로 설정합니다.
- `GOOGLE_CREDENTIALS_JSON`, `GOOGLE_SHEET_ID`는 현재 dashboard 필수 server-only secret입니다.
- `DASHBOARD_PASSWORD`를 설정하면 `/api/dashboard`, `/api/transactions`, `/api/signals`, `/api/system-log` 운영 API에 인증이 적용됩니다. 운영 환경에서는 `Authorization: Bearer <password>`를 권장하고, `x-dashboard-password`는 로컬/수동 확인 편의용으로만 남겨두었습니다.
- `RENDER_PIPELINE_WEBHOOK_URL`, `RENDER_PIPELINE_WEBHOOK_SECRET`는 실행 트리거 확장용 reserved server-only secret입니다.
- `NEXT_PUBLIC_`에는 공개 가능한 표시용 값만 둡니다.
- Render는 `python -m src.main`, `python scripts/run_bot.py`, `TG_CHANNEL=@whale_alert_io python scripts/run_listener.py`를 각각 독립 worker로 운영합니다.
- 정보수집, Telegram bot, Telegram listener를 하나의 프로세스로 합치지 않습니다.
- 운영 대시보드의 Telegram listener 카드는 Google Sheets 연결 성공만으로 정상 처리하지 않습니다. `system_log`의 `run_type=telethon_listener` heartbeat를 우선 읽고, heartbeat가 없을 때만 `tg_whale_events` 최신 수집 시각을 보조 기준으로 삼아 `정상`, `대기 중`, `인증 필요`, `확인 필요`를 표시합니다.

권장 배포 구조:

| 구성요소 | Runtime | 역할 |
|---|---|---|
| 정보수집 파이프라인 | Render Cron Job 또는 Worker | 온체인/TG 이벤트 수집, 시그널 생성, LLM 브리핑 생성, Sheets 저장 |
| Telegram bot | Render Worker | `/start`, `/watchlist`, `/pause`, `/status` 등 사용자 명령 처리 |
| Telegram listener | Render Worker | 공개 고래 알림 채널 수신 후 `tg_whale_events` 저장, `system_log`에 listener heartbeat 기록 |
| Dashboard | Vercel | Google Sheets 읽기 전용 운영 화면 |
| Legacy dashboard | Local Streamlit | 로컬 진단용 보조 UI |

## 현재 상태

- Whale Alert 유료 API 의존을 제거하고 Etherscan, Solscan, 공개 Telegram 채널 수신 기반 구조로 전환했습니다.
- `SignalEngine`이 8개 규칙으로 시그널을 만들고, 시그널이 있을 때는 레거시 `TransactionScorer` 경로를 건너뜁니다.
- LLM 호출은 자체 `LLMRouter`가 Anthropic, Gemini, Groq provider를 preferred/fallback 방식으로 라우팅합니다.
- Google Sheets는 MVP 영구 저장소로 사용하며 `Storage` Protocol을 통해 이후 SQLite/Postgres 전환 여지를 둡니다.
- Telegram 발송은 429, timeout, network error에 대해 재시도하며, 구독자별 관심 규칙 기반 개인화를 지원합니다.
- 로컬 기준 검증 결과: `pytest -q` 298 passed, `python scripts/smoke_pipeline.py` SMOKE OK.

## 아키텍처

```text
[소스 수집]                         [정규화]             [시그널]                 [해설/배포]

Etherscan API v2  ----+
  ETH/ARB/BASE/BSC/  |
  POLYGON             |
                       +--> Event(dataclass) --> SignalEngine(8 rules) --> LLMAnalyzer --> Telegram Bot
Solscan API v2   -----+                         |                        via LLMRouter    Google Sheets
  SOL                                           |                        Anthropic/
                                                |                        Gemini/Groq
Telethon listener ----+                         |
  public TG channel   +--> tg_whale_events -----+

watched_addresses.csv --> watched_addresses sheet --> collector address scope
address_activity sheet --> baseline builder --> 3-sigma anomaly rules
user_interests sheet --> per-subscriber personalize --> Telegram message variant
```

핵심 실행 흐름:

1. 감시 주소 목록을 Google Sheets에서 읽습니다.
2. Etherscan/Solscan이 감시 주소의 최근 활동을 수집합니다.
3. Telethon listener가 공개 고래 알림 채널 메시지를 별도 수집합니다.
4. 수집 이벤트를 `Event`로 정규화합니다.
5. `SignalEngine`이 규칙 기반 시그널과 교차검증 시그널을 만듭니다.
6. 과거 `address_activity`를 기반으로 baseline을 계산해 spike rule에 주입합니다.
7. `LLMAnalyzer`가 시그널 목록을 한국어 브리핑으로 변환합니다.
8. Telegram Bot이 구독자별 관심 규칙을 반영해 메시지를 발송합니다.
9. 거래, 시그널, 브리핑, 시스템 로그를 Google Sheets에 저장합니다.

## 기술 스택

| 분류 | 기술 | 용도 |
|---|---|---|
| 언어 | Python 3.11+ | 코어 런타임 |
| LLM | Anthropic, Gemini, Groq | 시그널 해석, 브리핑 생성, 파싱 fallback |
| 라우팅 | `src/llm/router.py` | provider preferred/fallback 라우팅 |
| 온체인 수집 | Etherscan API v2 | ETH, ARB, BASE, BSC, POLYGON |
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
python -m src.main

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
python -m src.main
```

- `daily_brief` 시트에 일일 브리핑이 저장됩니다.
- Telegram bot이 연결되어 있으면 브리핑이 발송됩니다.
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
| `TELETHON_API_ID` | Telegram user API ID입니다. listener 실제 실행에 필요합니다. |
| `TELETHON_API_HASH` | Telegram user API hash입니다. listener 실제 실행에 필요합니다. |
| `TELETHON_SESSION` | Telethon session 이름입니다. 기본값은 `whalescope`입니다. |
| `TELETHON_PHONE` | 최초 로컬 로그인용 전화번호입니다. 반드시 국가번호 포함 국제 형식으로 입력합니다. 예: `+821012345678`. |
| `TELETHON_SESSION_STRING` | Render 같은 비대화형 worker에서 사용할 Telethon StringSession입니다. 설정하면 파일 기반 session 대신 이 값을 사용합니다. |
| `TG_CHANNEL` | 수신할 공개 채널입니다. 예: `@whale_alert_io`. |
| `STREAMLIT_PASSWORD` | Streamlit 대시보드 비밀번호입니다. 비우면 인증이 비활성화됩니다. |
| `DASHBOARD_PASSWORD` | Next.js 운영자 API 비밀번호입니다. 운영 환경에서는 `Authorization: Bearer <password>`를 권장하고, `x-dashboard-password`는 로컬/수동 확인 편의용입니다. |

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

먼저 dry-run으로 확인합니다.

```bash
python scripts/import_watched_addresses.py --dry-run
```

문제가 없으면 Sheets에 upsert합니다.

```bash
python scripts/import_watched_addresses.py
```

다른 CSV를 쓰려면 헤더를 `config/watched_addresses.csv`와 맞춘 뒤 `--csv`를 지정합니다.

```bash
python scripts/import_watched_addresses.py --csv path/to/watched_addresses.csv
```

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

온체인 수집, 시그널 생성, LLM 브리핑 생성, Sheets 저장, Telegram 발송까지 실행합니다.

```bash
python -m src.main
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
- LLM provider key 중 최소 1개 설정. 정규식 파싱 실패 시 LLM fallback에 사용합니다.

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

주의: `run_bot.py`는 명령 처리용 long-polling 프로세스입니다. 일일 브리핑 발송은 Render pipeline의 `python -m src.main` 또는 선택적 GitHub Actions daily workflow에서 수행합니다.

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
| `whalescope-pipeline` | Cron Job 또는 Worker | `python -m src.main` | 온체인 수집, 시그널 생성, LLM 브리핑, Sheets 저장, 브리핑 발송 |
| `whalescope-bot` | Background Worker | `python scripts/run_bot.py` | Telegram 사용자 명령 처리 |
| `whalescope-listener` | Background Worker | `TG_CHANNEL=@whale_alert_io python scripts/run_listener.py` | 공개 Telegram 채널 이벤트 수신 |

Render에는 `.env.example`의 Python backend 값을 등록합니다. 최소 필수값은 `ETHERSCAN_API_KEY`, `GOOGLE_SHEET_ID`, `GOOGLE_CREDENTIALS_JSON`, `TELEGRAM_BOT_TOKEN`, 그리고 LLM provider key 중 1개입니다. listener를 켜려면 `TELETHON_API_ID`, `TELETHON_API_HASH`, `TELETHON_SESSION`, `TG_CHANNEL`도 필요합니다.

### Vercel dashboard

| Setting | Value |
|---|---|
| Root Directory | `apps/dashboard` |
| Install Command | `npm install` |
| Build Command | `npm run build` |

Vercel에는 dashboard server-only env만 등록합니다.

| Variable | 설명 |
|---|---|
| `GOOGLE_SHEET_ID` | Google Spreadsheet ID |
| `GOOGLE_CREDENTIALS_JSON` | Google service account JSON |
| `NEXT_PUBLIC_APP_NAME` | 선택 표시값 |

대시보드는 읽기 전용입니다. 데이터가 비어 있으면 Vercel 문제가 아니라 Render pipeline 또는 Google Sheets 데이터 적재 상태를 먼저 확인합니다.

## GitHub Actions

GitHub Actions는 선택적 스케줄러/백업 경로입니다. 현재 권장 production 경로는 Render worker와 Vercel dashboard입니다.

### Daily Whale Brief

파일: [.github/workflows/daily_brief.yml](.github/workflows/daily_brief.yml)

- 실행 시각: 매일 UTC 23:00, KST 08:00
- 수동 실행: GitHub Actions `workflow_dispatch`
- 실행 명령: `python -m src.main`
- concurrency group: `daily-brief`

### Weekly Trend Commentary

파일: [.github/workflows/weekly_trend.yml](.github/workflows/weekly_trend.yml)

- 실행 시각: 매주 월요일 UTC 23:00, KST 화요일 08:00
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
| `GOOGLE_SHEET_ID` | 필수 | Spreadsheet ID |
| `GOOGLE_CREDENTIALS_JSON` | 필수 | 서비스 계정 JSON 전체 |
| `TELEGRAM_BOT_TOKEN` | 필수 | Telegram bot token |
| `DASHBOARD_PASSWORD` | 권장 | Vercel 운영자 API 접근 비밀번호. 운영 환경은 Bearer 인증 권장, `x-dashboard-password`는 로컬/수동 확인용 |

Telethon listener는 GitHub Actions에서 상시 실행하기 어렵기 때문에 별도 runtime에 배포하는 것을 권장합니다.

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
│   ├── telegram_bot.py        # command handlers, send retry, personalization
│   └── formatters.py
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
└── watched_addresses.csv      # 80개 감시 주소 시드

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

## 테스트

전체 테스트:

```bash
pytest -q
```

현재 로컬 기준:

```text
298 passed
```

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
- `pytest-asyncio`가 필요하므로 `pip install -r requirements.txt`를 사용하세요.

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
10. `python -m src.main`
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

## 라이선스

Private. All rights reserved.
