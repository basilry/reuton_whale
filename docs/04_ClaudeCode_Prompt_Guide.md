# WhaleScope — Claude Code 단계별 프롬프트 가이드

이 문서는 Claude Code를 사용해 WhaleScope를 7일 안에 구현하기 위한 **복사-붙여넣기 가능한 프롬프트 시퀀스**입니다.
각 프롬프트는 이전 단계의 결과에 의존하므로, 순서대로 실행하세요.

---

## Day 1: 프로젝트 초기화 + 데이터 수집

### Prompt 1-1: 프로젝트 스캐폴딩
```
WhaleScope 프로젝트를 초기화해줘.

구조:
whalescope/
├── .github/workflows/daily_brief.yml
├── src/
│   ├── __init__.py
│   ├── config.py          # 환경변수 로드 (dotenv)
│   ├── main.py            # 엔트리포인트
│   ├── collectors/
│   │   ├── __init__.py
│   │   ├── whale_alert.py
│   │   └── coingecko.py
│   ├── analyzer/
│   │   ├── __init__.py
│   │   ├── claude_analyzer.py
│   │   ├── scoring.py
│   │   └── prompts.py
│   ├── storage/
│   │   ├── __init__.py
│   │   ├── sheets_client.py
│   │   ├── schema.py
│   │   └── queries.py
│   ├── distributor/
│   │   ├── __init__.py
│   │   ├── telegram_bot.py
│   │   └── formatters.py
│   └── utils/
│       ├── __init__.py
│       ├── logger.py
│       ├── retry.py
│       └── errors.py
├── tests/
├── scripts/
│   ├── init_sheets.py
│   ├── test_connection.py
│   └── manual_brief.py
├── requirements.txt
├── .env.example
├── .gitignore
└── README.md

requirements.txt에 포함할 패키지:
- anthropic
- gspread
- google-auth
- python-telegram-bot==21.*
- requests
- python-dotenv
- streamlit

.env.example:
WHALE_ALERT_API_KEY=
ANTHROPIC_API_KEY=
GOOGLE_SHEET_ID=
GOOGLE_CREDENTIALS_JSON=
TELEGRAM_BOT_TOKEN=

config.py는 dotenv로 환경변수 로드하고, 각 키가 없으면 ValueError raise.
main.py는 빈 파이프라인 구조만 잡아둬 (함수 시그니처만).
```

### Prompt 1-2: Whale Alert 수집기
```
src/collectors/whale_alert.py를 구현해줘.

기능:
- Whale Alert API v2에서 지난 24시간 거래 수집
- GET https://api.whale-alert.io/v1/transactions
  ?api_key={key}&start={24h전_unix}&min_value=1000000
- 응답 파싱: hash, from(address/owner_type/owner), to, token(symbol), 
  amount, amount_usd, timestamp, blockchain 추출
- raw_response_hash로 중복 제거 (sha256)
- 결과를 list[dict] 반환

클래스 구조:
class WhaleAlertCollector:
    def __init__(self, api_key: str)
    def fetch_transactions(self, hours: int = 24, min_value: int = 1_000_000) -> list[dict]
    def _parse_transaction(self, raw: dict) -> dict
    def _deduplicate(self, transactions: list[dict]) -> list[dict]

에러 처리:
- 429: exponential backoff (utils/retry.py 데코레이터 사용)
- 401: ValueError("Invalid Whale Alert API key")
- 503: 빈 리스트 반환 + 로깅

utils/retry.py도 같이 구현:
- @retry(max_retries=5, base_delay=1.0) 데코레이터
- exponential backoff with jitter
```

### Prompt 1-3: CoinGecko 보강
```
src/collectors/coingecko.py를 구현해줘.

기능:
- CoinGecko API v3에서 코인 가격/시장 데이터 조회
- GET https://api.coingecko.com/api/v3/simple/price
  ?ids={coin_ids}&vs_currencies=usd&include_24hr_change=true&include_24hr_vol=true&include_market_cap=true
- 토큰 심볼(ETH, BTC)을 CoinGecko ID(ethereum, bitcoin)로 매핑하는 딕셔너리 내장
- 한 번에 최대 50개 코인 배치 요청

클래스 구조:
class CoinGeckoEnricher:
    SYMBOL_TO_ID = {"BTC": "bitcoin", "ETH": "ethereum", "SOL": "solana", ...}
    
    def enrich_transactions(self, transactions: list[dict]) -> list[dict]
    # 각 거래에 current_price, price_change_24h, volume_24h, market_cap 추가
    
    def _fetch_prices(self, coin_ids: list[str]) -> dict

에러 처리:
- 429: 1초 대기 후 재시도 (retry 데코레이터)
- 없는 코인: None으로 채우고 로깅
```

---

## Day 2: AI 분석 파이프라인

### Prompt 2-1: Claude 분석기
```
src/analyzer/claude_analyzer.py를 구현해줘.

기능:
- Anthropic Python SDK 사용 (anthropic 패키지)
- 거래 데이터를 받아 Claude API로 분석 요청
- 응답: importance_score, type, interpretation, key_insight, confidence

클래스 구조:
class ClaudeAnalyzer:
    def __init__(self, api_key: str, model: str = "claude-sonnet-4-20250514")
    
    def analyze_transaction(self, transaction: dict) -> dict:
        # 단일 거래 분석
        # src/analyzer/prompts.py의 시스템/유저 프롬프트 사용
        # JSON 응답 파싱
    
    def analyze_batch(self, transactions: list[dict]) -> list[dict]:
        # 여러 거래를 순차 분석 (rate limit 고려)
        # analysis_log 캐시 확인 (prompt_hash)
        # 이미 분석된 거래는 스킵
    
    def generate_daily_brief(self, top_transactions: list[dict]) -> str:
        # Top 5 거래로 한국어 브리핑 텍스트 생성
        # 🐋 이모지 포맷 포함

src/analyzer/prompts.py도 같이 구현:
- SYSTEM_PROMPT: 암호화폐 시장 분석가 역할, JSON 응답 형식 지정
- USER_PROMPT_TEMPLATE: 거래 정보 + 시장 맥락 템플릿 (f-string)
- BRIEF_PROMPT_TEMPLATE: Top 5 종합 브리핑 생성 프롬프트

중요:
- Claude 응답이 JSON이 아닐 경우 재시도 (최대 2회)
- 토큰 사용량 로깅 (response.usage.input_tokens + output_tokens)
```

### Prompt 2-2: 중요도 스코어링
```
src/analyzer/scoring.py를 구현해줘.

기능:
- 규칙 기반 사전 필터 + Claude 분석 결과 결합
- Claude 호출 전에 불필요한 거래를 걸러서 비용 절감

class TransactionScorer:
    def pre_filter(self, transactions: list[dict]) -> list[dict]:
        # 규칙 기반 필터링:
        # - amount_usd >= 1_000_000
        # - 거래소 입출금 거래 우선 (type이 deposit/withdrawal)
        # - 같은 주소의 24h 내 반복 거래 → 가중치
        # 결과: 최대 30건으로 축소 (Claude 비용 절감)
    
    def rank_by_importance(self, analyzed: list[dict]) -> list[dict]:
        # Claude 분석 결과의 importance_score로 정렬
        # 상위 5건 반환
    
    def calculate_base_score(self, transaction: dict) -> float:
        # 규칙 기반 기본 점수:
        # > $50M: 7점, > $10M: 6점, > $1M: 5점
        # 거래소 입금: +2, 출금: +1
        # 반복 패턴: +1
```

---

## Day 3: Google Sheets 저장소

### Prompt 3-1: Sheets 클라이언트
```
src/storage/sheets_client.py를 구현해줘.

기능:
- gspread + google-auth로 Google Sheets API 연동
- 서비스 계정 인증 (GOOGLE_CREDENTIALS_JSON 환경변수에서 JSON 로드)
- 5개 시트(탭) CRUD 지원

class SheetsClient:
    def __init__(self, sheet_id: str, credentials_json: str):
        # credentials_json은 JSON 문자열 (GitHub Secrets 호환)
        # gspread.authorize()
    
    # transactions 탭
    def append_transactions(self, transactions: list[dict]) -> int:
        # 배치 append (한 번에 여러 행)
        # 중복 체크: raw_response_hash 비교
        # 반환: 추가된 행 수
    
    # daily_brief 탭
    def save_daily_brief(self, date: str, briefs: list[dict]) -> None
    def get_daily_brief(self, date: str) -> list[dict]
    
    # watchlist 탭
    def get_active_watchlists(self) -> list[dict]
    def upsert_watchlist(self, user_id: int, username: str, coins: list[str]) -> None
    
    # analysis_log 탭
    def get_cached_analysis(self, prompt_hash: str) -> dict | None
    def save_analysis(self, log_entry: dict) -> None
    
    # system_log 탭
    def log_run(self, run_data: dict) -> None

에러 처리:
- gspread.exceptions.APIError: retry 데코레이터 적용
- 시트가 없으면 자동 생성 (init 시 체크)

scripts/init_sheets.py도 구현:
- 스프레드시트에 5개 탭이 없으면 생성
- 각 탭의 헤더 행 자동 삽입
```

---

## Day 4: Telegram Bot

### Prompt 4-1: Telegram Bot 기본
```
src/distributor/telegram_bot.py를 구현해줘.

기능:
- python-telegram-bot v21 사용 (async)
- 브리핑 메시지 발송 + 사용자 명령 처리

class WhaleScopeBot:
    def __init__(self, token: str, sheets_client: SheetsClient)
    
    # 메시지 발송
    async def send_daily_brief(self, brief_text: str) -> dict:
        # sheets_client에서 active 구독자 목록 조회
        # 각 사용자에게 brief_text 발송
        # Watchlist 필터링: 사용자 관심 코인이 포함된 거래만 하이라이트
        # 반환: {"sent": N, "failed": N, "blocked": N}
    
    # 명령 핸들러
    async def handle_start(self, update, context):
        # /start → 구독 등록 (sheets에 저장)
        # 환영 메시지 + 사용 가이드
    
    async def handle_watchlist(self, update, context):
        # /watchlist ETH BTC SOL → 관심 코인 설정
        # /watchlist → 현재 설정 조회
    
    async def handle_pause(self, update, context):
        # /pause → 알림 일시중지
    
    async def handle_status(self, update, context):
        # /status → 최근 브리핑 요약 + 구독 상태

src/distributor/formatters.py도 구현:
- format_daily_brief(briefs: list[dict], watchlist: list[str] | None) -> str
  # 텔레그램 HTML 파싱 모드
  # 🐋 이모지 포맷
  # Watchlist 코인 하이라이트 (해당 거래에 ⭐ 표시)
- format_welcome_message() -> str
- format_watchlist_confirmation(coins: list[str]) -> str
```

---

## Day 5: 파이프라인 통합

### Prompt 5-1: main.py 통합
```
src/main.py를 완성해줘. 전체 파이프라인을 연결하는 엔트리포인트.

async def run_daily_pipeline():
    """GitHub Actions에서 매일 실행되는 메인 파이프라인"""
    
    run_start = datetime.utcnow()
    run_id = f"run_{run_start.strftime('%Y%m%d%H')}_{uuid4().hex[:6]}"
    
    try:
        # 1. 설정 로드
        config = load_config()
        
        # 2. 클라이언트 초기화
        collector = WhaleAlertCollector(config.whale_alert_api_key)
        enricher = CoinGeckoEnricher()
        analyzer = ClaudeAnalyzer(config.anthropic_api_key)
        scorer = TransactionScorer()
        sheets = SheetsClient(config.sheet_id, config.google_credentials)
        bot = WhaleScopeBot(config.telegram_token, sheets)
        
        # 3. 수집
        transactions = collector.fetch_transactions(hours=24)
        logger.info(f"수집: {len(transactions)}건")
        
        # 4. 보강
        transactions = enricher.enrich_transactions(transactions)
        
        # 5. 사전 필터링
        filtered = scorer.pre_filter(transactions)
        logger.info(f"사전 필터: {len(filtered)}건")
        
        # 6. AI 분석
        analyzed = analyzer.analyze_batch(filtered)
        
        # 7. Top 5 선별
        top5 = scorer.rank_by_importance(analyzed)
        
        # 8. 브리핑 생성
        brief_text = analyzer.generate_daily_brief(top5)
        
        # 9. 저장
        sheets.append_transactions(transactions)
        sheets.save_daily_brief(run_start.strftime('%Y-%m-%d'), top5)
        
        # 10. 발송
        result = await bot.send_daily_brief(brief_text)
        
        # 11. 로그
        sheets.log_run({
            "run_id": run_id,
            "status": "success",
            "transactions_processed": len(transactions),
            "analysis_count": len(top5),
            "telegram_sent": result["sent"],
            ...
        })
        
    except Exception as e:
        sheets.log_run({"run_id": run_id, "status": "failure", "error_message": str(e)})
        raise

if __name__ == "__main__":
    asyncio.run(run_daily_pipeline())

모든 단계에서 적절한 로깅 추가.
각 단계 실패 시에도 부분 결과 저장하도록 try/except 세분화.
```

### Prompt 5-2: GitHub Actions 워크플로우
```
.github/workflows/daily_brief.yml을 구현해줘.

name: Daily Whale Brief

on:
  schedule:
    - cron: '0 23 * * *'  # UTC 23:00 = KST 08:00
  workflow_dispatch:  # 수동 실행 지원

jobs:
  daily-brief:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: '3.11'
          cache: 'pip'
      - run: pip install -r requirements.txt
      - run: python -m src.main
        env:
          WHALE_ALERT_API_KEY: ${{ secrets.WHALE_ALERT_API_KEY }}
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          GOOGLE_SHEET_ID: ${{ secrets.GOOGLE_SHEET_ID }}
          GOOGLE_CREDENTIALS_JSON: ${{ secrets.GOOGLE_CREDENTIALS_JSON }}
          TELEGRAM_BOT_TOKEN: ${{ secrets.TELEGRAM_BOT_TOKEN }}
```

---

## Day 6: Streamlit 대시보드

### Prompt 6-1: 대시보드
```
streamlit_app.py를 프로젝트 루트에 생성해줘.

Streamlit 대시보드 구현:

1. 사이드바
   - 날짜 범위 선택 (date_input)
   - 토큰 필터 (multiselect: BTC, ETH, SOL 등)
   - 중요도 최소값 슬라이더 (1-10)

2. 메인 페이지
   - 페이지 제목: "🐋 WhaleScope Dashboard"
   
   탭 1: "오늘의 브리핑"
   - 최신 Daily Brief 카드 형태로 표시
   - 각 거래: 토큰, 금액, 중요도 바, AI 해석
   - st.metric으로 총 거래액, 평균 중요도
   
   탭 2: "거래 히스토리"
   - transactions 시트 데이터를 DataFrame으로
   - 날짜/토큰/금액 필터링
   - st.dataframe으로 테이블 표시
   
   탭 3: "통계"
   - 일별 거래 건수 추이 (st.line_chart)
   - 토큰별 거래액 분포 (st.bar_chart)
   - 거래소별 입출금 비율

Google Sheets에서 데이터 로드.
@st.cache_data(ttl=300)로 5분 캐싱.
```

---

## Day 7: 마무리

### Prompt 7-1: README.md
```
README.md를 작성해줘. 과제 제출용으로 다음 포함:

1. 프로젝트 소개 (WhaleScope 한 줄 설명)
2. 스크린샷 (추후 추가 자리)
3. 기술 스택 테이블
4. 실행 방법
   - 사전 준비 (API 키 발급 가이드)
   - 로컬 실행 (pip install, .env 설정, python -m src.main)
   - Streamlit 대시보드 (streamlit run streamlit_app.py)
   - GitHub Actions 설정
5. 사용한 AI 도구와 활용 방식
   - Claude API: 거래 해석, 브리핑 생성
   - Claude Code: 전체 개발 과정에서 활용 (구조 설계, 코드 생성, 디버깅)
   - 구체적 활용 사례 3-4개
6. 아키텍처 다이어그램
7. 향후 계획
```

### Prompt 7-2: 테스트 + 디버깅
```
전체 파이프라인을 로컬에서 테스트해줘.

1. scripts/test_connection.py 실행 → 모든 API 연결 확인
2. scripts/manual_brief.py 실행 → 수동 브리핑 1회 생성
3. 에러 있으면 수정
4. Telegram으로 테스트 메시지 발송 확인
5. Streamlit 대시보드 로컬 실행 확인

발견된 버그가 있으면 수정하고, 수정 내용을 알려줘.
```

### Prompt 7-3: 최종 점검
```
제출 전 최종 점검:

1. .gitignore에 .env, __pycache__, *.pyc, credentials.json 포함 확인
2. .env.example에 모든 필요 환경변수 나열
3. 코드에 API 키나 시크릿이 하드코딩된 곳 없는지 grep
4. requirements.txt 버전 pinning
5. 모든 파일에 적절한 docstring/주석
6. GitHub Actions yml 문법 검증
7. README.md 완성도 확인

문제 있으면 수정해줘.
```

---

## 보너스: 트러블슈팅 프롬프트

### API 디버깅
```
{서비스명} API 호출이 {에러코드}를 반환해.
요청 내용: {요청 URL/body}
응답: {에러 메시지}
원인 분석하고 수정해줘.
```

### 성능 최적화
```
현재 파이프라인 실행 시간이 {N}분이야.
병목은 {단계}인 것 같은데, 최적화 방법 제안하고 구현해줘.
Claude API 호출 수를 줄이는 게 우선이야.
```

### Sheets 스키마 변경
```
{탭명}에 {컬럼명} 컬럼을 추가해야 해.
sheets_client.py, schema.py, 관련 코드 모두 수정해줘.
기존 데이터 호환성 유지.
```
