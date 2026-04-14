# WhaleScope

온체인 고래 지갑 모니터링 + 규칙 기반 시그널 탐지 + LLM 분석 → 텔레그램 한국어 브리핑.

> 본 서비스는 투자 조언을 제공하지 않습니다. 모든 브리핑은 참고 목적이며 투자 결정은 본인 책임입니다.

---

## 아키텍처

```
[온체인 수집]                [시그널 탐지]          [LLM 분석]          [저장 & 배포]
                                                                        
Etherscan API --+                                                       
 (ETH/ARB/BASE  |   normalizer  --> SignalEngine --> LLMAnalyzer ----+-> Telegram Bot
  BSC/POLYGON)  |                     (8 rules)   (LLMRouter:        |   (일일 브리핑)
                +-> Event list                     Anthropic/         |
Solscan API  ---+   (dataclass)  --> personalize   Gemini/Groq)      +-> Google Sheets
 (SOL)                                (interests)                    |   (signals, brief,
                                                                     |    activity, log)
Telethon -------+   parse_tg_message                                 |
 (TG channel)   |   (regex + LLM  -> tg_whale_events             +-> Streamlit
                |    fallback)                                    |   (대시보드)
                +----------------------------------------------> |
                                                                 |
watched_addresses.csv ---> registry.load_watched() -----------> +
```

**핵심 흐름**: 수집 → normalizer → SignalEngine.run → personalize → LLMAnalyzer.generate_daily_brief → Telegram

---

## 기술 스택

| 분류 | 기술 | 용도 |
|------|------|------|
| 언어 | Python 3.11 | 코어 런타임 |
| AI | LLMRouter (Anthropic/Gemini/Groq) | 시그널 분석 + 브리핑 생성 |
| 온체인 수집 | Etherscan API v2 | ETH/ARB/BASE/BSC/POLYGON |
| 온체인 수집 | Solscan API v2 | Solana |
| TG 수신 | Telethon | 고래 알림 채널 실시간 수신 |
| 시장 데이터 | CoinGecko API | 실시간 가격 보강 |
| 저장소 | Google Sheets (gspread) | 영구 데이터 저장 |
| 배포 | Telegram Bot API (python-telegram-bot) | 사용자 브리핑 전달 |
| 대시보드 | Streamlit | 웹 기반 모니터링 UI |
| CI/CD | GitHub Actions | 자동 일일 + 주간 파이프라인 |
| 테스트 | pytest | 단위/통합 테스트 (210+) |

---

## 데이터 처리 안내 (Data Processing Notice)

본 서비스는 아래 데이터를 처리합니다:

| 데이터 종류 | 출처 | 처리 목적 |
|------------|------|----------|
| 온체인 트랜잭션 | Etherscan / Solscan 공개 API | 고래 거래 감지 및 시그널 생성 |
| 텔레그램 공개 채널 메시지 | Telethon (공개 채널 구독) | 고래 이벤트 파싱 |
| 텔레그램 사용자 정보 | 텔레그램 봇 `/start` 명령 | 브리핑 구독 관리 |

**PII (개인식별정보)**: 텔레그램 `chat_id`와 `username`만 저장하며, 이 외 개인정보는 수집하지 않습니다.

**LLM 공급자**: 브리핑 생성 시 Anthropic / Google Gemini / Groq 중 하나 이상의 API를 통해 처리됩니다. 각 공급자의 데이터 처리 정책을 확인하세요.

**온체인 데이터**: 공개 블록체인 데이터이며 사용자 동의 없이도 공개적으로 열람 가능합니다.

---

## 설치

```bash
pip install -r requirements.txt
cp .env.example .env
# .env 파일에 필요한 키 입력 (아래 환경변수 목록 참조)
```

### 필요 환경변수

```
# 온체인 수집
ETHERSCAN_API_KEY=
SOLSCAN_API_KEY=          # optional (Solana)

# LLM 라우터 (최소 1개 필수)
ANTHROPIC_API_KEY=
GEMINI_API_KEY=           # optional fallback
GROQ_API_KEY=             # optional fallback

# 저장소
GOOGLE_SHEET_ID=
GOOGLE_CREDENTIALS_JSON=  # 서비스 계정 JSON 한 줄 (값 전체)

# 텔레그램 봇
TELEGRAM_BOT_TOKEN=

# 텔레그램 리스너 (Telethon, 상시 프로세스용)
TELETHON_API_ID=
TELETHON_API_HASH=
TELETHON_SESSION=whalescope
```

---

## 실행 방법 (3가지)

### 1. 일일 파이프라인 (Daily Pipeline)

온체인 이벤트 수집 → 시그널 탐지 → LLM 브리핑 생성 → Telegram 발송.

**사전 조건**: `ETHERSCAN_API_KEY`, `ANTHROPIC_API_KEY`, `GOOGLE_*`, `TELEGRAM_BOT_TOKEN`

```bash
# 실제 실행
python -m src.main

# --dry-run: 외부 API 호출 없이 fixture 데이터로 파이프라인 전 구간 검증
python -m src.main --dry-run
```

**예상 출력 (dry-run)**:
```
[pipeline] INFO: Stage 3/10: Collecting whale events (dry_run=True)
[pipeline] INFO: Loaded 23 fixture events
[pipeline] INFO: SignalEngine produced 3 signals
[pipeline] INFO: Pipeline finished. Status: completed
```

**GitHub Actions**: `.github/workflows/daily_brief.yml` — 매일 UTC 23:00 (KST 08:00) 자동 실행.

---

### 2. Telethon 리스너 (상시 프로세스)

텔레그램 공개 고래 알림 채널을 실시간 구독하여 이벤트를 storage에 저장.

**사전 조건**: `TELETHON_API_ID`, `TELETHON_API_HASH`, `TELETHON_SESSION`, `TG_CHANNEL`

```bash
# 연결 테스트 (Telethon 인증 없이 파서만 검증)
python scripts/run_listener.py --dry-run

# 실제 실행 (SIGINT로 종료)
TG_CHANNEL=@whale_alert_io python scripts/run_listener.py
```

**예상 출력 (dry-run)**:
```
dry-run: testing message parser
  input : 🚨 1,000,000 #USDT (1,012,450 USD) transferred from #Bin...
  parsed: {'symbol': 'USDT', 'amount': 1000000.0, ...}
dry-run OK
```

**참고**: 상시 실행이 필요하므로 Render / Fly.io / 로컬 데스크탑에 별도 배포 권장. GitHub Actions 단독으로는 상시 폴링 불가.

---

### 3. 텔레그램 봇 (사용자 명령 처리)

구독자 `/start`, `/watchlist`, `/pause`, `/status` 명령 long-polling 처리.

**사전 조건**: `TELEGRAM_BOT_TOKEN`, `GOOGLE_*`

```bash
python scripts/run_bot.py
```

**예상 출력**:
```
[run_bot] INFO: Starting WhaleScope bot polling...
```

SIGINT (Ctrl+C)로 종료. 봇은 명령 처리만 담당하며, 브리핑 발송은 일일 파이프라인이 수행.

---

## 연기 테스트 (Smoke Test)

```bash
python scripts/smoke_pipeline.py
```

외부 API 없이 전 구간 파이프라인을 검증. fixture 이벤트 23건 → SignalEngine → 브리핑 생성까지 확인.

```
Events : 23
Signals: 3
Brief  : 61 chars
Model  : dry_run
Status : completed
AnalLog: 1 row(s) written, log_ok=True
SMOKE OK
```

---

## 모듈 구조

```
src/
├── main.py                    # 10단계 파이프라인 오케스트레이터
├── config.py                  # 환경변수 로드
├── llm/
│   ├── base.py                # LLMProvider Protocol, LLMResult
│   ├── router.py              # LLMRouter (preferred + fallback)
│   ├── anthropic_provider.py
│   ├── gemini_provider.py
│   └── groq_provider.py
├── signals/
│   ├── engine.py              # SignalEngine (run + personalize)
│   ├── rules.py               # 8개 규칙 (cex_outflow_spike, ...)
│   └── models.py              # Event, Signal, RuleContext dataclass
├── ingestion/
│   ├── etherscan.py           # EtherscanCollector (5 EVM chains)
│   ├── solscan.py             # SolscanCollector
│   ├── normalizer.py          # raw tx → Event
│   ├── telethon_listener.py   # 상시 채널 리스너
│   └── registry.py            # watched_addresses 인덱스 로더
├── analyzer/
│   ├── claude_analyzer.py     # LLMAnalyzer (+ ClaudeAnalyzer compat)
│   ├── prompt_loader.py       # mtime-cached prompt loader (sha1 버전)
│   ├── scoring.py             # TransactionScorer (legacy compat)
│   └── price_service.py       # CoinGecko 가격 캐시
├── storage/
│   ├── sheets_client.py       # Google Sheets CRUD (Storage Protocol)
│   ├── protocol.py            # Storage Protocol 정의
│   └── schema.py              # 탭별 헤더 상수
├── distributor/
│   ├── telegram_bot.py        # WhaleScopeBot
│   └── formatters.py          # 브리핑 포맷터
└── utils/
    ├── logger.py
    ├── retry.py               # exponential backoff
    └── errors.py
prompts/
├── daily_brief.system.txt     # 일일 브리핑 페르소나 + 출력 구조
├── daily_brief.user.txt       # {{signals_json}} / {{date}} 템플릿
├── weekly_trend.system.txt    # 주간 트렌드 분석 구조
└── nl_intent.system.txt       # TG 메시지 → JSON 추출 스키마
config/
├── llm_routing.yaml           # LLMRouter 태스크별 모델/폴백 설정
├── signals.yaml               # 8개 시그널 규칙 임계값
└── watched_addresses.csv      # 80개 감시 주소 시드
```

---

## 시그널 규칙 (8가지)

| 규칙 | 설명 | 기본 심각도 |
|------|------|------------|
| `cex_outflow_spike` | CEX 유출 24h 이동평균 3σ 초과 | medium |
| `cex_inflow_spike` | CEX 유입 24h 이동평균 3σ 초과 | medium |
| `cold_to_hot_transfer` | cold → hot 지갑 이동 ≥$5M | high |
| `smart_money_accumulation` | 스마트머니 주소 3곳 이상 24h 동시 매집 | high |
| `token_whale_concentration_shift` | 상위 10 고래 보유 비중 2% 변화 | medium |
| `tg_cex_inflow_burst` | TG 채널 10분 내 CEX 유입 3건 이상 | medium |
| `corroborated_move` | 온체인 + TG 교차 확인 시 심각도 1단계 상향 | — |
| `weekly_net_accumulation` | 주간 누적 자금 흐름 2σ 편차 | low |

---

## 테스트

```bash
pytest -q
# 210 passed, 1 warning
```

외부 API 전부 mock 처리 → CI 안정 실행 가능.

---

## GitHub Actions 시크릿 등록

Settings → Secrets and variables → Actions:

| Secret | 설명 |
|--------|------|
| `ANTHROPIC_API_KEY` | Anthropic API 키 |
| `GEMINI_API_KEY` | Google Gemini API 키 (optional fallback) |
| `GROQ_API_KEY` | Groq API 키 (optional fallback) |
| `ETHERSCAN_API_KEY` | Etherscan API 키 |
| `SOLSCAN_API_KEY` | Solscan API 키 (optional) |
| `GOOGLE_SHEET_ID` | 스프레드시트 ID |
| `GOOGLE_CREDENTIALS_JSON` | 서비스 계정 JSON 전체 |
| `TELEGRAM_BOT_TOKEN` | 텔레그램 봇 토큰 |

---

## 라이선스

Private — All rights reserved.
