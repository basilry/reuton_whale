# WhaleScope

AI 기반 암호화폐 고래 거래 모니터링 및 일일 브리핑 서비스.
온체인 고래 이동을 수집하고, Claude AI로 분석한 뒤, 텔레그램으로 한국어 브리핑을 전달한다.

## 아키텍처

```
[데이터 수집]               [AI 분석]                [저장 & 배포]

Whale Alert API ----+      TransactionScorer       Google Sheets
  (온체인 데이터)    |        (사전 필터링)           (거래, 브리핑,
                    v            |                   워치리스트, 로그)
               Collector ---> pre_filter (>=1M)          |
                    |            |                       v
CoinGecko API ------+      ClaudeAnalyzer          Telegram Bot
  (시장 데이터)   Enricher   (배치 분석)              (일일 브리핑)
                    |            |                       |
                    v            v                       v
               보강된 거래 --> 분석된 거래 ---+---> Daily Brief
                                            |
                                    rank_by_importance
                                       (Top 5)
```

## 기술 스택

| 분류 | 기술 | 용도 |
|------|------|------|
| 언어 | Python 3.11 | 코어 런타임 |
| AI | Anthropic Claude API (claude-sonnet-4-20250514) | 거래 해석 + 브리핑 생성 |
| 데이터 소스 | Whale Alert API | 온체인 고래 거래 피드 |
| 시장 데이터 | CoinGecko API | 실시간 가격/거래량 보강 |
| 저장소 | Google Sheets (gspread) | 영구 데이터 저장 |
| 배포 | Telegram Bot API (python-telegram-bot) | 사용자 브리핑 전달 |
| 대시보드 | Streamlit | 웹 기반 모니터링 UI |
| CI/CD | GitHub Actions | 자동 일일 파이프라인 |
| 테스트 | pytest | 단위/통합 테스트 |

## 모듈 구조

```
whalescope/
├── src/
│   ├── config.py                # 환경변수 로드
│   ├── main.py                  # 10단계 파이프라인 오케스트레이터
│   ├── collectors/
│   │   ├── whale_alert.py       # Whale Alert API 수집
│   │   └── coingecko.py         # CoinGecko 시장 데이터 보강
│   ├── analyzer/
│   │   ├── claude_analyzer.py   # Claude AI 거래 분석
│   │   ├── scoring.py           # 중요도 스코어링 (규칙 + AI)
│   │   └── prompts.py           # 시스템/유저/브리핑 프롬프트
│   ├── storage/
│   │   ├── sheets_client.py     # Google Sheets CRUD
│   │   ├── schema.py            # 5개 탭 스키마 정의
│   │   └── queries.py           # 데이터 변환 헬퍼
│   ├── distributor/
│   │   ├── telegram_bot.py      # 텔레그램 봇 (구독/워치리스트/발송)
│   │   └── formatters.py        # HTML 브리핑 포맷터
│   └── utils/
│       ├── logger.py            # 로거
│       ├── retry.py             # exponential backoff 데코레이터
│       └── errors.py            # 커스텀 예외
├── tests/                       # 78개 단위 테스트
├── scripts/
│   ├── init_sheets.py           # Google Sheets 초기 셋업
│   ├── test_connection.py       # API 연결 검증
│   └── manual_brief.py          # 수동 브리핑 실행
├── streamlit_app.py             # Streamlit 대시보드
├── .github/workflows/
│   └── daily_brief.yml          # GitHub Actions 크론 워크플로우
├── requirements.txt
├── .env.example
└── .gitignore
```

## 사전 준비

### 1. API 키 발급

| 서비스 | 발급 방법 |
|--------|----------|
| **Whale Alert** | https://whale-alert.io 가입 -> API Plan 선택 -> API Key 복사 |
| **Anthropic** | https://console.anthropic.com -> API Keys -> Create Key |
| **Google Sheets** | Google Cloud Console -> 서비스 계정 생성 -> JSON 키 다운로드 -> 스프레드시트에 서비스 계정 이메일 공유 |
| **Telegram Bot** | @BotFather에게 /newbot -> 봇 이름 설정 -> Token 복사 |

### 2. Google Sheets 설정

1. Google Cloud Console에서 프로젝트 생성
2. Google Sheets API, Google Drive API 활성화
3. 서비스 계정 생성 후 JSON 키 다운로드
4. Google Sheets에서 빈 스프레드시트 생성
5. 스프레드시트를 서비스 계정 이메일(xxx@xxx.iam.gserviceaccount.com)과 공유
6. 스프레드시트 URL에서 ID 복사 (https://docs.google.com/spreadsheets/d/**{이 부분}**/edit)

## 설치 및 실행

### 1. 의존성 설치

```bash
cd whalescope
pip install -r requirements.txt
```

### 2. 환경변수 설정

```bash
cp .env.example .env
```

`.env` 파일을 열고 발급받은 키를 입력:

```
WHALE_ALERT_API_KEY=발급받은_whale_alert_키
ANTHROPIC_API_KEY=발급받은_anthropic_키
GOOGLE_SHEET_ID=스프레드시트_ID
GOOGLE_CREDENTIALS_JSON={"type":"service_account","project_id":"..."}
TELEGRAM_BOT_TOKEN=발급받은_텔레그램_봇_토큰
```

> `GOOGLE_CREDENTIALS_JSON`은 다운로드한 JSON 파일 내용을 한 줄로 넣는다.

### 3. Google Sheets 초기화

```bash
python -m scripts.init_sheets
```

5개 탭(transactions, daily_brief, watchlist, analysis_log, system_log)과 헤더가 자동 생성된다.

### 4. 연결 테스트

```bash
python scripts/test_connection.py
```

각 서비스(Whale Alert, CoinGecko, Anthropic, Google Sheets, Telegram) 연결 상태를 확인한다.

### 5. 수동 브리핑 실행

```bash
python scripts/manual_brief.py
```

파이프라인을 1회 실행하여 거래 수집 -> 분석 -> 브리핑 생성 -> 텔레그램 발송까지 확인한다.

### 6. Streamlit 대시보드

```bash
streamlit run streamlit_app.py
```

브라우저에서 `http://localhost:8501` 접속. 3개 탭:
- **오늘의 브리핑**: 최신 분석 결과 카드 + 총 거래액/평균 중요도 지표
- **거래 히스토리**: 날짜/토큰/금액 필터링 테이블
- **통계**: 일별 추이, 토큰별 분포, 거래소 입출금 비율 차트

### 7. GitHub Actions 자동화 (선택)

GitHub 저장소 Settings -> Secrets and variables -> Actions에 5개 시크릿 등록:

| Secret 이름 | 값 |
|-------------|-----|
| `WHALE_ALERT_API_KEY` | Whale Alert API 키 |
| `ANTHROPIC_API_KEY` | Anthropic API 키 |
| `GOOGLE_SHEET_ID` | 스프레드시트 ID |
| `GOOGLE_CREDENTIALS_JSON` | 서비스 계정 JSON (전체) |
| `TELEGRAM_BOT_TOKEN` | 텔레그램 봇 토큰 |

등록 후 매일 KST 08:00 (UTC 23:00)에 자동 실행된다. Actions 탭에서 수동 실행(workflow_dispatch)도 가능.

## 파이프라인 동작 순서

```
1. 환경변수 로드 (config.py)
2. 클라이언트 초기화 (Collector, Enricher, Analyzer, Scorer, Sheets, Bot)
3. Whale Alert API에서 최근 24시간 고래 거래 수집
4. CoinGecko API로 시장 데이터 보강 (현재가, 변동률, 거래량, 시가총액)
5. 규칙 기반 사전 필터링 (>= $1M, 거래소 입출금 우선, 최대 30건)
6. Claude AI 배치 분석 (중요도 점수, 거래 유형, 해석, 신뢰도)
7. 중요도 순 Top 5 선별
8. 한국어 일일 브리핑 텍스트 생성
9. Google Sheets에 거래 데이터 + 브리핑 저장
10. 텔레그램 구독자에게 브리핑 발송
```

## 텔레그램 봇 명령어

| 명령어 | 설명 |
|--------|------|
| `/start` | 구독 등록 + 사용 가이드 |
| `/watchlist ETH BTC SOL` | 관심 코인 설정 (해당 코인 거래에 별 표시) |
| `/watchlist` | 현재 관심 코인 조회 |
| `/pause` | 알림 일시 중지 |
| `/status` | 구독 상태 + 최근 브리핑 요약 |

## 테스트

```bash
pytest tests/ -v
```

78개 테스트, 외부 API는 전부 mock 처리. 커버리지:

| 테스트 파일 | 대상 | 건수 |
|------------|------|------|
| test_collectors.py | WhaleAlertCollector, CoinGeckoEnricher | 7 |
| test_claude_analyzer.py | ClaudeAnalyzer (API, 캐시, 재시도) | 8 |
| test_scoring.py | TransactionScorer (점수, 필터, 랭킹) | 11 |
| test_storage.py | SheetsClient, schema, queries | 18 |
| test_distributor.py | WhaleScopeBot, formatters | 16 |
| test_main.py | run_daily_pipeline 통합 | 3 |
| test_streamlit_app.py | 대시보드 데이터 로딩 | 4 |

## AI 도구 활용

| 도구 | 활용 방식 |
|------|----------|
| **Claude API** (claude-sonnet-4-20250514) | 런타임: 각 고래 거래를 분석하여 중요도 점수, 거래 유형 분류, 해석, 신뢰도를 JSON으로 반환. Top 5 거래를 종합하여 한국어 일일 브리핑 생성. |
| **Claude Code** (claude-opus-4-6) | 개발: 프로젝트 스캐폴딩, 4개 에이전트 병렬 모듈 구현, 파이프라인 통합, 테스트 작성, 보안 점검, QA 전체 수행. |

## 향후 계획

- 실시간 WebSocket 스트리밍 (폴링 대체)
- 멀티체인 확장 (Solana, Polygon, Arbitrum)
- 과거 패턴 탐지 (반복 주소 추적)
- 사용자별 커스텀 알림 임계값
- Supabase/PostgreSQL 마이그레이션
- 토큰 비용 추적 및 예산 알림

## 라이선스

Private - All rights reserved.
