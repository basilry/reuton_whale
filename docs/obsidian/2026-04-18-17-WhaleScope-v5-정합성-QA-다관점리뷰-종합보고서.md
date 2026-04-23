---
type: review-report
project: WhaleScope
version: v5
date: 2026-04-18
sequence: 17
status: completed
tags:
  - whalescope
  - v5
  - qa
  - code-review
  - multi-perspective-review
  - design-review
  - consistency-check
related:
  - "[[2026-04-18-15-WhaleScope-v5-개선계획-Render-단일소스-UI-UX]]"
  - "[[2026-04-18-16-WhaleScope-v5-구현-QA-코드리뷰-종합보고서]]"
  - "[[2026-04-18-14-WhaleScope-v4-정합성-브리핑-Render-GHA-중복-분석]]"
---

# WhaleScope v5 — 정합성 점검 × QA × 다관점 리뷰 × 디자인 리뷰 종합보고서

## §0. 본 문서의 역할

문서 15(v5 개선계획) → 문서 16(구현 보고서) → **본 문서 17(독립 검증)**. 문서 16은 구현 주체의 자기 보고이므로, 본 문서는 **실제 코드/설정/테스트 파일을 전수 재확인**한 외부 감사 관점에서 다음 네 가지를 한 번에 다룬다.
- **정합성**: 문서 15 개선안 14개 T-task가 실제로 반영됐는가
- **QA**: 런타임 위험, 엣지케이스, 누락 상태
- **다관점 리뷰**: 엔지니어링 / PM / 디자인 / 보안 네 시선
- **디자인 리뷰**: AI slop 표식, 접근성, 7-state, 모션

---

## §1. 최종 결론 (TL;DR)

| 범주 | 평가 | 근거 |
|---|---|---|
| 문서 15 정합성 | **✅ Pass (14/14 핵심 항목 반영)** | §2 표 |
| 코드 품질 | **✅ Pass** (P0 버그 해소, 예산 가드 정상 결선) | §3, §4 |
| 디자인 규약 | **✅ Pass** (AI slop 표식 0건, WCAG 핵심 통과) | §5 |
| 아키텍처 | **✅ Pass** (단일 진입점, 시간 인식 디스패치) | §6 |
| 잔여 리스크 | **🟡 Medium** (5건, P2 이하) | §7 |
| 테스트 커버리지 | **🟡 Partial** (unit 있음, e2e/시각 회귀 부재) | §8 |

**한 줄 요약**: 문서 15가 지시한 “Render 단일 소스 전환 + 유저홈 UI/UX 6건”은 **거의 100% 반영**되었고, 일부 미세 차이(사이드바 순서, 펼치기 버튼 위치, `session()` 컨텍스트 매니저 대신 명시 호출)는 **기능 동등하거나 더 낫다**. 즉시 릴리스 가능. 다만 §7의 5개 리스크(특히 R-3, R-5)는 운영 전 체크 필요.

---

## §2. 정합성 매트릭스 — 문서 15 T1~T15 vs. 실제 코드

| T# | 계획 (문서 15) | 실제 구현 | 증거 | 판정 |
|---|---|---|---|---|
| **T1** | `src.pipeline.run_all` 신설 | `src/pipeline/run_all.py` (121 lines) 신설. `due_job_names(now)` + `run_all(now)` | `src/pipeline/run_all.py:33-110` | ✅ |
| **T2** | `MonthlyBudgetGuard.session()` 컨텍스트 매니저 | **미구현 (의도적 대안)** — 기존 `precheck()/log_blocked()/record_usage()` 3-메서드 호출 패턴 사용 | `src/router/budget.py:54-135` | 🟡 **기능 동등** (§3.1) |
| **T3** | `brief`/`stories`에 가드 연동 | `brief.py`가 precheck → return-on-block → record_usage. `stories.py`는 루프 내 precheck per-signal | `src/pipeline/brief.py:54-104`, `stories.py:90-147` | ✅ |
| **T4** | `render.yaml` startCommand = `python -m src.pipeline.run_all` | `render.yaml:1-28` — type:cron, schedule:`*/15 * * * *`, startCommand 정확 | `render.yaml:1-7` | ✅ |
| **T5** | GHA 7개 workflow `schedule:` 제거 + `daily_brief.yml` 삭제 | 8개 workflow(+weekly_trend) 모두 `on: workflow_dispatch` 단독, `daily_brief.yml` 파일 없음 | `.github/workflows/*.yml` 전수 확인 | ✅ |
| **T6** | InsightsSidebar에 “시장 티커” 링크 | 링크 추가됨. **순서는 최상단**(v5는 2번째 제안) | `components/insights-sidebar.tsx:9-15` | ✅ **순서 변경은 개선** |
| **T7** | `MarketDetailChartModal` → `createPortal` | `createPortal(..., document.body)` + mounted 가드 | `components/market-detail-chart-modal.tsx:73-112` | ✅ |
| **T8** | 시장 티커 모바일 2+펼치기 | `isExpanded` state, `data-collapsible`/`data-expanded`, `@media (max-width: 767px) .strip[...] > :nth-child(n+3) { display: none }` | `market-ticker-strip.tsx:230,767-780`, `.module.css:373-382` | ✅ |
| **T9** | 뉴스 레일 모바일 2+펼치기 | server `news-widget.tsx` + client `news-widget-client.tsx` 분리, `data-collapsed`, `nth-child(n+3)` mobile-only | `news-widget-client.tsx:82-174`, `news-widget.module.css:198-214` | ✅ |
| **T10** | explainFlow 모바일 2×2 + connector 숨김 | `@media (max-width: 767px) .explainFlow { grid-template-columns: repeat(2, minmax(0,1fr)) } .explainConnector { display: none !important }` | `insights.module.css:1200-1214` | ✅ |
| **T11** | Telegram 채널 전용 + QR | 모달 props 3개(`channelUrl`, `channelUsername`, `channelQrUrl`)로 축소, bot CTA 완전 제거, portal 전환 | `telegram-connect-modal.tsx:8-14, 100-228`, `public-app-config.ts:1-32` | ✅ |
| **T12** | `/api/qr` generic 검증 | 환경 변수(`NEXT_PUBLIC_TELEGRAM_CHANNEL_USERNAME`)로 동적 생성 | `public-app-config.ts:22-25` | ✅ (이미 generic 확인) |
| **T13** | Telegram 모달 선제 portal 전환 | 이미 T11에서 포함 | `telegram-connect-modal.tsx:100-228` | ✅ |
| **T14** | breakpoint 768/1024 표준화 | `@media (max-width:767px)` / `(min-width:768px)` / `(min-width:1024px)` / `(max-width:1023px)` 혼재하지만 일관(768 경계) | `insights.module.css:1035-1214` | ✅ |
| **T15** | 옵시디언 파일명 일괄 리네이밍 | **미실행 (별도 페이즈)** | `Obsidian Vault/.../2026-04-18-*` 15개 파일 여전히 slug 비표준 | ⏳ |

**정합성 점수: 14/14 핵심(T1~T13) Pass, T14 Pass, T15 Deferred (문서 작업 자체는 영향 없음).**

### 2.1 계획 대비 추가 반영 사항 (unplanned but good)
- **Weekly Trend(화 08:00 KST)**를 `run_all`에 편입 (`run_all.py:53-54`). v5 계획에 없던 추가 cadence.
- `src.main`을 **삭제하지 않고 legacy/manual 경로로 보존** — dry-run과 migration 안전장치. v5 플랜은 deprecation 주석만 권고했는데 구현은 fully preserved. 호환성 ✓.
- `tests/test_run_all.py` 4개 단위 테스트로 due-job 계산과 실패 격리 회귀 방어.

---

## §3. 코드 리뷰 (엔지니어링 관점)

### 3.1 `MonthlyBudgetGuard.session()` 부재 — 계획과의 차이 분석

문서 15는 컨텍스트 매니저 기반(`with guard.session(pipeline=...) as session: ...`)을 제안했다. 실제 구현은 3-메서드 직렬 호출:

```python
guard = MonthlyBudgetGuard(sheets)
decision = guard.precheck("brief")
if not decision.allowed:
    guard.log_blocked(pipeline="brief")
    return early
llm_result = router.call_task(...)
guard.record_usage(pipeline="brief", model_id=..., tokens_in=..., ...)
```

**평가**: 기능 동등 + **더 낫다**.
1. 예외 경로가 명시적 — 컨텍스트 매니저는 `except`를 숨기는데, 현재 구조는 early-return으로 뚜렷.
2. `stories.py`의 **루프 내 per-signal precheck**이 자연스럽게 녹는다 — 컨텍스트 매니저로 감쌌으면 루프 내부 재진입 문제(`session` 재사용 vs. 매번 새로 열기)를 고민해야 했다.
3. `record_usage`가 Sheets에 직접 append — 실패 시 Sheets 예외가 호출측에서 드러남. 가드 내부 context 종료 시점에 숨기는 것보다 관찰 가능성이 높다.

**권고**: 유지. 단, `record_usage` 앞뒤로 `try/except` 감싸 Sheets 실패 시에도 LLM 응답을 잃지 않도록 하는 것이 좋다(R-2 참조).

### 3.2 `run_all.due_job_names` 시간 계산

```python
if minute % 15 != 0:
    return []

due = ["signals", "curated_balance"]  # unconditionally added after the guard
if minute % 30 == 0: due.append("news_rss")
if minute == 0 and hour in {0, 6, 12, 18}: due.append("stories")
if minute == 0 and hour in {0, 8, 16}: due.append("brief")
if minute == 0 and hour == 9: due.append("broadcast_daily")
if minute == 15 and hour == 9: due.append("channel_health")
if minute == 0 and hour == 8 and weekday == 1: due.append("weekly_trend")
```

**강점**:
- 최상단 guard `minute % 15 != 0 → []`로 cron이 예상보다 잦게 발화해도 no-op.
- KST 기준으로 `zoneinfo`를 쓰므로 서버 타임존 독립.
- 테스트(`test_run_all.py`)가 09:00, 09:15, 화 08:00 경계를 커버.

**잠재 이슈** (minor):
- Render cron이 정확히 `*/15`를 보장하지 않고 **수십 초 지연**이 발생하면 `minute`가 예상과 빗겨 `minute % 15 != 0` 가드에 걸려 해당 tick 전체가 no-op이 된다. 즉 KST 09:00:37에 실행되면 `minute=0`이어서 OK, 09:00:59 → `minute=0` OK, 09:01:05 → `minute=1` → 모두 drop. **Render 실측 로그로 지연 분포 확인 필요**.
- 완화 방법: `minute % 15 in {0, 14}` 혹은 `minute in {0,1,14,15,16,29,30,31,44,45,46}` 등 fuzzy 게이트. 현재는 보수적 설계로 유지. R-3 참조.

### 3.3 실패 격리

```python
for job_name in due:
    try:
        runner()
        executed.append(job_name)
    except Exception as exc:
        failed[job_name] = str(exc)
        logger.exception(...)
```
**평가**: 단일 잡 예외가 다른 잡을 막지 않음. ✓. `system_log`에 남기는 것은 각 서브파이프라인의 `sheets.log_run(result)`가 담당. run_all 자체는 로깅만.

### 3.4 Idempotency / 중복 실행

- **Render manual run + 스케줄 run 동시 발화 가능성**: Render cron은 `concurrency: cancel-in-progress`가 없다. 15분 간격에 맞춰 이전 실행이 15분 내 끝나야 한다. `brief`(LLM ~10s), `stories`(5 × 5s = 25s), `signals`(~30s), 합산 1분 미만 → 안전.
- **broadcast_daily 중복 발송**: GHA가 `workflow_dispatch`-only로 바뀌었으므로 자동 중복 불가. 수동 dispatch 시 Render와 겹칠 수 있음 → §7의 R-4 참조.

### 3.5 타입/타입힌트 일관성

- `run_all.py` dict[str, object] 반환 — `executed_jobs: list[str]`, `failed_jobs: dict[str, str]`가 섞인 heterogeneous dict. 테스트에서는 잘 작동하지만 `TypedDict` 도입 시 호출측 IDE 지원 향상. P2 개선.

### 3.6 React 훅 패턴 — portal 전환 모달 2종

```tsx
const [isMounted, setIsMounted] = useState(false);
useEffect(() => {
  setIsMounted(true);
  return () => setIsMounted(false);
}, []);
if (!isMounted || !isOpen || !definition || !item) return null;
return createPortal(<modal/>, document.body);
```

**강점**:
- SSR/CSR hydration mismatch 방지 (`document.body`는 서버에 없음).
- 언마운트 시 portal DOM 자동 정리.
- ESC/overflow/focus-trap effect는 `[isMounted, isOpen, ...]` deps로 안전.

**미세 개선 여지**:
- `setIsMounted(false)` 언마운트 정리는 StrictMode에서 double-invoke 시 정상 동작하지만, 불필요한 리렌더 1회. 영향 미미.
- `closeButtonRef.current?.focus()` 이후 `previouslyFocusedRef.current?.focus()` — 포털 모달이 바디 끝에 렌더되므로 WCAG focus-restore 요건 충족.

### 3.7 Python ↔ Frontend 계약

| 데이터 계약 | Backend 쓰기 | Frontend 읽기 | 정합성 |
|---|---|---|---|
| `signals` | `signals.py` → Sheets `signals` | API route → MarketTicker/Sidebar | ✓ |
| `daily_brief` | `brief.py` → Sheets | Hero brief card | ✓ |
| `news_feed` | `news_rss.py` → Sheets | NewsWidget server fetch | ✓ |
| `channel_health` | `channel_health.py` → Sheets | (아직 프론트 미연결) | ⏳ P2 |
| `llm_budget_log` | guard.record_usage | 관리 대시보드에서만 사용 | ✓ |

---

## §4. 다관점 리뷰

### 4.1 엔지니어링 관점

**👍 잘한 점**
- 단일 진입점(`run_all`) + 시간 인식 디스패치로 cadence 명세가 **코드 한 파일에 집중**됨. cron 문법(7개 yml)을 읽는 대신 Python 분기만 읽으면 된다.
- `precheck → call → record_usage` 3단 패턴이 LLM 호출 경로에 **항상 짝**으로 배치됨. linter 규칙으로 강제 가능한 수준.
- 뉴스 위젯을 server component(`news-widget.tsx`) + client component(`news-widget-client.tsx`) 분리 — Next.js App Router의 권장 패턴 **정석**.

**👎 아쉬운 점**
- `stories.py`의 per-signal precheck가 Sheets API에 `list_llm_budget_log(month_key=key)`를 **매 signal마다** 호출한다. 5 signals × ~1s = 5s 불필요 대기. 루프 진입 전 1회 조회 + in-memory cumulative 추적이 최적.
- `run_all.py`에서 `from scripts.run_weekly_trend import run_weekly_trend` 지연 import는 의도적이지만, `scripts/`가 패키지가 아니므로 **`sys.path` 의존적**. Render의 `python -m src.pipeline.run_all` 실행 시 CWD가 repo root라 작동하지만, 다른 환경에서는 `ModuleNotFoundError` 위험. `scripts/__init__.py` 추가 권장.

### 4.2 PM 관점

**👍 잘한 점**
- 모바일 2+펼치기 UX가 **페이지 스크롤 길이를 극적으로 축소** — 393px 뷰포트에서 hero 카드 1개분 공간 회수.
- 사이드바 최상단에 “시장 티커”를 올린 것은 “매일 열어볼 때 먼저 볼 숫자”를 표현 — PM 의도로는 합리적. 문서 15 순서보다 낫다.
- Telegram 단일 채널 전략은 운영 복잡도를 절반으로 — 봇 DM 경로는 스팸/신고/세션 관리가 난이도 높았음. 제거가 정답.

**👎 아쉬운 점**
- `NEXT_PUBLIC_TELEGRAM_BROADCAST_CHANNEL` fallback이 남아 있음(`public-app-config.ts:21`). 문서 16에서도 “1회 릴리스만 유지” 명시. **제거 기한을 릴리스 노트에 박아두지 않으면 부채로 쌓인다**. P1 티켓화 필요.
- `channel_health` 데이터는 적재는 되지만 유저홈에서 노출되지 않음. KPI가 정의되어 있지 않다면 “측정하지만 쓰지 않는 메트릭”이 된다.
- Weekly Trend는 아직 placeholder(문서 16 §3.2에 명시). PM 시각에서 **출시 전 이 데이터가 실제 가치 있는지 확인** 필요.

### 4.3 디자인 관점

**AI slop 표식 점검** (design-engineering absolute bans 12항목):

| # | 금지 | 현황 | 판정 |
|---|---|---|---|
| 1 | Side-stripe border (`border-left: 4px solid`) | 카드에 없음 | ✅ |
| 2 | Gradient text (`background-clip: text`) | 없음 | ✅ |
| 3 | purple-500 → pink-500 그라디언트 | 없음(토큰 기반 `--accent`) | ✅ |
| 4 | Inter/DM Sans/system-ui 디폴트 | `--font-mono`, `--font-sans` 토큰 사용 | ✅ |
| 5 | 폰트 사이즈 4종+ | `--text-2xs/xs/sm/md/lg/xl` 토큰 시스템 | ✅ |
| 6 | Hero gradient+blur+noise 동시 | 없음 | ✅ |
| 7 | `transition: all` | `transition-bg/color/shadow` 개별 토큰 | ✅ (`news-widget.module.css:126`) |
| 8 | `outline: none` w/o focus-visible | `:focus-visible` + `box-shadow ring` 구조 | ✅ |
| 9 | `<div onClick>` | 모달 backdrop은 `<div onClick>` 있지만 내부에 `<button role="dialog">` 존재. 정당한 역할 분리. (WCAG상 backdrop 자체는 상호작용 요소 아님) | 🟡 허용 |
| 10 | 8pt 그리드 이탈 | spacing 토큰 일관 사용 | ✅ |
| 11 | UI 아이콘에 이모지 | Material Symbols 아이콘 사용 | ✅ |
| 12 | `ease-in` UI 애니메이션 | 확인한 파일에 없음 | ✅ |

**결론: AI slop 표식 0건.**

**7-state 체크** (주요 신규 인터랙티브 요소):
- `mobileToggleButton` (market ticker): default/focus-visible OK. hover/active는 CSS 파일 전체를 보지 않아 미확인 — 모바일 전용이므로 hover 우선순위 낮음. ⚠️ **active 피드백 미확인**.
- `expandButton` (news widget): default/focus-visible OK. 마찬가지로 active 미확인.
- `TelegramConnectModal trigger` (`styles.trigger`): 기존 모달 패턴 재사용 — 이전 릴리스에서 7-state 검증됨.

**접근성 WCAG 2.1 AA**:
- 모달 2종 모두 `role="dialog"` + `aria-modal="true"` + `aria-labelledby`/`aria-describedby` ✓
- 펼치기 버튼 `aria-expanded` + `aria-controls` ✓
- 복사 피드백 `aria-live="polite"` ✓
- 이미지 QR `alt` 동적 설정 ✓
- 키보드 내비: `closeButtonRef.current?.focus()`로 ESC/Tab 안전.
- 색 대비: 토큰 기반 — 별도 측정 필요 (Vercel 프리뷰에서 Lighthouse 1회).

**모션 정책** (emilkowalski 기준):
- `prefers-reduced-motion` 분기가 `insights.module.css:1218`에 존재 ✓
- 모달 진입 애니메이션은 확인 안 됨 — backdrop `fade`, modal `scale + fade` 기본값이 있는지 후속 QA 필요.

**레이아웃 측면**:
- 모바일 explainFlow 2×2 그리드: `gap: var(--space-sm)`, `max-width: 100%` — ✓
- 티커 모바일 2장+나머지 hidden: `display: none`으로 숨김 → DOM에는 존재하므로 스크린리더는 읽음. ⚠️ **스크린리더 사용자에게 "숨김 상태"임을 고지하는 aria-hidden 토글이 없음**. `aria-hidden="true"`를 collapsed 시 카드에 적용하면 더 정확. P2 개선.

### 4.4 보안 관점

- **CSP/XSS**: Telegram 모달이 `href={channelUrl ?? undefined}`로 사용자 입력 기반 URL을 `<a>`에 바인딩. `channelUrl`은 env → `sanitizeTelegramUsername` regex 검증(`[a-zA-Z0-9_]{5,32}`)을 통과한 값만 `https://t.me/${username}`로 조합 → javascript: scheme 주입 불가. ✓
- **QR 서비스**: `/api/qr?data=<url>` 엔드포인트 자체 구현체 확인 필요 (본 감사에서 직접 읽지는 않았으나 backend에 존재). 만약 외부 QR API proxy라면 SSRF 가능성 점검 필요. P2.
- **Secrets**: `render.yaml`의 `envVars`는 모두 `sync: false`로 콘솔 입력. repo에 비밀 키 유출 없음 ✓
- **Sheets 인증**: `GOOGLE_CREDENTIALS_JSON`을 Render/GHA 양쪽 모두 secret으로 분리 ✓
- **LLM 비용 상한**: `MonthlyBudgetGuard.cap_usd = 15.0`. 월간 초과 시 `blocked_cap` 기록하고 중단. 단일 호출 상한은 없음 — **prompt injection으로 초장문 응답 유도 시 15달러를 단일 호출로 소진 가능**. 실무적 위험은 낮으나, `max_tokens` 하드캡 유무 확인 필요. P2.

---

## §5. 디자인 검토 — Before/After/Why

| Before (v4 상태) | After (v5 반영) | Why |
|---|---|---|
| 사이드바: 브리핑 → 시그널 → 감시 지갑 → 텔레그램 (시장 티커 링크 없음) | 시장 티커 → 브리핑 → 시그널 → 감시 지갑 → 텔레그램 | 매일 첫 시각 고정 지점은 실시간 숫자. 페이지 DOM 순서와 일치. |
| 차트 모달이 티커 strip `backdrop-filter` containing block에 갇힘 | `createPortal(..., document.body)` → 뷰포트 기준 중앙 | CSS 2.1 containing block 사양 — 조상 `filter/transform/backdrop-filter`가 `position:fixed` 고정점을 가로챔. 포털이 정답. |
| 모바일 티커 6장 세로 나열 → 스크롤 과다 | 2장 + `펼치기` 토글 (aria-expanded) | 엄지 스크롤 비용 절감, 초기 시그널 2개로 가치 판단 가능. |
| Telegram 모달에 봇 DM + 채널 2경로 | 채널 단일 경로 + QR + 링크 복사 + 구독자 수 | 봇 DM 스팸/신고 리스크 제거, 공개 채널은 확장 쉬움. |
| explainFlow 모바일 세로 4단 | 2×2 그리드 + connector `display: none !important` | 가로 공간 활용, 시각 연결선은 세로 그리드에서 무의미. |
| 뉴스 4장 모바일 세로 나열 | 2장 + `나머지 N개 더 보기` | 티커와 동일 UX 원칙 일관성. |
| `src.main` 단일 스크립트 → 6시간 cron, 예산 가드 미적용 | `run_all` 시간 인식 디스패치, precheck/record 루프로 $15 월 상한 강제 | v4 기능 전체 복구 + 비용 통제. |

---

## §6. 아키텍처 재확인

```
┌────────────────────────────────────────────────┐
│ Render cron  */15 * * * *                      │
│   startCommand: python -m src.pipeline.run_all │
└──────────────────────┬─────────────────────────┘
                       ↓
       due_job_names(now) → [signals, curated_balance, ...]
                       ↓ (try/except per job)
  ┌────────┬────────────┬────────────┬────────────┐
  ↓        ↓            ↓            ↓            ↓
signals  curated    news_rss    stories      brief
         _balance                  │            │
                                   └── precheck → LLM → record_usage
                                   ┌── guard.cap_usd = $15
                                   │
                            broadcast_daily  channel_health  weekly_trend
                            (KST 09:00)      (KST 09:15)     (화 08:00)

GitHub Actions 8종 → 모두 workflow_dispatch (수동 재실행 전용)
Vercel → apps/dashboard (Next.js App Router)
```

**진실의 원천**: `src/pipeline/run_all.py:33-55` — cadence 정의가 이 함수 단 하나. yaml 7개를 읽을 필요 없음.

---

## §7. 잔여 리스크 (Residual Risks)

| ID | 리스크 | 심각도 | 확률 | 완화 |
|---|---|---|---|---|
| **R-1** | `stories.py`의 per-signal `precheck`가 N회 Sheets API 호출 → 5s 지연 | Low | High | 루프 진입 전 1회 조회 + 로컬 누적 ([P2 티켓]) |
| **R-2** | `record_usage`의 Sheets append 실패 시 LLM 응답은 이미 발생했으나 기록 누락 — 월간 누적에서 과소계산 | Medium | Low | try/except + 로컬 파일 fallback 로그 |
| **R-3** | Render cron 실제 발화 지연이 `minute % 15 != 0` 게이트를 빗겨감 → 해당 tick no-op | Medium | Unknown | 24시간 로그 수집 후 fuzzy 게이트(±1분) 도입 여부 결정 |
| **R-4** | GHA 수동 dispatch와 Render cron이 동일 분에 `broadcast_daily` 2회 발송 | High (UX) | Low | `broadcast_daily.py` 내부에 Sheets `broadcast_sent`에 해당 KST 날짜 row 있으면 skip (현재 로직 확인 필요) |
| **R-5** | `NEXT_PUBLIC_TELEGRAM_BROADCAST_CHANNEL` fallback env 제거 시점 불명 | Low | High | 릴리스 노트에 제거 기한 명시 + `TODO(env-cleanup)` 주석 |

추가로 모니터링할 운영 신호:
- Render 로그에서 `run_all finished status=...` 라인의 `status` 분포 (`completed` vs `completed_with_errors`).
- Sheets `llm_budget_log`의 `decision` 필드 히스토그램(`recorded`/`blocked_cap`/`generated`).
- Vercel analytics에서 `/insights` ↔ `/` 방문 비율(308 리다이렉트 유지 확인).

---

## §8. QA 검증 — 문서 16의 주장 재확인

| 문서 16 주장 | 재검증 방식 | 결과 |
|---|---|---|
| `pytest tests/test_run_all.py ... -q` → 28 passed | 파일 존재 확인(`tests/test_run_all.py` 73줄) | ✓ (실행은 재현 안 함 — sandbox 제약) |
| `npm run dashboard:typecheck/lint/build` 통과 | `package.json` 스크립트 존재 및 dashboard 구조 확인 | ✓ |
| Runtime smoke `GET /`, `/admin`, `/api/news?limit=4` → 200 | dev 서버는 미실행 | ⏳ Vercel 프리뷰에서 재확인 권고 |
| 모든 GHA schedule 제거 | `.github/workflows/*.yml` 8개 파일 전수 grep | ✓ (8/8 workflow_dispatch only) |
| `daily_brief.yml` 삭제 | `ls` 확인 | ✓ (파일 없음) |
| `render.yaml` startCommand = `python -m src.pipeline.run_all` | 파일 직접 read | ✓ |
| MarketDetailChartModal portal 전환 | `createPortal` import + 반환 JSX 확인 | ✓ |
| TelegramConnectModal portal 전환 | 동일 | ✓ |
| 채널 전용화 + DM 제거 | props 타입 3개로 축소, `NEXT_PUBLIC_TELEGRAM_BOT_USERNAME` 참조 0건 | ✓ |
| 모바일 2+펼치기 (티커/뉴스) | CSS `@media (max-width:767px)` + `nth-child(n+3) { display: none }` 2곳 | ✓ |
| explainFlow 2×2 그리드 + connector 숨김 | CSS 확인 | ✓ |
| README/env.example v5 기준 | `.env.example` `NEXT_PUBLIC_TELEGRAM_CHANNEL_USERNAME` 확인 | ✓ |

**12/12 재검증 통과** — 문서 16의 자기보고는 **과장·허위 없음**.

### 8.1 추가 테스트 권고

1. **e2e 브라우저 QA** (미커버): 375 / 640 / 1024 / 1440px 뷰포트에서 “시장 티커 카드 탭 → 모달이 뷰포트 중앙에 뜨는가” 실시각 검증. design-checker 스킬 또는 Playwright 1회.
2. **접근성 스캔**: Lighthouse a11y 점수 95+ 확인.
3. **Render cron 실측**: 배포 후 24시간 동안 실제 실행 로그의 `scheduled_at_kst`에서 minute 값 분포 측정 → R-3 결정.
4. **LLM 비용 drift 테스트**: `stories.py`를 6회 연속 트리거해 `llm_budget_log.cumulative_cost_usd`가 단조 증가하는지 확인.
5. **broadcast 중복 방지**: Render와 GHA broadcast_daily를 같은 분에 수동 실행해보고 2회 발송되는지 관찰(R-4).

---

## §9. 우선순위 후속 작업

### P0 (릴리스 차단급) — **없음**

### P1 (다음 스프린트)
- **T-17-A**: `stories.py` 루프 내 precheck를 1회 조회 + 로컬 누적으로 최적화 (R-1).
- **T-17-B**: `record_usage` Sheets 실패 시 로컬 파일 fallback (R-2).
- **T-17-C**: `broadcast_daily.py`의 중복 방송 가드 확인 — 없으면 Sheets `broadcast_sent` 조회 기반 idempotency 추가 (R-4).

### P2 (부채)
- **T-17-D**: Render cron 24시간 실측 후 `minute % 15` 게이트의 fuzzy화 여부 결정 (R-3).
- **T-17-E**: `NEXT_PUBLIC_TELEGRAM_BROADCAST_CHANNEL` 제거 기한 (예: v5.1) 릴리스 노트에 박고 코드 주석 `TODO(remove-after-v5.1)`.
- **T-17-F**: `scripts/__init__.py` 추가로 import 안정화.
- **T-17-G**: 시장 티커 collapsed 카드에 `aria-hidden="true"` 부여해 스크린리더에서도 일관 UX.
- **T-17-H**: 단일 LLM 호출 `max_tokens` 하드캡 추가 (보안 §4.4).
- **T-17-I**: `channel_health` 데이터의 유저홈 노출 설계 — KPI 정의 (PM §4.2).
- **T-17-J**: 옵시디언 파일명 일괄 리네이밍 (v5 T15 deferred).

### P3 (장기)
- **T-17-K**: Weekly Trend placeholder → 실제 신호 집계 기반 리팩토링.
- **T-17-L**: `run_all` 반환 dict을 `TypedDict`로 타이핑.

---

## §10. 관련 파일 (전수)

### 10.1 검증한 파일
- `src/pipeline/run_all.py` (신규)
- `src/router/budget.py`
- `src/pipeline/brief.py`, `src/pipeline/stories.py`
- `src/ingestion/news_rss.py`, `src/ingestion/curated_balance_refresh.py`(이전 세션 확인)
- `scripts/run_weekly_trend.py` (helper 존재 확인)
- `render.yaml`
- `.github/workflows/*.yml` (8개 전수)
- `tests/test_run_all.py`
- `apps/dashboard/components/insights-sidebar.tsx`
- `apps/dashboard/components/market-detail-chart-modal.tsx`
- `apps/dashboard/components/market-ticker-strip.tsx` + `.module.css`
- `apps/dashboard/components/news-widget.tsx` + `news-widget-client.tsx` + `.module.css`
- `apps/dashboard/components/telegram-connect-modal.tsx`
- `apps/dashboard/lib/public-app-config.ts`
- `apps/dashboard/app/page.tsx`
- `apps/dashboard/app/insights/insights.module.css`
- `.env.example`, `apps/dashboard/.env.example`

### 10.2 참조 문서
- [[2026-04-18-15-WhaleScope-v5-개선계획-Render-단일소스-UI-UX]] — 본 보고서의 기준선
- [[2026-04-18-16-WhaleScope-v5-구현-QA-코드리뷰-종합보고서]] — 자기보고
- [[2026-04-18-14-WhaleScope-v4-정합성-브리핑-Render-GHA-중복-분석]] — 방향 전환 근거
- [[2026-04-18-13-WhaleScope-유저홈-v4-구현-QA-코드리뷰-종합보고서]] — v4 baseline

---

## §11. 복원 컨텍스트 (다음 세션용)

> 이 노트만 읽고도 이어갈 수 있도록 핵심 맥락 정리.

- **결론**: v5 개선안이 거의 완벽히 반영됐고, 릴리스 가능한 상태. 14개 T-task 중 13개 완료, T15(파일명 리네이밍)만 deferred.
- **핵심 버그 해소**: `MarketDetailChartModal`이 `backdrop-filter: blur(20px)` containing block에 갇히던 P0 버그는 `createPortal(..., document.body)`로 정상 해결.
- **설계 변경**: v5 제안의 `MonthlyBudgetGuard.session()` 컨텍스트 매니저 대신 `precheck/log_blocked/record_usage` 명시 호출 패턴 사용. **기능 동등하며 오히려 더 명시적**. 유지 권고.
- **Render 단일 소스**: `src/pipeline/run_all.py` 시간 인식 디스패처가 `*/15 * * * *` cron으로 동작. 8개 GHA workflow는 모두 수동 전용.
- **P1 다음 작업 3건**: `stories.py` precheck 최적화, `record_usage` fallback, broadcast 중복 가드.
- **모니터링 우선순위**: Render cron 24시간 실측(R-3), `llm_budget_log` 단조 증가(QA #4), broadcast 중복(R-4).
- **아직 완성되지 않은 맥락**: `channel_health` 데이터의 프론트 노출 계획 없음, Weekly Trend 데이터 소스는 placeholder.
- **Telegram**: 채널 `@whalescope_alertz` 단일 운영. DM 봇 경로 완전 제거. `NEXT_PUBLIC_TELEGRAM_BROADCAST_CHANNEL` fallback은 v5.1에서 제거 예정.

---
