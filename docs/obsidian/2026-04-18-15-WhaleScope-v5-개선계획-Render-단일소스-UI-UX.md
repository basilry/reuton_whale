---
type: project-plan
project: WhaleScope
version: v5
date: 2026-04-18
sequence: 15
time: "14:30"
status: draft
tags:
  - whalescope
  - improvement-plan
  - render
  - orchestrator
  - ui-ux
  - v5
related:
  - "[[2026-04-18-14-WhaleScope-v4-정합성-브리핑-Render-GHA-중복-분석]]"
  - "[[2026-04-18-13-WhaleScope-유저홈-v4-구현-QA-코드리뷰-종합보고서]]"
  - "[[2026-04-18-08-WhaleScope-Render-워커-웹서버-배포가이드]]"
---

# WhaleScope v5 개선계획 — Render 단일 소스 전환 & 유저홈 UI/UX 개선

## §0. 문서 위치

- v3 QA 보고서 → v4 구현 보고서 → **v4 정합성 브리핑(문서 14)** → **v5 개선계획(본 문서)**
- v4 정합성 브리핑은 “Render × GHA 중복 실행” 문제를 진단하고 Option A(Render 파이프라인 일시정지)를 권고했으나, 본 문서는 사용자 의도에 따라 **반대 방향(Option C: Render 단일화 + GHA는 수동 재실행 전용)**으로 확정한다.

---

## §1. 요약 (TL;DR)

### 1.1 방향 전환 결정
- **기존 가정**(문서 14): Render 파이프라인은 legacy, GHA 7종이 production. Render는 suspend 권고.
- **변경 가정**(본 문서, 사용자 지시): Render cron 서비스(`whalescope-pipeline`)가 **모든 데이터 취합을 단독 수행**. GHA는 수동 재실행(workflow_dispatch) 전용.
- 근거: 사용자 발화 — *"render에 cron 서비스로 올린 부분에서 알아서 다 데이터 취합을 하면 좋겠다"*.

### 1.2 핵심 진단
사용자 의도(“Render가 알아서 다 취합”)는 **현재 코드에 반영되어 있지 않다**. 증거:

| 기대 동작 | 현재 `src/main.py` 상태 | 확인 위치 |
|---|---|---|
| 시그널 탐지 | ✅ Stage 5 (`SignalEngine`) | `src/main.py:Stage 5` |
| Daily brief (LLM) | ⚠️ Stage 8에서 실행되나 **MonthlyBudgetGuard 미통과** | `src/main.py` + `src/router/budget.py` |
| Stories (6h) | ❌ 호출 없음 | — |
| News RSS (30m) | ❌ 호출 없음 | — |
| Curated wallet balance refresh (15m) | ❌ 호출 없음 | — |
| Channel health (일 1회) | ❌ 호출 없음 | — |
| Broadcast daily KST 09:00 게이트 | ❌ 항상 broadcast_once 호출, 시간 게이트 없음 | — |
| `MonthlyBudgetGuard` ($15 상한) | ❌ Stage 8/9/10 어디에서도 `precheck/commit` 호출 없음 | `src/router/budget.py` 존재하지만 `src/main.py`에서 import 안 됨 |

즉 **Render에 올라간 `python -m src.main`은 v3 수준의 파이프라인**이며, v4에서 신설된 6개 서브파이프라인(`src.pipeline.{signals,brief,stories,broadcast_daily,channel_health,common}` + `curated_balance_refresh` + `news_rss`)을 호출하지 않는다. 이 상태로는 Render만 켜면 v4 기능이 사라진다.

### 1.3 본 문서가 다루는 것
1. **Render 단일 소스 전환 (§2)**: 새 오케스트레이터 `src.pipeline.run_all` 신설. 시간 인식(time-aware) 디스패치로 v4의 모든 cadence 보존.
2. **유저홈 UI/UX 6개 개선 (§3)**: 좌측 사이드바에 시장 티커 링크 추가, 모바일에서 시장 티커·뉴스 카드를 2개+펼치기로 축약, 차트 상세 모달을 전체 뷰포트 사용(포털 전환), 모바일에서 “지능형 분석 작동 방식” 아이콘 2×2 그리드 + 점선 제거, 텔레그램 섹션을 채널 전용(QR 포함)으로 단순화.
3. **작업 분해 (§4)**: T1~T11 우선순위 P0~P2.

### 1.4 성공 기준
- Render 파이프라인만 켜둔 상태에서 24시간 관찰 시, Sheets `llm_budget_log`/`signals`/`brief`/`stories`/`curated_wallet_balances`/`channel_health` 모두 기록이 쌓인다.
- GHA는 모두 `workflow_dispatch`-only로 전환. 스케줄 cron은 비활성화.
- 모바일(393px) 유저홈에서 한 화면에 보이는 “시장 티커”·“뉴스”·“지능형 분석”·“텔레그램 CTA”가 각각 1스크롤 이내에 배치된다.
- 시장 티커 카드의 “차트 상세” 모달이 항상 브라우저 뷰포트 전체를 기준으로 중앙 정렬된다(어디서 열어도 동일).

---

## §2. Render 단일 소스 전환

### 2.1 진단 (상세)

#### 2.1.1 현행 `src/main.py` 구조 (619 lines, v3 레벨)
```
Stage 1  load_config()
Stage 2  init clients (Etherscan, Solscan, Telethon, TelegramBroadcastAdapter, OpenAI, Sheets)
Stage 3  collect_events()           # etherscan + solscan + tg_normalizer
Stage 4  enrich_with_market()       # Coingecko/Coinglass/Upbit
Stage 5  SignalEngine.detect()      # v4 모듈 — OK
Stage 6  legacy filter fallback
Stage 7  legacy analyze fallback
Stage 8  generate_daily_brief()     # LLM 호출 — 예산 가드 없음
Stage 9  store_to_sheets()
Stage 10 broadcast_once()           # KST 09:00 게이트 없음
```

문제:
- **v4 서브파이프라인 미호출**: `src.pipeline.stories.run_pipeline()`, `src.pipeline.broadcast_daily.run_broadcast_daily()`, `src.pipeline.channel_health.run_channel_health()`, `src.ingestion.news_rss.*`, `src.ingestion.curated_balance_refresh.run_refresh()` — 어느 것도 `src/main.py`에서 import되지 않음.
- **예산 가드 미적용**: `src/router/budget.py::MonthlyBudgetGuard` ($15 월 상한, `billable_pipelines=("brief","stories")`) 존재하지만 `src/main.py::generate_daily_brief()`가 직접 `llm_router.complete(...)` 호출. precheck/commit 루프 없음. Sheets `llm_budget_log` 쓰기도 없음.
- **KST 게이트 없음**: Stage 10에서 무조건 broadcast. Render cron이 6시간마다 돌면 **하루 4번 방송**된다.
- **중복 방송 위험**: GHA `broadcast_daily.yml`이 동시 활성이면 하루 5번까지 방송 가능.

#### 2.1.2 근본 원인
v4 개발 시 **개별 서브파이프라인을 GHA 워크플로 단위로 격리**하고, 각 workflow의 `python -m src.pipeline.<name>`을 엔트리로 삼았다. `src/main.py`는 legacy 유지 목적이었고 refactor가 지연됨. Render에 올릴 때 `python -m src.main`을 그대로 가져온 것이 원인.

### 2.2 해결 방안 — Option R1 (권고)

#### R1: 시간 인식(time-aware) 디스패처, `*/15 * * * *`
```python
# src/pipeline/run_all.py  (신설)
"""
Render 단일 진입점. KST 기준으로 현재 분/시를 읽어 해당 cadence의 서브파이프라인만 실행.
MonthlyBudgetGuard는 billable 파이프라인(brief, stories)을 감싼다.
"""
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

from src.pipeline import signals, brief, stories, broadcast_daily, channel_health
from src.ingestion import news_rss, curated_balance_refresh
from src.router.budget import MonthlyBudgetGuard
from src.storage.sheets import SheetsClient

KST = ZoneInfo("Asia/Seoul")

def run_all() -> None:
    now_kst = datetime.now(timezone.utc).astimezone(KST)
    minute = now_kst.minute
    hour = now_kst.hour

    sheets = SheetsClient.from_env()
    guard = MonthlyBudgetGuard(sheets=sheets, cap_usd=15.0)

    # Every 15 min
    signals.run_pipeline()
    curated_balance_refresh.run_refresh()

    # Every 30 min (:00, :30)
    if minute % 30 == 0:
        news_rss.run_refresh()

    # Every 6 hours (00, 06, 12, 18 KST, minute=0)
    if hour % 6 == 0 and minute == 0:
        with guard.session(pipeline="stories") as session:
            stories.run_pipeline(session=session)

    # Every 8 hours (00, 08, 16 KST, minute=0)
    if hour % 8 == 0 and minute == 0:
        with guard.session(pipeline="brief") as session:
            brief.run_pipeline(session=session)

    # Daily broadcast — KST 09:00
    if hour == 9 and minute == 0:
        broadcast_daily.run_broadcast_daily()

    # Channel health — KST 09:15
    if hour == 9 and minute == 15:
        channel_health.run_channel_health()

if __name__ == "__main__":
    run_all()
```

Render `render.yaml` 변경:
```yaml
services:
  - type: cron
    name: whalescope-pipeline
    schedule: "*/15 * * * *"
    startCommand: "python -m src.pipeline.run_all"   # 기존: python -m src.main
```

`MonthlyBudgetGuard.session()` 컨텍스트 매니저는 기존에 없다면 신설:
```python
# src/router/budget.py 에 추가
@contextmanager
def session(self, *, pipeline: str):
    decision = self.precheck(pipeline=pipeline)
    if decision.status == "blocked":
        self._log_decision(pipeline, decision)
        yield _NullSession()       # 호출측이 no-op 처리
        return
    counter = _UsageCounter()
    try:
        yield counter
    finally:
        self.commit(pipeline=pipeline, tokens_in=counter.tokens_in,
                    tokens_out=counter.tokens_out, cost_usd=counter.cost_usd)
```
LLM 호출 측(`brief.run_pipeline`, `stories.run_pipeline`)은 `session.track(response)`로 토큰/비용 누적.

### 2.3 대안 — Option R2 (보조 권고 X)

R2: 단일 6시간 cron, 순차 실행
```yaml
schedule: "0 */6 * * *"
startCommand: "python -m src.pipeline.run_all_sequential"
```
- 장점: 로직 단순. MonthlyBudgetGuard도 한 번만 초기화.
- 단점: signals/curated_balance의 **15분 신선도 목표를 6시간으로 희생**. v4 QA에서 강조된 “실시간성”이 무너진다.
- 결론: **권장하지 않음**.

### 2.4 GHA 7 workflows 처리

| 파일 | 현재 | 변경 후 |
|---|---|---|
| `signals.yml` | `*/15 * * * *` | `on: workflow_dispatch` only |
| `brief.yml` | `0 */8 * * *` | `on: workflow_dispatch` only |
| `stories.yml` | `0 */6 * * *` | `on: workflow_dispatch` only |
| `news_rss.yml` | `*/30 * * * *` | `on: workflow_dispatch` only |
| `curated_balance.yml` | `*/15 * * * *` | `on: workflow_dispatch` only |
| `broadcast_daily.yml` | `0 0 * * *` (UTC=KST 09:00) | `on: workflow_dispatch` only |
| `channel_health.yml` | `15 0 * * *` | `on: workflow_dispatch` only |
| `daily_brief.yml` (legacy) | workflow_dispatch | **삭제** |

각 워크플로에 `FORCE_BROADCAST_DAILY=true` 등 로컬 override env를 주석으로 남겨, 장애 시 수동 재실행 가능.

### 2.5 트레이드오프 분석

| 기준 | Render 단일 (R1) | GHA 단일 (문서 14 Option A) | 혼용 현행 |
|---|---|---|---|
| 관측성 | Render 대시보드 1곳 | GHA Actions 탭 | 둘 다 봐야 함 (나쁨) |
| 장애 복구 | Render UI에서 수동 실행 + GHA dispatch | GHA dispatch | 혼선 |
| 예산 가드 적용 범위 | R1에서 `run_all`이 모든 LLM 경로 감쌈 | 각 workflow 개별 guard 필요 | 이중 계산 위험 |
| 실행 비용 | 단일 cron, 15분마다 lightweight | 7개 workflow 분산 | 중복 실행 = 중복 비용 |
| 코드 응집도 | 오케스트레이터 1곳에 cadence 명시 | workflow 파일 7개에 분산 | 진실의 원천 없음 |
| 배포 마찰 | `render.yaml` 1파일 수정 | GHA cron 문법 | 둘 다 |
| **결론** | **권고** | 보조안 | 즉시 해소 |

### 2.6 리스크

1. **Render cron 정확도**: `*/15 * * * *`는 UTC. KST 09:00 감지 로직은 Python 측에서 `ZoneInfo("Asia/Seoul")`로 처리 — 서버 타임존 의존 없음.
2. **단일 지점 장애(SPOF)**: Render cron이 실패하면 모든 파이프라인 중단. 완화 — GHA workflows를 `workflow_dispatch`로 보존 → 수동 fallback 가능.
3. **run_all 실행 시간 초과**: cron 간격 15분보다 길어지면 동시 실행 발생. 완화 — 각 서브파이프라인에 `timeout_seconds=600` 가드, `concurrency` 헤더 유지(`cancel-in-progress: true`는 Render cron에는 없으므로 파일 잠금으로 대체).
4. **MonthlyBudgetGuard 경합**: Sheets 기반 로그는 append-only지만 월 누적 합계는 읽기-쓰기 경합 가능. 완화 — `precheck`에서 `(month_key, pipeline)`별 row 읽기 시 전체 시트 스캔 1회 + LRU 캐시(5분).

---

## §3. 유저홈 UI/UX 개선 6개 항목

### 3.1 공통 원칙 (design-engineering Layer 2)
- **토큰 재사용**: 신규 색상/스페이싱 금지. 기존 `--inset-navbar`, `--space-*`, `styles.cardGrid` 재사용.
- **모바일 우선**: 393px(iPhone 14 Pro) 기준으로 설계하고 `@media (min-width: 768px)`에서 확장.
- **모션 예산**: 새 애니메이션은 opacity/transform만. `ease-in` 금지.
- **접근성**: 새 버튼은 `aria-expanded`, `aria-controls` 연결.

### 3.2 개선 #1 — 좌측 사이드바에 “시장 티커” 링크 추가

#### 현상
`apps/dashboard/components/insights-sidebar.tsx` `SIDEBAR_LINKS` 배열은 4개(브리핑·시그널·감시 지갑·텔레그램)로, 시장 티커 섹션에 대한 직접 이동 링크가 없다.

#### 해결
```tsx
// apps/dashboard/components/insights-sidebar.tsx
const SIDEBAR_LINKS = [
  { label: "브리핑", href: "#brief", icon: "article" },
  { label: "시장 티커", href: "#market-ticker", icon: "show_chart" }, // NEW
  { label: "시그널", href: "#signals", icon: "notifications" },
  { label: "감시 지갑", href: "#watchlist", icon: "visibility" },
  { label: "텔레그램", href: "#telegram", icon: "send" },
] as const;
```
- 순서 근거: 브리핑(서사) → 시장 티커(숫자 근거) → 시그널(파생 이벤트) → 감시 지갑(행위자) → 텔레그램(채널).
- 아이콘 `show_chart`: Material Symbols에 존재(확인 완료).
- 스크롤 스파이는 기존 `useEffect`의 `getElementById` 루프가 자동 처리(시장 티커 섹션 id가 `market-ticker`여야 함 — §3.3에서 지정).

#### 영향 범위
- `apps/dashboard/app/page.tsx`: 시장 티커 섹션을 감싸는 wrapper에 `id="market-ticker"` 추가.
- 다른 파일 변경 없음. 기존 스크롤 스파이 로직 재사용.

### 3.3 개선 #2 — 시장 티커 모바일 카드 수 축소 + 펼치기

#### 현상
- `apps/dashboard/components/market-ticker-strip.module.css:85` → `grid-template-columns: repeat(auto-fit, minmax(280px, 1fr))`. 모바일에서 1열로 접히며 **모든 카드를 세로로 나열** → 6개 × 카드 높이 ≈ 스크롤 과다.
- 데스크탑은 6장 노출 유지가 요구됨.

#### 해결
```css
/* market-ticker-strip.module.css */
.cardGrid {
  display: grid;
  gap: var(--space-sm);
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
}

/* Mobile: 기본 2장만 노출, 나머지는 data-collapsed="true"일 때 숨김 */
@media (max-width: 767px) {
  .cardGrid[data-collapsed="true"] .card:nth-child(n+3) {
    display: none;
  }
}
```

```tsx
// market-ticker-strip.tsx (발췌)
const [isExpanded, setIsExpanded] = useState(false);

// ...
<div
  className={styles.cardGrid}
  data-collapsed={!isExpanded || undefined}
>
  {items.map((item) => <Card key={item.asset} item={item} />)}
</div>
{items.length > 2 && (
  <button
    type="button"
    className={styles.expandButton}
    aria-expanded={isExpanded}
    aria-controls="market-ticker-grid"
    onClick={() => setIsExpanded((v) => !v)}
  >
    <span className="material-symbols-outlined" aria-hidden="true">
      {isExpanded ? "expand_less" : "expand_more"}
    </span>
    {isExpanded ? "접기" : `나머지 ${items.length - 2}개 보기`}
  </button>
)}
```
- 데스크탑(`min-width: 768px`)에서는 `data-collapsed`가 있어도 grid가 auto-fit으로 모두 노출 → CSS 분기 `@media` 안에서만 `display: none` 적용.
- `expandButton` 위치: 그리드 바로 아래, 섹션 내부(외부 컨테이너가 아님).
- 레이아웃 시프트 완화: 버튼 높이를 `min-height: 48px`로 고정하여 접기/펼치기 간 CLS 0.1 이하.

### 3.4 개선 #3 — 차트 상세 모달을 뷰포트 전체 기준으로 (**P0**, **근본 버그**)

#### 현상
- `market-ticker-strip.module.css:16`에 `backdrop-filter: blur(20px)`가 티커 strip wrapper에 적용되어 있다.
- **CSS 사양**: `backdrop-filter` (또는 `filter`, `transform`, `will-change: transform`, `contain: layout/paint` 등)가 설정된 조상은 `position: fixed` 자손에게 **containing block**이 된다. `fixed`는 해당 조상 기준으로 위치가 잡히고, **뷰포트 기준이 아니다**.
- `market-detail-chart-modal.tsx`는 `<div className={styles.backdrop}>` (`.backdrop { position: fixed; inset: 0; }`)을 DOM 트리 안에 직접 렌더 → 티커 strip 내부에 갇힌다. 결과: 모달이 티커 박스 안에 겹쳐 표시되어 잘림.
- 비교: 텔레그램 모달은 `page.tsx`의 `styles.telegramCta` 하위에 렌더되는데, 이 경로에는 `backdrop-filter`/`transform`을 가진 조상이 없어 정상 동작. 이는 구조적 일관성이 아닌 **우연한 정상 동작**이다.

#### 해결 (React portal)
```tsx
// market-detail-chart-modal.tsx
"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
// ... (기존 import)

export function MarketDetailChartModal({ definition, item, isOpen, onClose }: Props) {
  const [mounted, setMounted] = useState(false);
  // ... (기존 훅)

  useEffect(() => { setMounted(true); }, []);

  if (!mounted || !isOpen || !definition || !item) return null;

  const modalNode = (
    <div className={styles.backdrop} onClick={onClose}>
      <div
        aria-describedby={descriptionId}
        aria-labelledby={titleId}
        aria-modal="true"
        className={styles.modal}
        onClick={(event) => event.stopPropagation()}
        role="dialog"
      >
        {/* 헤더/본문 JSX 그대로 */}
      </div>
    </div>
  );

  return createPortal(modalNode, document.body);
}
```
- `mounted` 상태로 SSR-CSR hydration mismatch 방지(`document`는 서버에 없음).
- `document.body` 직속으로 렌더 → `backdrop-filter` 조상으로부터 해방.
- ESC/focus trap/overflow-hidden 기존 로직 그대로 동작.

#### 부가 작업
- `market-ticker-strip.module.css`의 `backdrop-filter: blur(20px)` 자체는 **제거하지 않는다**. 해당 블러는 heading strip의 의장 효과이며, 포털 전환으로 모달 containment는 이미 해결됨.
- 동일 패턴(`telegram-connect-modal.tsx`)도 선제적으로 포털 전환 권고(지금은 정상이지만 향후 리팩토링 시 조상 필터가 생기면 동일 버그 재발).

### 3.5 개선 #4 — 뉴스 레일 모바일 축소 + 펼치기

#### 현상
- `page.tsx:598-600` → `<NewsWidget limit={4} />`.
- 데스크탑 `newsRail`은 sticky sidebar로 4개 표시 OK.
- 모바일에서는 같은 4개가 세로로 전개되어 스크롤 체감 악화.

#### 해결
1. `NewsWidget`에 `mobileLimit` prop 추가:
   ```tsx
   <NewsWidget limit={4} mobileLimit={2} />
   ```
2. `news-widget.tsx` 내부에서 `useMediaQuery("(max-width: 767px)")` 대신 **CSS-only** 처리(JS hydration 불필요):
   ```css
   /* news-widget.module.css */
   @media (max-width: 767px) {
     .list[data-collapsed="true"] > li:nth-child(n+3) {
       display: none;
     }
   }
   ```
3. 섹션 끝에 `expandButton` 렌더(3.3와 동일 패턴).
4. `limit` prop은 전체 fetch 개수, `mobileLimit`은 표시 개수. 데이터는 이미 4개 fetch된 상태이므로 추가 API 호출 없음.

### 3.6 개선 #5 — 모바일 “지능형 분석 작동 방식” 2×2 그리드 + 점선 제거

#### 현상
- `apps/dashboard/app/insights/insights.module.css:831-838` `.explainFlow { flex-direction: column; }` — 모바일에서 4단계가 세로 나열.
- `:892-902` `.explainConnector` 점선 — 현재 `display: none`이 기본이고 `≥769px`에서 `display: block`. 즉 모바일에 점선은 이미 없음.
- 사용자 요청의 “점선 제거”는 **2×2 그리드 재배치와 함께**, 데스크탑에서 쓰이는 수평 connector가 모바일 그리드에 간섭하지 않도록 명시적으로 끄자는 의미로 해석.

#### 해결
```css
/* insights.module.css */
.explainFlow {
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
}

/* Mobile 2x2 grid */
@media (max-width: 767px) {
  .explainFlow {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-sm);
  }
  .explainStep {
    padding: var(--space-sm);
  }
  .explainConnector {
    display: none !important;  /* 명시적 차단 */
  }
}

/* Desktop 유지 */
@media (min-width: 768px) {
  .explainFlow {
    flex-direction: row;
    gap: var(--space-lg);
  }
  .explainConnector {
    display: block;
  }
}
```
- 기존 `@media (min-width: 769px)`를 `768px`로 조정하면 중간 브레이크포인트(768px iPad) 겹침 해소. 단, 전체 파일 일관성 위해 다른 breakpoint도 768/1024로 표준화하는 작업은 **별도 티켓(T11)**으로 분리.
- `.explainStep` 아이콘 크기는 그대로 유지하되 그리드 셀 내부 패딩을 축소하여 2열에 맞춘다.

#### 접근성
- `role`, `aria-label`은 변경 없음. 시각 배치만 바뀜.
- 스크린리더에서는 4단계를 순차 읽는다(DOM 순서 보존).

### 3.7 개선 #6 — 텔레그램 섹션: 채널 전용 + QR

#### 현상
- `telegram-connect-modal.tsx`의 props: `botUrl`, `qrUrl` (DM bot 경로), `channelUrl`, `channelQrUrl`, `channelUsername`, `username`, `subscriberCount`, `className`.
- `page.tsx:534-543`에서 두 경로 모두 전달 → UX가 이원화되어 사용자가 혼란.
- `lib/public-app-config.ts:28-32`는 이미 `channelUrl = https://t.me/${channelUsername}`, `channelQrUrl = /api/qr?data=${encodeURIComponent(channelUrl)}`을 계산 중 → QR 인프라 재사용 가능.

#### 요구사항
- 사용자 지시: URL `https://t.me/whalescope_alertz`, username `@whalescope_alertz`, **채널 구독 전용**, QR 포함.

#### 해결
1. **환경 변수 정합**(Render/Vercel 공통):
   ```
   NEXT_PUBLIC_TELEGRAM_CHANNEL_USERNAME=whalescope_alertz
   # (DM 경로 제거)
   # NEXT_PUBLIC_TELEGRAM_BOT_USERNAME=…  ← 제거
   ```
2. **`public-app-config.ts` 단순화**:
   ```ts
   const channelUsername = process.env.NEXT_PUBLIC_TELEGRAM_CHANNEL_USERNAME ?? null;
   const channelUrl = channelUsername ? `https://t.me/${channelUsername}` : null;
   const channelQrUrl = channelUrl ? `/api/qr?data=${encodeURIComponent(channelUrl)}` : null;

   return {
     telegram: { channelUsername, channelUrl, channelQrUrl, subscriberCount },
   };
   ```
   `username`/`botUrl`/`qrUrl` 키를 완전히 제거. 타입 정의(`TelegramConfig`)도 축소.
3. **`telegram-connect-modal.tsx` props 축소**:
   ```ts
   type Props = {
     channelUrl: string;
     channelUsername: string;
     channelQrUrl: string;
     subscriberCount?: number;
     className?: string;
   };
   ```
   모달 내부: “봇에게 DM 열기” 섹션 완전 삭제. 단일 CTA “채널 구독하기” + QR 이미지 + `@whalescope_alertz` 표기.
4. **`page.tsx` 호출부 단순화**:
   ```tsx
   <TelegramConnectModal
     channelUrl={telegram.channelUrl}
     channelUsername={telegram.channelUsername}
     channelQrUrl={telegram.channelQrUrl}
     subscriberCount={telegram.subscriberCount}
     className={styles.telegramCta}
   />
   ```
5. **포털 전환**(선제 방어): 3.4와 동일하게 `createPortal(node, document.body)` 적용. 미래에 조상 필터가 추가되어도 안전.

#### QR 구현
- 기존 `/api/qr?data=…` 엔드포인트 재사용(별도 확인 필요 — §5 질문 Q3).
- 만약 엔드포인트가 DM 전용으로 하드코딩되어 있다면 단순 generic QR로 전환:
  ```ts
  // apps/dashboard/app/api/qr/route.ts — if needed
  import QRCode from "qrcode";
  export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const data = searchParams.get("data");
    if (!data) return new Response("missing data", { status: 400 });
    const svg = await QRCode.toString(data, { type: "svg", width: 240 });
    return new Response(svg, {
      headers: { "Content-Type": "image/svg+xml", "Cache-Control": "public, max-age=86400" },
    });
  }
  ```

#### 백엔드 정리
- `src/distribution/telegram.py`의 DM broadcast 경로 사용 중단. Legacy API는 유지하되, `broadcast_daily.py`에서 채널만 전송.
- `whalescope-bot` Render worker: 채널 add/remove 이벤트만 처리하도록 단순화(별도 티켓).

---

## §4. T-task 단위 작업표

| # | 작업 | 영역 | 우선순위 | 추정 | 의존 |
|---|---|---|---|---|---|
| T1 | `src.pipeline.run_all` 오케스트레이터 신설 | backend | P0 | M | — |
| T2 | `MonthlyBudgetGuard.session()` 컨텍스트 매니저 추가 | backend | P0 | S | T1 |
| T3 | `brief`/`stories` 서브파이프라인에 `session.track()` 연동 | backend | P0 | M | T2 |
| T4 | Render `render.yaml` `startCommand` 변경 + 배포 | ops | P0 | S | T1 |
| T5 | GHA 7개 workflow `on:` 섹션에서 `schedule:` 제거, `daily_brief.yml` 삭제 | ops | P0 | S | T4 |
| T6 | InsightsSidebar에 “시장 티커” 링크 추가 + 섹션 id 지정 | frontend | P1 | XS | — |
| T7 | `MarketDetailChartModal`을 `createPortal`로 전환 | frontend | **P0** | S | — |
| T8 | 시장 티커 모바일 2+펼치기 구현 | frontend | P1 | S | T6 |
| T9 | 뉴스 레일 모바일 2+펼치기 구현 | frontend | P1 | S | — |
| T10 | `explainFlow` 모바일 2×2 그리드 + connector 제거 | frontend | P1 | XS | — |
| T11 | 텔레그램 모달 채널 전용화 + props 축소 + env 정리 | full-stack | P1 | M | — |
| T12 | `/api/qr` 엔드포인트가 generic인지 확인, 아니면 대체 구현 | frontend | P2 | S | T11 |
| T13 | `telegram-connect-modal`도 선제적 portal 전환 | frontend | P2 | XS | T11 |
| T14 | breakpoint 표준화(768/1024) 리팩토링 | frontend | P2 | M | T10 |
| T15 | 옵시디언 파일명 일괄 리네이밍(9개 + 위키링크 24개) | docs | P2 | M | — |

추정: XS ≤ 30분, S ≤ 2시간, M ≤ 반일, L ≤ 1일.

### 4.1 병렬 실행 가능 그룹
- **Track A(backend/ops)**: T1 → T2 → T3 → T4 → T5 (직렬, P0)
- **Track B(frontend P0)**: T7 (독립, 즉시 시작)
- **Track C(frontend P1)**: T6 → T8, T9, T10 (병렬)
- **Track D(full-stack P1)**: T11 (독립), 후속 T12/T13
- **Track E(docs)**: T15 (독립)

권고 실행 순서:
1. T7(차트 모달 포털) — 운영 중인 사용자 버그 즉시 해소.
2. T1~T5(Render 단일화) — 데이터 파이프라인 일원화.
3. T6, T8, T9, T10(UI) — 사용자 체감 개선.
4. T11(텔레그램 재구성) — 배포 전 QA 필요(알림 단절 방지).
5. T12~T15 — 후속.

---

## §5. 잔여 질문 / 가정

- **Q1**: `MonthlyBudgetGuard.session()` 컨텍스트 매니저는 현재 구현 여부 미확인. 없다면 T2에서 신설. 있다면 T2 폐기.
- **Q2**: `src.ingestion.news_rss.run_refresh`와 `src.ingestion.curated_balance_refresh.run_refresh`의 시그니처(인자/반환) 확인 필요. `run_all`에서 호출 시 에러 처리 래퍼 필요.
- **Q3**: `/api/qr` 엔드포인트가 generic `?data=` 쿼리를 받는지, 아니면 봇 username에 하드코딩되어 있는지 확인 필요. (T12)
- **Q4**: Render cron의 `*/15 * * * *` 스케줄이 정확히 15분 간격을 보장하는가, 혹은 cold-start로 +N초 지연되는가. 로그로 실측 필요(첫 배포 후 24시간).
- **가정**: 방송 채널 ID `@whalescope_alertz`가 Telethon/Bot API 양쪽에서 동일 접근 가능한 퍼블릭 채널. 비공개 채널이면 `chat_id=-100…` 숫자형으로 바꿔야 함.
- **가정**: Google Sheets `llm_budget_log` 탭은 이미 스키마 등록됨(`src/storage/schema.py:106-108` 확인). `MonthlyBudgetGuard`가 이 탭에 append 가능.

---

## §6. 다음 액션 순서 (체크리스트)

- [ ] **S0 — Repo 확인**: `grep -rn "MonthlyBudgetGuard.*session" src/` 로 T2 필요 여부 판정
- [ ] **S1 — T7 머지**: 차트 모달 포털 전환 → 운영 중 버그 해소 (UI only, 리스크 낮음)
- [ ] **S2 — T1~T3 PR**: `run_all` + guard session + 서브파이프라인 연동, 로컬 dry-run(`python -m src.pipeline.run_all` + `SHEETS_READONLY=1`)
- [ ] **S3 — Render 스테이징 배포**: 새 startCommand로 cron 1회 수동 trigger, Sheets 로그 확인
- [ ] **S4 — T5 실행**: GHA 7개 workflow의 schedule 제거. broadcast_daily는 마지막에 제거(이중 방송 방지 확인 후)
- [ ] **S5 — T6/T8~T10 PR**: UI 개선 4종 한 번에 리뷰
- [ ] **S6 — T11 PR**: 텔레그램 채널 전용화. Vercel 환경변수 업데이트, 프리뷰 배포에서 QR 스캔 수동 검증
- [ ] **S7 — 24시간 관찰**: Render 로그 + Sheets 기록 + Telegram 채널 실제 수신 교차 검증
- [ ] **S8 — 옵시디언 문서 14/15/T15 업데이트**: 정합성 재확인 노트 작성

---

## §7. 관련 파일

### 7.1 신규
- `src/pipeline/run_all.py`
- `apps/dashboard/components/news-widget.module.css` (기존에 있다면 확장)

### 7.2 수정
- `src/main.py` — deprecation 주석만 추가(삭제는 T15 이후)
- `src/router/budget.py` — `session()` 컨텍스트 매니저
- `src/pipeline/brief.py`, `src/pipeline/stories.py` — `session` 인자 수용
- `render.yaml` — `startCommand`
- `.github/workflows/{signals,brief,stories,news_rss,curated_balance,broadcast_daily,channel_health}.yml` — `schedule:` 제거
- `.github/workflows/daily_brief.yml` — **삭제**
- `apps/dashboard/components/insights-sidebar.tsx`
- `apps/dashboard/components/market-ticker-strip.tsx`, `.module.css`
- `apps/dashboard/components/market-detail-chart-modal.tsx`
- `apps/dashboard/components/news-widget.tsx`
- `apps/dashboard/components/telegram-connect-modal.tsx`
- `apps/dashboard/app/insights/insights.module.css`
- `apps/dashboard/app/page.tsx`
- `apps/dashboard/lib/public-app-config.ts`
- `apps/dashboard/app/api/qr/route.ts` (필요 시)

### 7.3 환경 변수
- Vercel: `NEXT_PUBLIC_TELEGRAM_CHANNEL_USERNAME=whalescope_alertz`
- Vercel: `NEXT_PUBLIC_TELEGRAM_BOT_USERNAME` — **제거**
- Render: 변경 없음(`TELEGRAM_BROADCAST_*` 유지)

---

## §8. 복원 컨텍스트 (다음 세션용)

> 이 노트만 읽고도 다음 세션에서 작업을 이어갈 수 있도록 핵심 맥락을 정리.

- **문서 14 vs 본 문서**: 14는 “Render×GHA 중복” 진단과 Option A(Render suspend) 권고. 본 문서는 사용자 지시로 **정반대 방향(Option C: Render 단일화)** 확정. 근거는 사용자 발화.
- **현재 코드 상태**: `src/main.py`는 v3 레벨, v4 서브파이프라인 6종 미호출. `MonthlyBudgetGuard`는 존재하나 연결 안 됨. 즉 “Render가 알아서 다 취합” 의도는 **미반영 상태**.
- **해결 형태**: `src.pipeline.run_all` 시간 인식 디스패처 신설. Render cron `*/15 * * * *`가 run_all을 호출, 내부에서 분/시 기반으로 서브파이프라인 분기.
- **UI 개선 6건**: 좌측 사이드바에 시장 티커 링크 추가, 시장 티커/뉴스 레일 모바일 2+펼치기, **차트 모달 포털 전환(P0 버그 수정)**, 지능형 분석 아이콘 모바일 2×2 + 점선 제거, 텔레그램 채널 전용(QR 포함).
- **P0 즉시 처리**: T7(차트 모달 포털). `backdrop-filter: blur(20px)`가 `position:fixed` 자손 containing block을 가로채는 CSS 동작이 근본 원인.
- **관련 문서**: [[2026-04-18-14-WhaleScope-v4-정합성-브리핑-Render-GHA-중복-분석]], [[2026-04-18-13-WhaleScope-유저홈-v4-구현-QA-코드리뷰-종합보고서]], [[2026-04-18-08-WhaleScope-Render-워커-웹서버-배포가이드]].

---
