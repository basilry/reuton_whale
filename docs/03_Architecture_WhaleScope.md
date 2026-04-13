# WhaleScope 시스템 아키텍처 설계

**프로젝트**: 코인 고래의 온체인 움직임을 AI 기반으로 해석하는 큐레이션 서비스  
**기간**: 7일 MVP (1인 개발)  
**작성일**: 2026-04-13

---

## 1. Requirements

### 1.1 Functional Requirements

| 기능 | 설명 | 우선순위 | MVP 포함 |
|------|------|---------|---------|
| **Whale Digest** | Whale Alert API에서 대규모 트랜잭션 수집 → AI 해석 | P0 | ✓ |
| **Daily Brief** | 하루 수백 건 중 중요 5건 선별 → 매일 텔레그램 발송 | P0 | ✓ |
| **My Watchlist** | 사용자별 관심 코인 등록 → 필터링 알림 | P1 | △ |
| **대시보드** | Streamlit으로 과거 데이터/통계 조회 | P1 | △ |
| **컨텍스트 해석** | 거래소 입금(매도신호) vs 출금(보유신호) 자동 분류 | P0 | ✓ |

### 1.2 Non-Functional Requirements

| 요구사항 | 목표 | 제약사항 |
|---------|------|---------|
| **응답 시간** | 일일 브리핑 생성 < 2분 | GitHub Actions 제한 (6시간 max) |
| **가용성** | 매일 오전 8시 정확히 발송 | GitHub Actions 신뢰성 ~99% |
| **비용** | 월 < $5 | 무료/저비용 API 우선 |
| **확장성** | 초기 1,000명 사용자 수용 | Google Sheets 한계: ~1M cells |
| **데이터 보존** | 최소 3개월 이력 | Google Sheets에 저장 |

### 1.3 Constraints

- **개발자**: 1인, 7일 deadline
- **스택**: Python 3.10+
- **DB**: Google Sheets (관계형 DB 불가)
- **인터페이스**: Telegram Bot + Streamlit (웹 UI)
- **스케줄링**: GitHub Actions (cron 기반)
- **LLM**: Claude API (Anthropic) - 비용 최적화 필수
- **API**: 무료 티어 기준 (Whale Alert 무료 계획, CoinGecko API)

---

## 2. High-Level Architecture

### 2.1 컴포넌트 다이어그램

```
┌─────────────────────────────────────────────────────────────────┐
│                     외부 API / 데이터 소스                        │
├─────────────────────────────────────────────────────────────────┤
│ Whale Alert API │ CoinGecko API │ Google Sheets API │ Telegram  │
└─────────┬──────────────────┬──────────────────┬──────────────────┘
          │                  │                  │
          ↓                  ↓                  ↓
    ┌──────────────────────────────────────────────────────┐
    │           GitHub Actions Scheduler (Cron)            │
    │           (매일 오전 8시 KST)                         │
    └──────────┬───────────────────────────────────────────┘
               │
               ↓
    ┌──────────────────────────────────────────────────────┐
    │      WhaleScope Pipeline (Python Application)        │
    ├──────────────────────────────────────────────────────┤
    │ ┌──────────────┐  ┌──────────────┐  ┌────────────┐  │
    │ │ Data Ingress │─→│ AI Analyzer  │─→│ Data Store │  │
    │ │ (수집)        │  │ (Claude API) │  │ (Sheets)   │  │
    │ └──────────────┘  └──────────────┘  └─────┬──────┘  │
    │                                           │         │
    │                                           ↓         │
    │                                ┌──────────────────┐ │
    │                                │ Brief Generator  │ │
    │                                │ (요약 & 포맷)     │ │
    │                                └──────────────────┘ │
    └──────────────────────────────────────────────────────┘
               │
    ┌──────────┴───────────────────────────┐
    │                                      │
    ↓                                      ↓
┌─────────────────────┐         ┌─────────────────────┐
│  Telegram Bot       │         │ Streamlit Dashboard │
│  (브리핑 발송)       │         │ (데이터 조회 & 분석)  │
└─────────────────────┘         └─────────────────────┘
```

### 2.2 데이터 흐름

```
08:00 KST (trigger: GitHub Actions Cron)
  │
  ├─ Step 1: Data Ingress
  │  └─ Whale Alert에서 지난 24시간 대규모 거래 조회
  │  └─ 필터링: $1M 이상 거래
  │  └─ JSON → 구조화된 테이블
  │
  ├─ Step 2: Enrichment
  │  └─ CoinGecko: 현재 가격, 24h 변동률
  │  └─ Watchlist: 사용자별 관심 코인 로드
  │  └─ 데이터 결합: 거래 + 가격 + 시장 맥락
  │
  ├─ Step 3: AI Analysis (Claude API)
  │  └─ 사전 필터링 → 상위 거래만 Claude 호출
  │  └─ 중요도 스코어 1-10 산정
  │  └─ 한국어 해석 생성
  │  └─ Top 5 선별
  │
  ├─ Step 4: Storage → Google Sheets
  │
  ├─ Step 5: Distribution → Telegram 발송
  │
  └─ Step 6: Logging
```

### 2.3 외부 API 의존성

| API | 용도 | 비용 | Rate Limit |
|-----|------|------|-----------|
| **Whale Alert** | 고래 거래 수집 | 무료 | 지연 ~10분 |
| **CoinGecko** | 코인 가격/시장 데이터 | 무료 | 10-50 req/min |
| **Claude API** | 거래 해석/요약 | ~$3-5/월 | 충분 |
| **Google Sheets** | 데이터 저장 | 무료 | 쓰기 100/min |
| **Telegram Bot** | 메시지 발송 | 무료 | 30 msg/sec |

---

## 3. Deep Dive

### 3.1 Google Sheets 데이터 모델 (5개 탭)

#### Sheet 1: `transactions` (거래 원본)
| 컬럼 | 타입 | 설명 |
|------|------|------|
| id | string | "whale_alert_123456" |
| timestamp | datetime | UTC |
| blockchain | string | ethereum, bitcoin, solana... |
| from_address | string | 출발 주소 |
| to_address | string | 도착 주소 |
| token | string | ETH, BTC... |
| amount | float | 토큰 수량 |
| amount_usd | float | USD 환산 |
| type | string | deposit/withdrawal/transfer |
| exchange_tag | string | Binance/Kraken/Unknown |
| raw_response_hash | string | 중복 제거용 |

월 예상: 5,000~10,000행 (~20MB)

#### Sheet 2: `daily_brief` (일일 선별)
| 컬럼 | 타입 | 설명 |
|------|------|------|
| date | date | ISO 8601 |
| rank | int | 1~5 |
| transaction_id | string | FK |
| importance_score | float | 1-10 |
| ai_interpretation | text | 한국어 해석 |
| key_insight | text | 핵심 통찰 1줄 |

월 예상: 150행

#### Sheet 3: `watchlist` (사용자별 관심 코인)
| 컬럼 | 타입 | 설명 |
|------|------|------|
| user_id | int | Telegram ID |
| username | string | @username |
| coins | string | "ETH,BTC,SOL" (CSV) |
| status | string | active/paused |

#### Sheet 4: `analysis_log` (Claude 응답 캐시)
| 컬럼 | 타입 | 설명 |
|------|------|------|
| transaction_id | string | FK |
| prompt_hash | string | 중복 분석 방지 |
| response | json | Claude 원문 |
| tokens_used | int | 비용 추적 |
| cost_usd | float | 비용 |

#### Sheet 5: `system_log` (실행 로그)
| 컬럼 | 타입 | 설명 |
|------|------|------|
| run_id | string | GitHub Actions run ID |
| status | string | success/partial_failure/failure |
| transactions_processed | int | 처리 건수 |
| telegram_sent | int | 발송 수 |
| error_message | text | null or 에러 |

**총 크기**: 월 ~50MB (Sheets 한계 10M cells 대비 여유)

---

### 3.2 Claude 프롬프트 설계

#### 시스템 프롬프트
```
당신은 암호화폐 시장 분석가입니다.
온체인 거래 데이터를 받고 다음을 수행합니다:
1. 거래의 시장 의미 해석
2. 중요도 스코어 (1-10) 산정
3. 핵심 통찰을 한국어로 요약

응답 형식 (JSON):
{
  "importance_score": <1-10>,
  "type": "<whale_deposit_exchange|whale_withdrawal_personal|whale_transfer_unknown>",
  "interpretation": "<한국어 2-3줄 해석>",
  "key_insight": "<핵심 통찰 1줄>",
  "confidence": <0.5-1.0>
}
```

#### 중요도 스코어링
```
1단계: 규칙 기반 사전 필터 (Claude 호출 전)
  거래액 > $50M → 기본 7점
  거래액 > $10M → 기본 6점
  거래액 > $1M  → 기본 5점

2단계: Claude 세부 분석
  거래소 입금 → +2점 (매도 신호)
  개인 지갑 출금 → +1점 (보유 신호)
  반복 패턴 → +1점
  시장 변동성 > 5% → +0.5점

3단계: 최종 Top 5 선별
```

---

### 3.3 에러 핸들링

| 시나리오 | 대응 |
|---------|------|
| Whale Alert 타임아웃 | 전일 데이터 사용 + "지연" 표기 |
| CoinGecko rate limit | exponential backoff (최대 5회) |
| Claude API 실패 | 작은 배치 재시도, 실패 시 수동 alert |
| Sheets 쓰기 실패 | 로컬 큐에 저장 → 다음 주기 재시도 |
| Telegram bot blocked | 사용자 "blocked" 마크 |

---

## 4. Scale & Reliability

- **Google Sheets**: 6개월(~96K행) 안전. 이후 SQLite/Supabase 전환
- **GitHub Actions**: ±5분 정확도, 6시간 제한(우리는 2분)
- **Telegram**: 1,000명 이하 순차 발송 충분
- **Claude**: 월 $3-5, Batch API로 50% 절감 가능

---

## 5. Trade-off Analysis

### DB: Google Sheets vs SQLite vs Supabase
| | Sheets | SQLite | Supabase |
|---|--------|--------|----------|
| 비용 | 무료 | 무료 | $25/월 |
| 설정 | 5분 | 5분 | 10분 |
| 확장성 | ~6개월 | ~2년 | 무제한 |
| **선택**: Sheets (MVP 3개월 충분, 설정 최소화)

### 인터페이스: Telegram vs Discord vs 웹
**선택**: Telegram(주) + Streamlit(보조) — 개발 난이도 최저, 알림 즉시성

### 처리: 배치 vs 실시간
**선택**: 배치(매일 08:00) — 비용 $0, 인프라 불필요

### LLM: Claude vs GPT-4 vs 오픈소스
**선택**: Claude 3.5 Sonnet — 비용 최적(GPT-4 대비 1/10), 한국어 우수

---

## 6. 디렉토리 구조

```
whalescope/
├── .github/workflows/daily_brief.yml
├── src/
│   ├── __init__.py
│   ├── config.py
│   ├── main.py
│   ├── collectors/
│   │   ├── whale_alert.py
│   │   └── coingecko.py
│   ├── analyzer/
│   │   ├── claude_analyzer.py
│   │   ├── scoring.py
│   │   └── prompts.py
│   ├── storage/
│   │   ├── sheets_client.py
│   │   ├── schema.py
│   │   └── queries.py
│   ├── distributor/
│   │   ├── telegram_bot.py
│   │   └── formatters.py
│   └── utils/
│       ├── logger.py
│       ├── retry.py
│       └── errors.py
├── tests/
├── scripts/
│   ├── init_sheets.py
│   ├── test_connection.py
│   └── manual_brief.py
├── docs/
├── requirements.txt
├── .env.example
├── .gitignore
└── README.md
```

---

## 7. 향후 확장

- **Phase 2** (1-3개월): 인터랙티브 Telegram UI, 거래 패턴 학습, DB 마이그레이션
- **Phase 3** (3-6개월): 실시간 알림(유료), Discord 커뮤니티, Next.js 웹포털
- **Phase 4** (6-12개월): 엔터프라이즈 API, 자동매매 신호, 국제화
