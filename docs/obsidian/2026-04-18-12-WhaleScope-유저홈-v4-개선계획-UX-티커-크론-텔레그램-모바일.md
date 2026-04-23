---
type: improvement-plan
date: 2026-04-18
sequence: 12
version: v4
status: proposed
tags:
  - whalescope
  - v4
  - improvement-plan
  - ux-restructure
  - market-ticker
  - cron-cadence
  - telegram-broadcast
  - mobile-responsive
source:
  - "[[2026-04-18-11-WhaleScope-유저홈-v3-구현-QA-코드리뷰-종합보고서]]"
  - "[[2026-04-18-10-WhaleScope-유저홈-v3-종합개선안-실시간티커-뉴스-큐레이션]]"
---

# WhaleScope 유저홈 v4 개선계획 — UX·티커·크론·텔레그램·모바일

> **근거 문서**: [[2026-04-18-11-WhaleScope-유저홈-v3-구현-QA-코드리뷰-종합보고서]]의 §3·§9·§13 QA 결과와 잔여 리스크 5종을 기반으로, 사용자 직접 피드백 7건을 v4 로드맵으로 통합한다. v3는 "기반(backend·data-source·auth)"을 맞췄고, v4는 "UX·주기·전달 채널"을 맞춘다.

## Executive Summary

v3 QA 종합보고서의 잔여 리스크 중 3종(비용/주기·모바일·모달 UX)과 사용자 피드백 7건을 합쳐, v4는 **5개 주차 롤아웃**으로 다룬다.

| 영역 | v3 상태 | v4 목표 | 측정 지표 |
|---|---|---|---|
| 뉴스 피드 | RSS 인제스터 존재, 크론 미연결 → 빈 테이블 | 우측 고정 사이드바 분리 + 30분 주기 RSS 크론 | `news_feed` 테이블 24h 내 행 증가량 ≥ 30 |
| 실시간 티커 notice | 틱마다 "계산 중" 토스트 깜빡 | 데이터소스 chip 3종 + `YYYY.MM.DD HH:mm:ss` 최종 갱신 | notice DOM mutation 초당 ≤ 1회 |
| 티커 카드 | 6열×172px, 차트보기 깨짐 | 4열×280px, 차트 모달 오버레이 | 모바일 375px 렌더 무깨짐, Lighthouse CLS ≤ 0.05 |
| 브리핑/시그널 주기 | UTC 23:00 1회/일 | 브리핑 8h, 시그널 15m, 월 LLM 비용 상한 $15 | 마지막 생성 후 경과시간 median ≤ 4h |
| 큐레이션/스토리 주기 | 일 1회 | 온체인 잔고 15m, 스토리 생성 6h | 잔고 신선도 median ≤ 30m |
| 텔레그램 채널 | 봇 미입장, DRY_RUN=true | 봇 admin 승격 + Dry-run 1주 검증 → ENABLED 플래그 전환 | `broadcast_log` status="sent" ≥ 1/일 |
| 모바일 반응형 | `@media (max-width: 1180/860/640)` 일부 존재 | 375/640/1024/1440 브레이크포인트 전 컴포넌트 감사 | Lighthouse Mobile A11y ≥ 95 |

---

## §1. 뉴스 사이드바 분리 + RSS 원천 크론 연결

### 1-1. 현상 (Before)

- `apps/dashboard/app/page.module.css` L8~15: 메인 12-col 그리드 안에 `colSpan8`/`colSpan4`가 형제로 흩어져 있어 뉴스·큐레이션이 메인 스크롤과 함께 흘러감.
- `apps/dashboard/components/news-widget.tsx` 자체는 렌더되지만 `news_feed` 시트 테이블이 **사실상 비어 있음**.
- `.github/workflows/daily_brief.yml`는 `python -m src.main`만 호출 → `src/ingestion/news_rss.py::main()`이 파이프라인 내부에서 불리는지는 `src/main.py`를 확인해야 함 (현 워크플로 파일에는 `news_rss` 단독 호출이 없음).
- 결과: 사용자가 보는 뉴스 위젯은 3-tier fallback의 **`fallback` 단계**만 계속 노출.

### 1-2. 목표 (After)

**레이아웃 변경** — `app/page.module.css`와 `app/admin/page.tsx` 그리드를 2-영역으로 재구성:

```
┌─────────────────────────────┬──────────────┐
│  Main (col-span-8 / 8-col)  │  Sidebar     │
│  • Hero                     │  (col-span-4 │
│  • 서비스 상태 4-카드       │   /sticky)   │
│  • 티커 스트립              │              │
│  • 오늘의 고래 브리핑       │  • News      │
│  • 감지된 시그널            │    (feed)    │
│  • 고래 스토리              │  • 큐레이션  │
│  • 운영 로그                │    감시지갑  │
│                             │  • 텔레그램  │
│                             │    CTA       │
└─────────────────────────────┴──────────────┘
```

- 사이드바는 `position: sticky; top: var(--inset-navbar); max-height: calc(100vh - var(--inset-navbar)); overflow-y: auto;`로 독립 스크롤.
- 모바일(≤1024px)에서는 사이드바가 메인 하단으로 이동 (`flex-direction: column`).
- 우측 사이드바 폭은 320~360px 고정, 메인은 가변.

**뉴스 원천 크론 신설** — 새 워크플로 `.github/workflows/news_rss.yml` 추가:

```yaml
name: News RSS Ingest
on:
  schedule:
    - cron: "*/30 * * * *"   # 30분 주기
  workflow_dispatch:
concurrency:
  group: news-rss
  cancel-in-progress: true
jobs:
  ingest:
    runs-on: ubuntu-latest
    timeout-minutes: 3
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with: { python-version: "3.11", cache: "pip" }
      - run: pip install -r requirements.txt
      - env:
          GOOGLE_SHEET_ID: ${{ secrets.GOOGLE_SHEET_ID }}
          GOOGLE_CREDENTIALS_JSON: ${{ secrets.GOOGLE_CREDENTIALS_JSON }}
        run: python -m src.ingestion.news_rss
```

근거:
- `news_rss.py::main()`은 `load_listener_config()`로 Sheets를 초기화하고 `append_news_feed()`로 upsert하며, 비용 없음(HTTP만, LLM 미사용).
- 3개 피드 × 8 엔트리 × 30분 = 시간당 최대 48행, 일 ~1,150행. Sheets append 제한 대비 안전.
- `entry_id = sha256(source|url|title|published_at)[:16]`로 중복 방지 확보.

### 1-3. Before / After / Why

| Before | After | Why |
|---|---|---|
| 메인 그리드 안에 뉴스·큐레이션이 섞여 스크롤 공해 | 우측 sticky 사이드바로 분리 | 고래 브리핑/시그널(주요 소비 영역)과 "상시 정보"(뉴스/큐레이션)는 소비 리듬이 달라 레이아웃 관점에서도 분리되어야 함 |
| RSS 크론 없음 → `news_feed` 테이블 빈 상태 → fallback만 노출 | 30분 주기 전용 워크플로 | LLM 비용 0, HTTP만 사용하므로 주기를 조이는 것이 손실 없음 |
| RSS 실패 시 UI 단계에서만 3-tier fallback | 서버 측 cron 실패 감시(failure notification) 추가 | `workflow_dispatch` + GitHub Actions 실패 이메일로 빠른 감지 |

### 1-4. 검증 플랜

1. 새 워크플로 머지 후 30분 경과 → `news_feed` 시트 행 수 증가 확인.
2. `apps/dashboard/lib/news.ts`의 3-tier 로직이 1단계(`news_feed`)에서 정상 반환하는지 `/api/news` 응답의 `source` 필드 확인.
3. 사이드바 sticky 동작: Chrome DevTools로 페이지 스크롤 시 사이드바가 상단에 고정되는지 육안 검증.
4. `news_widget.tsx` 상단에 "마지막 갱신: YYYY.MM.DD HH:mm:ss" 추가로 체감 신선도 노출.

---

## §2. 실시간 티커 — 데이터소스 chip + 최종 갱신 타임스탬프

### 2-1. 현상 (Before)

`components/market-ticker-strip.tsx`:
- L274 `setNotice("Binance USD와 Upbit KRW를 조합해 김프를 계산 중입니다.")`
- L339 `setNotice("Upbit KRW와 USD 환산가를 조합해 김프를 계산 중입니다.")`

WebSocket `onmessage` 콜백마다 `setNotice()`를 호출 → 틱이 초당 2~5회 들어오면 공지 영역이 계속 깜빡임 → 사용자 피드백 "너무 빠르게 바뀜"의 원인.

### 2-2. 목표 (After)

**단일 notice → chip 3종 + 타임스탬프 1개로 교체.**

```tsx
// components/market-ticker-source-chips.tsx (신규)
<div className={styles.sourceChips} role="status" aria-live="polite">
  <DataSourceChip name="Upbit"   state={upbitState}   tooltip="업비트 KRW 실시간" />
  <DataSourceChip name="Binance" state={binanceState} tooltip="바이낸스 USD 실시간" />
  <DataSourceChip name="Kraken"  state={krakenState}  tooltip="크라켄 USD 폴백" />
  <DataSourceChip name="FX"      state={fxState}      tooltip="USD/KRW 환율" />
  <span className={styles.lastUpdated}>
    최종 업데이트 <time dateTime={lastTickIso}>{formatKstFull(lastTickIso)}</time>
  </span>
</div>
```

- Chip 상태: `connecting` (회색 펄스) / `live` (초록) / `stale` (노랑, 마지막 틱 > 15s) / `down` (빨강).
- `formatKstFull()`는 `Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", year, month, day, hour, minute, second, hour12: false })`를 조합하여 `2026.04.18 23:07:42` 포맷.
- `lastTickIso` 업데이트는 `useRef` + `requestAnimationFrame`으로 **초당 1회로 throttle**하여 리렌더 폭주 방지.
- 기존 `notice` 상태는 **에러/폴백 전용**으로만 남김 (예: "Binance 실시간 스트림이 닫혀 1분 후 재연결 시도" 같은 *이벤트* 메시지).

### 2-3. Before / After / Why

| Before | After | Why |
|---|---|---|
| `setNotice("…김프 계산 중입니다.")`를 WS 틱마다 호출 | Chip 상태 + 초당 throttled 타임스탬프 | notice는 "이벤트 알림"이어야 하는데 상시 상태 표시로 오용됨 → 역할 분리 |
| 연결 상태가 텍스트 문장 1줄로만 전달 | 소스별 chip 4개로 병렬 시각화 | 사용자가 한눈에 어느 소스가 끊겼는지 파악 가능 |
| 타임스탬프 부재 → 사용자가 "정말 실시간인가?" 의심 | 초 단위 KST 타임스탬프 | 신뢰는 "최근성의 증명"에서 나옴 — `aria-live="polite"`로 스크린리더에도 전달 |
| 중복 리렌더로 CPU 낭비 | RAF throttle | 모바일 저사양 기기에서 배터리 영향 최소화 |

### 2-4. 검증 플랜

1. 탭 유휴 후 복귀 시 chip 상태가 `connecting → live`로 회복되는지.
2. 의도적으로 `BINANCE_WS_HOST`를 블록 → `binance: live → down`으로 전이, `upbit: live` 유지 확인.
3. `prefers-reduced-motion: reduce`일 때 chip 펄스 애니메이션 정지.
4. Chrome Performance 탭에서 DOM mutation count가 기존 대비 90% 이상 감소.

---

## §3. 티커 카드 width 1.5× + 차트 모달 오버레이

### 3-1. 현상 (Before)

`components/market-ticker-strip.module.css`:

```css
.strip {
  display: grid;
  grid-template-columns: repeat(6, minmax(172px, 1fr));
  gap: var(--space-sm);
  overflow-x: auto;
}
.card { min-width: 172px; }
```

- 6열 × 최소 172px = 1032px + gap → 1180px 뷰포트에서 카드가 좁아 가격/변동률/차트 라벨이 `text-overflow: ellipsis`로 잘림.
- `components/market-detail-chart.tsx`에서 "차트보기" 토글 시 카드 내부에 in-place 확장 → 기존 6열 그리드 열을 밀어내며 레이아웃 깨짐.

### 3-2. 목표 (After)

**카드 폭 1.5×**:

```css
.strip {
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  /* 1440px 기준 ≈ 4~5열, 1024px ≈ 3열, 640px ≈ 2열, 375px ≈ 1열 */
}
.card { min-width: 280px; }
```

- `repeat(auto-fill, minmax(280px, 1fr))`로 뷰포트 폭에 따라 자동 열 수 조정.
- 1440px 데스크탑에서 4열로 4개 상단 + 2개 하단(또는 스크롤), 모바일에서 1열.

**차트보기 → 모달 오버레이 승격**:

- `MarketDetailChart`를 카드 내부에서 제거, 카드 푸터 "차트보기" 버튼 → 모달 트리거.
- 새 컴포넌트 `components/market-detail-chart-modal.tsx`:
  - 구조는 `telegram-connect-modal.tsx`와 동일(focus trap, `role="dialog"`, `aria-modal`, ESC 닫기).
  - 모달 내부에 **뷰 설정 툴바**:
    - 구간 선택: `1m / 5m / 1h / 1d` (radio group)
    - 가격 단위: `USD / KRW` toggle
    - 지표 레이어: `Volume on/off`, `MA20 on/off` (시즌 2 대상, v4 MVP는 스켈레톤만)
  - 모바일에서는 `position: fixed; inset: 0` + safe-area inset으로 full-screen.
  - 닫기 버튼은 우상단 + 하단 중앙 두 군데(썸존).

### 3-3. Before / After / Why

| Before | After | Why |
|---|---|---|
| `repeat(6, minmax(172px, 1fr))` 고정 6열 | `repeat(auto-fill, minmax(280px, 1fr))` 가변 | 뷰포트 폭과 정보 밀도를 일치 — 화면이 좁아지면 열 수가 줄어 카드 폭은 유지 |
| 차트보기 in-place 확장 → 그리드 밀림 | 모달 오버레이 | 그리드 레이아웃 vs 상세 뷰는 스케일이 달라 같은 DOM 트리에 공존 불가 |
| 모달 차트에 뷰 설정 없음 | 구간/단위/지표 툴바 | 피드백 "데이터 view 설정"을 1급 UX로 승격 |
| ESC/외부 클릭 닫기 없음 | focus trap + ESC + backdrop click | v3에서 이미 검증된 `telegram-connect-modal` 패턴 재사용 |

### 3-4. 검증 플랜

1. 1440 / 1180 / 1024 / 768 / 640 / 375 6개 브레이크포인트에서 카드 렌더 육안 확인.
2. 모달 열림 시 포커스가 첫 인터랙티브 요소로, 닫힘 시 트리거 버튼으로 복귀하는지.
3. 탭 순서: `close → 구간 토글 → 단위 토글 → 차트 영역` 순.
4. `prefers-reduced-motion: reduce`일 때 모달 페이드/스케일 애니메이션 없이 나타남.

---

## §4. 브리핑·시그널 크론 주기 최적화 + LLM 비용 상한

### 4-1. 현상 (Before)

`.github/workflows/daily_brief.yml`:
```yaml
on:
  schedule:
    - cron: "0 23 * * *"   # UTC 23:00 = KST 08:00, 1회/일
```

`python -m src.main` 단일 엔트리가 다음을 **한 번에** 처리:
- 고래 브리핑 생성(LLM 호출)
- 시그널 탐지(LLM 호출)
- 스토리 생성(LLM 호출)
- 큐레이션 지갑 잔고 갱신(RPC 호출)
- Telegram broadcast(`DRY_RUN=true`)

결과: 모든 패널이 "8시간 전 데이터"를 24시간 내내 보여줌.

### 4-2. 주기별 정책 설계

**작업별 특성 분류**:

| 작업 | LLM 필요? | 입력 신선도 요구 | 1회 비용(추정) | 제안 주기 |
|---|---|---|---|---|
| 고래 브리핑 (내러티브) | ✅ Sonnet | 중 (6h) | $0.02~0.05 | **8시간** (UTC 00/08/16) |
| 시그널 분류 | ✅ Haiku | 상 (15m) | $0.002~0.005 | **15분** |
| 스토리 생성 | ✅ Sonnet | 하 (24h) | $0.03~0.08 | **6시간** |
| 큐레이션 잔고 | ❌ RPC only | 상 (5~15m) | $0 | **15분** |
| 뉴스 RSS | ❌ HTTP | 상 (30m) | $0 | **30분** (§1에서 분리) |
| Telegram broadcast | ❌ (브리핑 재사용) | 브리핑 의존 | $0 | **브리핑 성공 훅** |

**월간 LLM 비용 추정**:

- 시그널(Haiku, 입력 1.5K/출력 300 토큰 가정): 24h × 4 × 30 = 2,880회/월 × (1.5K × $0.80 + 0.3K × $4) / 1M ≈ **$6.9/월**
- 브리핑(Sonnet, 입력 4K/출력 800 토큰): 3 × 30 = 90회/월 × (4K × $3 + 0.8K × $15) / 1M ≈ **$2.2/월**
- 스토리(Sonnet, 입력 6K/출력 1.2K): 4 × 30 = 120회/월 × (6K × $3 + 1.2K × $15) / 1M ≈ **$4.3/월**

**합계 ≈ $13.4/월**. 상한 `$15` 설정 시 여유 12%.

**비용 가드레일 구현**:

- `src/router/budget.py` (신규): 월별 누적 토큰량 Sheets `llm_budget_log` 탭에 기록.
- 상한 초과 시 `budget_exceeded` 예외 → 브리핑/스토리는 skip, 시그널만 최소 유지.
- 매월 1일 KST 00:00에 리셋.
- `budget_exceeded` 발생 시 Telegram broadcast_log에 `kind="budget_warn"` 행 append, 관리자 1회 알림.

### 4-3. 워크플로 재구성

`.github/workflows/daily_brief.yml` → 3개로 분리:

**(a) `signals.yml`** — 15분 주기, Haiku만:
```yaml
on:
  schedule: [{ cron: "*/15 * * * *" }]
jobs:
  signals:
    runs-on: ubuntu-latest
    timeout-minutes: 4
    steps:
      - ...체크아웃·파이썬·pip...
      - env: { ANTHROPIC_API_KEY: ..., GOOGLE_SHEET_ID: ..., ... }
        run: python -m src.pipeline.signals
```

**(b) `brief.yml`** — 8시간 주기:
```yaml
on:
  schedule:
    - cron: "0 0,8,16 * * *"   # UTC 00/08/16 = KST 09/17/01
  workflow_dispatch:
jobs:
  brief:
    runs-on: ubuntu-latest
    timeout-minutes: 8
    steps:
      - ...
      - run: python -m src.pipeline.brief
```

**(c) `stories.yml`** — 6시간 주기:
```yaml
on:
  schedule: [{ cron: "30 2,8,14,20 * * *" }]
jobs:
  stories: { ...python -m src.pipeline.stories... }
```

**이점**:
- 각 파이프라인이 독립 실패하므로 시그널 타임아웃이 브리핑을 막지 않음.
- `concurrency.group`을 분리해 동시 실행 방지.
- GitHub Actions 무료 한도 2,000분/월 대비 사용량: 시그널 4분 × 96 + 브리핑 8분 × 3 + 스토리 5분 × 4 = 약 **413분/월** (21%).

### 4-4. Before / After / Why

| Before | After | Why |
|---|---|---|
| 1회/일 단일 파이프라인 | 3개 워크플로 + 주기별 분할 | 시그널과 브리핑의 신선도 요구가 다름 — 비용 최적은 작업별 주기 |
| 비용 상한 없음 | `llm_budget_log` + 월 $15 guard | LLM 비용 폭주 방지 + 투명성 |
| 에러 격리 없음 | 워크플로별 concurrency group | 한 작업 실패가 다른 작업을 막지 않음 |
| 예산 초과 감지 수단 없음 | broadcast_log `kind="budget_warn"` | 운영자가 능동 대응 가능 |

### 4-5. 검증 플랜

1. 15분 주기로 시그널 워크플로가 실행되는지 1시간 모니터링 후 actions 로그 4건 확인.
2. 의도적으로 Anthropic API 키 무효화 → 시그널 실패해도 브리핑은 영향 없는지.
3. `llm_budget_log`에 호출마다 입력/출력 토큰이 기록되는지.
4. 월초 리셋 로직 단위 테스트(`tests/test_llm_budget.py`).

---

## §5. 큐레이션 감시지갑·고래 스토리 크론 주기

### 5-1. 현상

§4와 동일하게 1회/일 파이프라인에 묶여 있음. 사용자 피드백: "4번과 같은 내용".

### 5-2. 분리 방침

**큐레이션 감시지갑 (LLM 미사용)**:
- `src/ingestion/curated_balance_refresh.py` (신규):
  - `curated_wallets` 테이블에서 `is_active=TRUE` 지갑 조회
  - 각 지갑 체인별 온체인 RPC 호출(Etherscan, Solscan, BTC RPC, …)로 현재 잔고 조회
  - Sheets `curated_wallet_balances` 탭 upsert(신규 탭, 스키마: `wallet_id, chain, address, balance_native, balance_usd, queried_at`)
- **주기: 15분** — 비용 0, 고래 이동 감지 대비 빠른 반응 필요.
- 워크플로: `.github/workflows/curated_balance.yml` (`*/15 * * * *`)

**고래 스토리 (LLM 사용)**:
- `src/pipeline/stories.py`로 별도 파이프라인화 (§4에서 이미 언급).
- 입력: 최근 24h `whale_transactions` + `curated_wallet_balances` 델타.
- Sonnet 호출로 내러티브 생성.
- **주기: 6시간** — 스토리텔링은 실시간성보다 응집력이 중요, 6h가 합리적 타협.

### 5-3. Before / After / Why

| Before | After | Why |
|---|---|---|
| 잔고 갱신이 일 1회 → 감시 지갑 이동 최대 24h 지연 감지 | 15분 주기 | 고래 지갑 이동은 분 단위 사건, 일 주기는 상품 가치 훼손 |
| 스토리가 브리핑과 같은 파이프라인에 묶여 실패 전파 | 독립 워크플로 | 스토리는 실패해도 브리핑은 전달 가능해야 함 |

---

## §6. Telegram 채널 브로드캐스트 — 봇 admin 승격 + 크론 로직

### 6-1. 현상

- `.env.example` L39~44: `TELEGRAM_BROADCAST_ENABLED=false`, `TELEGRAM_BROADCAST_DRY_RUN=true`, `TELEGRAM_BROADCAST_CHAT=@whalescope_alertz`.
- `src/notify/telegram_broadcast.py::broadcast_text()`:
  - 상태 기계 5종: `skipped_empty / skipped_disabled / skipped_unconfigured / dry_run / sent / failed`.
  - API: `POST /bot<TOKEN>/sendMessage` with `parse_mode=HTML`.
  - `broadcast_log` 시트에 모든 시도 기록.
- **현재 상태**: 봇(@whalescope_demo_bot)이 채널(@whalescope_alertz)에 **미입장** → `sendMessage` 시 Telegram은 `Bad Request: chat not found` 또는 `Forbidden: bot is not a member of the channel chat` 반환.

### 6-2. 목표

**A. 봇 admin 승격 런북** (`/docs/ops/telegram-broadcast-onboarding.md`로 산출물화):

```
1. Telegram 모바일 앱에서 @whalescope_alertz 채널 열기
2. 채널 프로필 → Administrators → Add Admin
3. 검색: whalescope_demo_bot → 선택
4. 권한 체크: ✅ Post Messages (다른 권한은 모두 해제)
5. Save → 채널 멤버 리스트에 봇 표시 확인
6. 검증: DM으로 봇에 `/chatid @whalescope_alertz` 또는 직접 getChat API 호출
   GET https://api.telegram.org/bot<TOKEN>/getChat?chat_id=@whalescope_alertz
   → 응답 200 + chat 오브젝트 = 봇 admin 확인
```

**B. 단계적 활성화 (Dry-run → Shadow → Live)**:

| 단계 | ENABLED | DRY_RUN | 동작 | 기간 |
|---|---|---|---|---|
| Dry-run | false | - | `skipped_disabled` 로깅만 | 현재 |
| Shadow | true | true | 메시지 빌드 + `dry_run` 로깅 (발송 X) | 1주 |
| Live | true | false | 실제 `sendMessage` | 이후 |

`TELEGRAM_BROADCAST_ENABLED=true`로 전환하기 전 Shadow 1주 동안:
- `broadcast_log`에서 `kind="daily_brief"` 행들이 정상 `status="dry_run"`으로 기록되는지
- `_build_daily_brief_message()`가 Telegram HTML 제한(<b/>,<i/>,<a/>,<code/>,<pre/> 외 제거) 위반 없는지

**C. 크론 통합**:

- **브리핑 broadcast**: §4 `brief.yml` 파이프라인 말미에서 `broadcast_daily_brief()` 호출. 실패해도 exit 0(broadcast는 보조 채널).
  - 단, 이미 8h 주기로 돌리면 하루 3회 broadcast → 과함.
  - **개선**: 브리핑 생성은 8h 주기지만 **broadcast는 1일 1회 (KST 09:00, UTC 00:00 실행분만)** 으로 제한.
  - 구현: `src/pipeline/brief.py`에 `now_kst.hour == 9` 가드, 또는 별도 `.github/workflows/broadcast_daily.yml` 신설.
- **긴급 시그널 broadcast** (선택): 특정 시그널이 tier=1 & usd_volume > $50M 이면 즉시 `broadcast_text(kind="urgent_signal", ...)`. `broadcast_log`의 dedup_key는 `urgent_signal:{signal_id}`로 1회 한정.

**D. 구독자 수 모니터링**:
- `getChatMemberCount`를 별도 워크플로 `.github/workflows/channel_health.yml` (일 1회)로 호출 → `channel_health` 시트에 `date, subscribers, subscribers_delta` 기록.
- 대시보드 서비스 상태 4-카드 중 1개를 이 데이터로 교체 가능.

### 6-3. Before / After / Why

| Before | After | Why |
|---|---|---|
| 봇 채널 미입장 → `sent` 불가 | 봇 admin 승격 런북 문서화 + Shadow 1주 | 실수로 Live 전환 시 프로덕션 채널에 디버그 메시지 → Shadow로 1주 검증 필요 |
| 브리핑 8h 주기이나 broadcast 정책 없음 | 브리핑은 8h 생성, broadcast는 1일 1회 | 구독자 피로도 방지 + 브리핑 품질 검증 시간 확보 |
| 긴급 이동 시 알림 없음 | urgent_signal broadcast + dedup_key | 상품 차별화 요소(타사 대비 실시간) |
| 채널 구독자 수 추적 없음 | `channel_health` 시트 | 마케팅 의사결정 근거 |

### 6-4. 검증 플랜

1. Shadow 1주 동안 `broadcast_log`에서 `status="dry_run"` 행이 일 1~3회 정상 기록.
2. `_build_daily_brief_message()` 출력을 `@whalescope_demo_bot` DM으로 수동 테스트 → 렌더 확인.
3. `ENABLED=true` 전환 직후 `status="sent"` 1건 기록되고 실제 채널에 포스트.
4. 의도적으로 메시지 3,900자 초과 작성 → `_clip_message()`가 `…(truncated)` 말꼬리 추가 확인.

---

## §7. 모바일 반응형 — 전 컴포넌트 감사 + 전략 수립

### 7-1. 현상

`app/page.module.css`의 반응형 규칙:
- `max-width: 1180px`: service grid 4→2, col-span 8/4 → 12
- `max-width: 860px`: service grid → 1, 패딩 축소
- `max-width: 640px`: hero 축소, 타이틀 다운사이즈

그러나:
- `market-ticker-strip.module.css`: `max-width: 640px`만 고려 (L385), 이외 브레이크포인트 없음.
- `telegram-connect-modal.module.css`: L248~252에서 모달 2-col → 1-col(640px 미만).
- `brief-panel.module.css`: 263~286에 2개 브레이크포인트.
- 일관되지 않고, 375px(iPhone SE) 타깃 명시 없음.

### 7-2. 목표 — 브레이크포인트 표준화

**v4 공통 브레이크포인트** (`apps/dashboard/styles/tokens.css` 또는 별도 `breakpoints.css`에 CSS custom media로 토큰화):

| 토큰 | min-width | 주요 레이아웃 변화 |
|---|---|---|
| `--bp-xs` | 375px | iPhone SE; 카드 1열, hero 축소, bottom-thumb-zone 보호 |
| `--bp-sm` | 640px | 카드 2열, 모달 stacked → 2-col 전환 |
| `--bp-md` | 1024px | 사이드바 등장, 카드 3열, 폰트 1단 업 |
| `--bp-lg` | 1280px | 카드 4열, 풀 대시보드 |
| `--bp-xl` | 1536px | 카드 5열 (선택) |

### 7-3. 컴포넌트별 변환 맵

| 컴포넌트 | xs (≤640) | sm (640~1024) | md (1024~1280) | lg (≥1280) |
|---|---|---|---|---|
| 메인 그리드 | 단일 컬럼, 사이드바는 하단 | 단일 컬럼 | 8+4 사이드바 | 8+4 sticky |
| 티커 카드 | 1열 `280px` | 2열 | 3열 | 4열 |
| 서비스 4-카드 | 1열 | 2열 | 4열 | 4열 |
| 텔레그램 모달 | full-screen stacked | 2-col | 2-col | 2-col |
| 차트 모달 (신규) | full-screen | 90vw × 80vh | 1024px fixed | 1024px fixed |
| 뉴스 사이드바 | 메인 하단, 스크롤 | 메인 하단 | 우측 sticky 320px | 우측 sticky 360px |
| 뉴스 카드 | 1열, 썸네일 우측 60px | 1열 | 1열 | 1열 |
| 브리핑 two-col | 1열 | 1열 | 2열 | 2열 |
| CTA 버튼 | 썸존 고정(`position: sticky; bottom: 0` + safe-area) | 인라인 | 인라인 | 인라인 |

### 7-4. 모바일-특화 원칙

1. **썸존 (Thumb zone)**: 주요 액션(텔레그램 연결, 차트보기 닫기, 필터 적용)은 화면 하단 1/3에 배치.
2. **안전영역**: `padding: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)`를 `body` 또는 최상위 레이아웃에.
3. **터치 타겟**: 모든 버튼·링크 최소 44×44px (iOS HIG).
4. **호버 의존 금지**: `@media (hover: hover) and (pointer: fine)`로 감싸고, 모바일은 영구 표시 또는 탭으로 대체.
5. **가로 스크롤 금지**: 티커 스트립의 `overflow-x: auto`는 데스크탑 전용, 모바일에선 세로 스택.
6. **폰트 사이즈**: 본문 최소 16px (iOS 자동 zoom 방지).
7. **모션 축소**: 모든 `@keyframes` 사용에 `@media (prefers-reduced-motion: reduce)` 가드.

### 7-5. 검증 플랜

1. Chrome DevTools Device Toolbar로 375 / 414 / 640 / 768 / 1024 / 1280 / 1440 7개 프리셋 전수 검증.
2. Lighthouse Mobile 감사: Performance ≥ 80, Accessibility ≥ 95, Best Practices ≥ 95.
3. iOS Safari 실기기(iPhone 14)에서 safe-area 렌더 확인 (notch + bottom bar).
4. 가로 스크롤바가 xs/sm에서 나타나지 않는지.
5. `prefers-reduced-motion: reduce` 시 모든 애니메이션 정지 확인.

---

## §8. 롤아웃 로드맵 (W1 ~ W5)

| 주차 | 범위 | 주요 산출물 | DoD |
|---|---|---|---|
| **W1 (4/21~4/27)** | §1 뉴스 사이드바 + RSS 크론 | `page.module.css` 그리드 개편, `news_rss.yml` 신설, `news-widget.tsx` 상단 타임스탬프 | `news_feed` 시트에 24h 내 30+ 행 증가 + 사이드바 sticky 동작 |
| **W2 (4/28~5/4)** | §2 chip + §3 카드 width/모달 | `market-ticker-source-chips.tsx`, `market-detail-chart-modal.tsx`, 그리드 `auto-fill 280px` | Lighthouse 모바일 CLS ≤ 0.05, 모달 a11y tab-order 검증 |
| **W3 (5/5~5/11)** | §4 크론 분리 + LLM 예산 | `signals.yml` / `brief.yml` / `stories.yml`, `src/router/budget.py`, `llm_budget_log` 탭 | 주기별 워크플로 각 10회 이상 성공, 월 비용 $15 이하 |
| **W4 (5/12~5/18)** | §5 큐레이션 15m + §6 Telegram Shadow | `curated_balance.yml`, `docs/ops/telegram-broadcast-onboarding.md`, Shadow 7일 운영 | Shadow 7일 동안 `broadcast_log dry_run` 행 7~21개, 메시지 렌더 육안 합격 |
| **W5 (5/19~5/25)** | §6 Telegram Live + §7 모바일 감사 | `TELEGRAM_BROADCAST_ENABLED=true` 전환, 7개 브레이크포인트 전수 QA | `broadcast_log sent ≥ 1/일`, iOS Safari 실기기 합격 |

---

## §9. 리스크 레지스터

| ID | 리스크 | 영향 | 완화책 |
|---|---|---|---|
| R1 | RSS 피드 사업자 측 레이트 리밋 | 뉴스 갱신 중단 | 30분 주기 고정 + `timeout=20s` + 피드 단위 에러 격리(`news_rss.py` L112~118 이미 구현) |
| R2 | LLM 비용 $15 초과 | 서비스 비용 증가 | `llm_budget_log` guard + `budget_warn` 알림 + 시그널부터 우선 중단 |
| R3 | 봇 admin 승격 실수로 과잉 권한 부여 | 채널 악의적 편집 | `Post Messages`만 허용, 다른 권한(`Delete Messages`, `Edit Messages of Others` 등) 비활성 명시 |
| R4 | 15분 주기 ingest로 Google Sheets API 쿼터(300/min) 초과 | ingest 실패 | 배치 upsert + `values.batchUpdate` 사용 + exponential backoff |
| R5 | 모바일 full-screen 모달 iOS 입력 시 뷰포트 jump | 사용성 저하 | `interactive-widget=resizes-content` meta + `inputmode` 적절 설정 |
| R6 | Shadow 전환 시 `DRY_RUN`이 실수로 false | 프로덕션 채널 유출 | PR 리뷰 체크리스트에 `.env` diff 확인 강제 |
| R7 | 긴급 시그널 broadcast의 dedup_key 충돌 | 중복 발송 | dedup_key 포맷 `urgent_signal:{yyyymmdd}:{signal_id}` + broadcast_log 조회 후 append |
| R8 | 카드 폭 280px에서 모든 locale에서 가격 잘림 | 정보 손실 | USD/KRW 가격 `tabular-nums` + 8자리 이상은 ellipsis 대신 축약(`$1.23M`) |

---

## §10. 오픈 퀘스천 (사용자 확인 필요)

1. **Telegram 채널 구독자 수 목표**: v4 완료 시점 목표치? (마케팅 예산과 연관)
2. **LLM 비용 상한**: $15/월이 합리적인가? 더 타이트하게 $10으로 갈 것인가?
3. **긴급 시그널 임계치**: USD $50M 이상 + tier=1 조건이 적절한가? 사용자 피드백 기반 튜닝 필요.
4. **모바일 차트 모달 full-screen 범위**: 640px 미만 vs 768px 미만 중 선호?
5. **RSS 피드 확장**: CoinDesk/Cointelegraph/Decrypt 3종 외 TheBlock, Bankless 등 추가 의향?
6. **브리핑 broadcast 시간대**: KST 09:00 1회 vs 09:00 + 21:00 2회 중 선호?
7. **예산 초과 시 정책**: `budget_exceeded` 시 시그널만 유지 vs 전 LLM 파이프라인 중단 중 어느 쪽?

---

## §11. 파일 변경 예상 목록

### 신규 파일

```
.github/workflows/news_rss.yml
.github/workflows/signals.yml
.github/workflows/brief.yml
.github/workflows/stories.yml
.github/workflows/curated_balance.yml
.github/workflows/channel_health.yml
src/pipeline/signals.py
src/pipeline/brief.py
src/pipeline/stories.py
src/pipeline/broadcast_daily.py
src/ingestion/curated_balance_refresh.py
src/router/budget.py
tests/test_llm_budget.py
tests/test_curated_balance_refresh.py
apps/dashboard/components/market-ticker-source-chips.tsx
apps/dashboard/components/market-ticker-source-chips.module.css
apps/dashboard/components/market-detail-chart-modal.tsx
apps/dashboard/components/market-detail-chart-modal.module.css
apps/dashboard/styles/breakpoints.css
docs/ops/telegram-broadcast-onboarding.md
```

### 수정 파일

```
apps/dashboard/app/page.module.css          (§1 그리드 개편, §7 브레이크포인트)
apps/dashboard/app/admin/page.tsx           (§1 사이드바 JSX 재구성)
apps/dashboard/components/market-ticker-strip.tsx         (§2 notice → chip, §3 카드→모달 트리거)
apps/dashboard/components/market-ticker-strip.module.css  (§3 auto-fill 280px)
apps/dashboard/components/news-widget.tsx                 (§1 타임스탬프 헤더)
apps/dashboard/components/telegram-connect-modal.module.css (§7 모바일 감사)
src/main.py                                  (§4 파이프라인 분리로 빈 껍데기화 또는 deprecation 주석)
.env.example                                 (§6 운영 런북 링크 추가)
```

### 삭제/대체

```
.github/workflows/daily_brief.yml            (§4 signals/brief/stories로 분리 후 삭제)
```

---

## §12. 부록 — LLM 가격 참고 (2026년 4월 기준, $/1M 토큰)

| 모델 | Input | Output | 비고 |
|---|---|---|---|
| Claude Haiku 4.5 | $0.80 | $4.00 | 시그널 분류용, 최저가 |
| Claude Sonnet 4.6 | $3.00 | $15.00 | 브리핑/스토리 기본 |
| Claude Opus 4.6 | $15.00 | $75.00 | v4에서는 미사용 (비용 초과) |
| Gemini 2.0 Flash | $0.10 | $0.40 | Haiku 폴백 후보 |
| Groq Llama 3.3 70B | $0.59 | $0.79 | 긴급 폴백 후보 |

**정책**: Haiku를 1차, Sonnet을 2차, 예산 초과 시 Gemini Flash로 폴백. `src/router/` 기존 구현 재사용 가능.

---

## §13. 다음 세션 이어가기 가이드

다음 세션에서 이 문서로 복원할 때:
- **W1 착수 시작점**: `apps/dashboard/app/page.module.css` 그리드를 읽고 §1-2 레이아웃 다이어그램에 맞게 재구성.
- **RSS 크론 추가**: `.github/workflows/news_rss.yml` 신설 → 첫 머지 후 30분 내 시트 행 증가 확인.
- **이전 v3 QA 보고서의 잔여 리스크 5종**은 이 v4 문서의 §2, §3, §4, §6, §7에 각각 매핑되어 해결 경로 확보.

---

## 복원 컨텍스트

> 다음 세션에서 이 노트를 읽으면 아래 내용만으로 v4 작업을 이어갈 수 있어야 합니다.

WhaleScope v3 구현은 인증·데이터소스·차트 기반까지 완료됐고, QA 종합보고서([[2026-04-18-11-WhaleScope-유저홈-v3-구현-QA-코드리뷰-종합보고서]])의 §3.1~§13.5 모든 항목이 코드와 일치함이 검증됐다. 다만 "실제 운영 신선도"와 "모바일 UX"가 v3 설계 범위를 벗어나, v4에서 이를 다룬다. 사용자 7개 피드백은 모두 아래 카테고리로 귀결된다:

- **UX 구조(§1, §3, §7)**: 뉴스·큐레이션의 사이드바 분리, 티커 카드 폭 확대, 차트 모달 승격, 모바일 반응형.
- **실시간성(§2, §4, §5)**: chip+타임스탬프로 상태 표시, 크론 주기 세분화(15m/6h/8h), LLM 월 $15 상한.
- **전달 채널(§6)**: Telegram 봇을 채널 admin으로 승격 + Shadow 1주 → Live 전환.

v4 롤아웃은 5주차(W1~W5)로 나누고, 각 주차는 독립 배포 가능한 단위. 위험 요인은 §9 레지스터에 8종 정리, 사용자 결정 필요한 7개 오픈 퀘스천은 §10에 정리되어 있다.
