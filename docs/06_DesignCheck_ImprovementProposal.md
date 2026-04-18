# 06. 디자인 체크 및 개선안 제안 (WhaleScope Dashboard)

> **작성일**: 2026-04-18
> **대상 범위**: `/apps/dashboard` — 운영 대시보드 `/`, 인사이트 `/insights`, 프리뷰 `/preview`
> **기준 문서**: `04-준비/05_ClaudeCode_Prompt_DesignRefactor.md` (W1–W5 실행 프롬프트)
> **리뷰 프레임**: Design-Engineering 4-Layer + Vercel WIG + WCAG 2.1 AA
> **주 이해관계자**: 제품 오너(Kim), 운영 팀, 외부 리뷰어(투자자/기술 인터뷰어)

---

## 0. Executive Summary (TL;DR)

| 항목 | 결과 | 심각도 |
| --- | --- | --- |
| **토큰 규율 (Layer 2)** | PASS — 모든 hex/rgba/oklch 리터럴이 `design-tokens.css`로 격리됨 | — |
| **AI-slop 패턴** | 1건 위반 — `.riskBanner`의 side-stripe `border-left: 4px solid` | **P0** |
| **전이/이징 규율** | PASS — `transition: all`·UI-level `ease-in` 제로 | — |
| **focus-visible 대체** | PASS — 모든 `outline: none`이 토큰 기반 `box-shadow` 포커스 링으로 대체됨 | — |
| **헤더/네비 정합성** | FAIL — 실제 `TopNavbar`가 프리뷰 `.topBar` 대비 8개 속성에서 이탈 | **P1** |
| **시각 QA** | BLOCKED — localhost 비실행, 정적 코드 감사로 대체 · 수동 QA 필요 | **P2** |

**핵심 권고**: 운영 대시보드(`/`)와 인사이트(`/insights`)가 공유하는 `TopNavbar`를 프리뷰의 editorial-calm 방향으로 재정렬하고, `.riskBanner` side-stripe 위반 1건을 즉시 제거. 토큰 계층 자체는 건강하며 W1–W5 리팩터가 의도대로 수렴했다.

---

## 1. Methodology & Scope

### 1.1 수행한 점검
1. **Task #17 — 네비/헤더 코드 비교**: `components/top-navbar.{tsx,module.css}` ↔ `app/preview/preview.module.css`의 `.topBar` 블록을 선별적으로 diff.
2. **Task #19 — 토큰 정합성 감사**: `apps/dashboard/**/*.css` 전체에 대해 5종 grep — hex(`#[0-9a-fA-F]{3,8}`), rgba/oklch 리터럴, `transition: all`, `ease-in` (ease-in-out 제외), `border-left: …solid`, `outline: none`, `background-clip: text`.
3. **Task #18 — 시각 QA**: localhost 실행 여부 확인(`curl`). 서버 미실행 → 동적 스크린샷 QA 생략, 정적 코드 감사로 대체. 본 문서 §7에 수동 실행 절차 첨부.

### 1.2 제외한 점검 (Out of Scope)
- 브라우저별 렌더링 차이 (Chromium/Firefox/Safari) — 별도 QA 세션 필요.
- 성능/런타임 지표 (CLS/LCP/INP) — Lighthouse 런 필요, 동적 서버 전제.
- 접근성 동적 테스트 (스크린리더 실동작, axe-core) — 수동 QA 단계에서 실행.

---

## 2. 토큰 정합성 감사 (Task #19)

### 2.1 감사 쿼리 결과

| 안티패턴 | 컴포넌트/페이지 CSS 안에서 히트 | 판정 |
| --- | --- | --- |
| `#[0-9a-fA-F]{3,8}` 리터럴 | 0 (코드 내 모든 히트는 `design-tokens.css` 내 `/* legacy #... */` 주석뿐) | ✅ PASS |
| `rgba(...)` / `oklch(...)` 리터럴 | 0 (위와 동일, 선언부는 토큰 파일 전용) | ✅ PASS |
| `transition: all` | 0 | ✅ PASS |
| `ease-in` (ease-in-out 제외) | 0 (유일 히트는 `design-tokens.css:228`의 **금지 안내 주석**) | ✅ PASS |
| `border-left: <n>px solid` (side-stripe) | **1 — `insights.module.css:219`** | ❌ **FAIL** |
| `outline: none` | 6건, 모두 `box-shadow` 포커스 링과 짝 이룸 | ✅ PASS |
| `background-clip: text` (그라디언트 텍스트) | 0 | ✅ PASS |
| `<div onClick>` / `<span onClick>` | — (별도 타입 체크 필요, 본 스코프 외) | Deferred |

### 2.2 유일한 위반 — `.riskBanner`

```css
/* apps/dashboard/app/insights/insights.module.css:216-221 */
.riskBanner {
  padding: var(--space-md);
  background: var(--bad-softer);
  border-left: 4px solid var(--bad-soft);   /* ← AI-slop 안티패턴 */
  border-radius: var(--radius-md);
}
```

**왜 문제인가** — Design-Engineering §09 anti-patterns의 **#1 Absolute Ban**. "카드에 `border-left: 4px solid`"는 GPT-4/Claude가 생성한 코드의 대표적 식별 표식이고, 브랜드 시각 언어에도 근거가 없다(프리뷰 토큰 어디에도 side-stripe 패턴이 없음).

**대체안 3종** (우선순위 순):

```css
/* Option A — 전방위 soft border (권장, 프리뷰 톤과 일치) */
.riskBanner {
  padding: var(--space-md);
  background: var(--bad-softer);
  border: 1px solid var(--bad-soft);
  border-radius: var(--radius-md);
}

/* Option B — 상단 얇은 라인으로 시선 진입점만 표시 */
.riskBanner {
  padding: var(--space-md) var(--space-md) var(--space-md);
  background: var(--bad-softer);
  border-top: 1px solid var(--bad);
  border-radius: var(--radius-md);
}

/* Option C — 아이콘+카피만 (border 제거, 배경만으로 톤 전달) */
.riskBanner {
  padding: var(--space-md);
  background: var(--bad-softer);
  border-radius: var(--radius-md);
  /* 좌측에 material-symbols의 warning 아이콘 배치 — JSX 측에서 처리 */
}
```

프리뷰의 `§11 상태 컬러` 블록(`.statusNeutralBanner` 등)이 Option A와 같은 전방위 border 패턴을 이미 사용 중이므로 Option A가 시스템 일관성 관점에서 가장 낮은 변경 비용.

### 2.3 outline: none 패턴 점검

모든 6개 히트를 수동 확인한 결과, 형태가 동일:

```css
.foo:focus-visible {
  outline: none;
  box-shadow:
    0 0 0 var(--focus-ring-offset)       var(--surface-container),
    0 0 0 calc(var(--focus-ring-offset)
             + var(--focus-ring-width))  var(--focus-ring-color);
}
```

`outline: none` 단독 사용이 아니라 토큰 기반 이중 링(offset 레이어 + accent 레이어) 포커스 교체와 **항상 쌍을 이룬다**. Design-Engineering Absolute Ban(#8 `outline: none`에 focus-visible 대체 없음)을 정확히 우회한 올바른 구현.

> 단, `preview.module.css:112-115`의 `.themeBtn:focus-visible`는 예외적으로 `outline: ... solid; outline-offset: ...` 패턴을 사용 — 둘 다 토큰 기반이라 규칙 위반은 아니나, 다른 컴포넌트가 모두 `box-shadow` 방식으로 통일됐으므로 **선택적 정합성 개선 대상**(P2).

---

## 3. 네비/헤더 정합성 분석 (Task #17)

### 3.1 8개 속성 비교 매트릭스

| # | 속성 | Preview (`.topBar`) | 실제 (`TopNavbar`) | 드리프트 방향 |
| --- | --- | --- | --- | --- |
| 1 | 브랜드 레이아웃 | 2단 세로 스택 (`flex-direction: column`, `gap: 2px`) | 1단 가로 (`inline-flex`, `gap: --space-xs`) | editorial → operational |
| 2 | 브랜드 서브타이틀 | `.brandSubtitle` — `text-2xs uppercase tracking-wider` | 없음 | editorial → operational |
| 3 | 브랜드 로고 이미지 | 없음 (텍스트-온리 editorial mark) | `next/image 28×28 /logo.png` | operational → visual |
| 4 | 브랜드 폰트 크기 | `--text-lg` | `--text-md` | 축소 |
| 5 | 컨테이너 엘리베이션 | `--elev-2` | `--elev-1` | 약화 |
| 6 | Inner 패딩 | `var(--space-md) var(--space-xl)` | `var(--space-sm) var(--space-xl)` | 축소 (Y축만) |
| 7 | Inner max-width | `1440px` | `1920px` | 확장 |
| 8 | 탭 gap | `--space-sm` | `--space-2xs` | 축소 |
| 9 | 탭 스타일 | 순수 pill (`--radius-full` + bg only) | pill + border-bottom 하이브리드 | 혼합 |
| 10 | 액티브 탭 표시 | (§0 anchorNav에 미정의 — §8 `navSample`이 underline-only) | bg `--accent-soft` **AND** border-bottom `--tertiary` | 이중 강조 |
| 11 | 테마 버튼 크기 | 40×40 | 36×36 | 축소 |
| 12 | 포커스 링 구현 | `outline + outline-offset` | `box-shadow` 이중 링 | 분기 |

### 3.2 드리프트의 누적 의미

개별 항목은 모두 작지만 **방향성이 일관되게 "더 빽빽하고, 더 평평하고, 더 강한 액티브 표시"** 쪽으로 흘러가면서 Layer 1에서 정의한 `editorial calm + glassmorphism` 톤이 **operational admin-panel** 쪽으로 밀렸다. 주된 원인은 W1–W5 리팩터 당시 기존 레거시 UI(`--space-sm` 패딩, `--elev-1`)를 그대로 승계했기 때문으로 추정(프리뷰는 이번 리팩터에서 새로 설계한 기준값).

### 3.3 탭 액티브 표시의 시각적 노이즈

현재 `.tabLink[data-active="true"]`는 **세 가지 강조를 동시에** 건다:

```css
.tabLink[data-active="true"] {
  color: var(--accent);              /* (a) 색상 */
  font-weight: var(--weight-semibold); /* (b) 굵기 */
  background: var(--accent-soft);    /* (c) 배경 — 추가 강조 */
  border-bottom-color: var(--tertiary); /* (d) 하단 라인 — 추가 강조 */
}
```

WCAG 성공 기준 1.4.1 (색상 비의존) 관점에서는 다중 채널이 이상적이지만, `(a) + (b)`만으로도 이미 비의존성을 만족한다. `(c) + (d)`는 **중복 강조로 시각 노이즈**가 된다. 프리뷰의 `navSample`은 `(a) + underline only` 구조로 간결하게 처리 — 이 쪽이 피로도가 낮다.

---

## 4. Before / After / Why 테이블 — 네비/헤더 통합 개선안

> **실행 원칙**: 프리뷰의 editorial-calm 방향으로 정렬. 단, "로고 이미지"는 실제 구현의 장점이므로 유지. 서브타이틀은 반응형으로 `md:` 이상에서만 노출.

| # | Before (현재 `top-navbar.module.css`) | After (제안) | Why |
| --- | --- | --- | --- |
| B1 | `.navbar { box-shadow: var(--elev-1); }` | `.navbar { box-shadow: var(--elev-2); }` | 스티키 헤더임을 시각적으로 더 명확히. 글래스 배경(`blur(20px)`)과 짝이 맞는 그림자 층위는 `--elev-2`. |
| B2 | `.inner { padding: var(--space-sm) var(--space-xl); max-width: 1920px; }` | `.inner { padding: var(--space-md) var(--space-xl); max-width: 1440px; }` | 프리뷰·모든 카드 `max-width: 1440px`로 통일된 상태. 1920px면 ultrawide에서 콘텐츠와 네비의 가로 폭이 어긋남. Y축 패딩도 editorial-calm 기준 `--space-md`로 복구. |
| B3 | `.brand { display: inline-flex; … gap: var(--space-xs); font-size: var(--text-md); }` | `.brand { display: inline-flex; gap: var(--space-xs); } .brandTextBlock { display: flex; flex-direction: column; gap: 2px; } .brandTitle { font-size: var(--text-lg); } .brandSubtitle { font-size: var(--text-2xs); display: none; } @media (min-width: 768px) { .brandSubtitle { display: inline; } }` | 로고는 유지(시각적 앵커). 텍스트만 2단 세로 스택으로 재조립해서 editorial voice 회복. 모바일에선 공간 상 서브타이틀 숨김(썸존 보호). |
| B4 | `.tabNav { gap: var(--space-2xs); }` | `.tabNav { gap: var(--space-xs); } @media (max-width: 640px) { .tabNav { gap: var(--space-3xs); } }` | 데스크톱에선 탭 간 여백을 한 단계 여유롭게. 모바일은 오히려 더 빽빽하게(스크롤 스냅 유지). |
| B5 | `.tabLink { border-radius: var(--radius-full); border-bottom: 2px solid transparent; }` | `.tabLink { border-radius: var(--radius-full); /* border-bottom 제거 */ } .tabLink[data-active="true"]::after { content: ""; display: block; height: 2px; margin-top: var(--space-3xs); background: var(--tertiary); border-radius: var(--radius-full); }` | pill radius와 bottom-border는 형태학적으로 충돌(둘 다 형태를 닫으려는 제스처). 액티브일 때만 pseudo-element로 underline을 드롭인 — pill 형태 유지하면서 active 상태 신호 전달. |
| B6 | `.tabLink[data-active="true"] { color: var(--accent); background: var(--accent-soft); border-bottom-color: var(--tertiary); }` | `.tabLink[data-active="true"] { color: var(--accent); font-weight: var(--weight-semibold); /* background 제거 */ }` | 위 B5의 `::after` underline과 color+weight 조합으로 비의존성 만족. 배경 강조는 호버 전용으로 격상. |
| B7 | `.tabLink:hover { color: var(--accent); background: var(--accent-soft); }` | `.tabLink:hover { color: var(--accent); background: var(--accent-softer); }` | `--accent-soft` (0.14 alpha)는 active와 동급 강조 → 구분 불가. hover는 `--accent-softer` (0.06 alpha)로 한 단계 낮춰 위계 차별. |
| B8 | `.themeBtn { width: 36px; height: 36px; }` | `.themeBtn { width: 40px; height: 40px; }` | 40×40는 프리뷰 기준값이자 iOS HIG 44pt 터치 타깃에 한 칸 모자람 수준 — 36은 작은 손/모바일에서 미스탭 가능. |
| B9 | — | `.tabLink { scroll-margin-top: var(--inset-navbar); }` (이미 있음, 유지) + `.brand:focus-visible` `box-shadow` 방식 focus ring (유지) | 기존 `scroll-margin-top` · focus ring 구현은 유지 (양호). 단, `.themeBtn:focus-visible`도 이미 box-shadow 방식 → 그대로 유지. |

### 4.1 JSX 변경 (최소)

현재:

```tsx
<Link href="/" className={styles.brand} aria-label="WhaleScope 홈">
  <Image src="/logo.png" alt="" width={28} height={28} className={styles.brandLogo} priority />
  <span>WhaleScope</span>
</Link>
```

제안:

```tsx
<Link href="/" className={styles.brand} aria-label="WhaleScope 홈">
  <Image src="/logo.png" alt="" width={28} height={28} className={styles.brandLogo} priority />
  <span className={styles.brandTextBlock}>
    <span className={styles.brandTitle}>WhaleScope</span>
    <span className={styles.brandSubtitle}>Whale intelligence · v0.1</span>
  </span>
</Link>
```

→ 클래스 3개 추가(`brandTextBlock` / `brandTitle` / `brandSubtitle`), 기존 `brand`는 컨테이너 레벨로 재활용.

---

## 5. 기타 발견 사항 (추가 P2)

### 5.1 프리뷰 `themeBtn:focus-visible`의 포커스 링 불일치
- `preview.module.css:112-115`는 `outline` 기반, 다른 모든 컴포넌트는 `box-shadow` 기반.
- **영향**: 기능적으로 동일하나, `outline`은 둥근 radius를 따라가지 않고 사각형으로 렌더링됨 → `--radius-full`인 `themeBtn`에서 시각 불일치 발생 가능.
- **조치**: 프리뷰만의 이슈이므로 P2. 여유 생길 때 `box-shadow` 패턴으로 통일.

### 5.2 `top-navbar.module.css` 탭 순서
- NAV_ITEMS: 대시보드 `/`, 인사이트 `/insights`, 시그널 `/insights#signals`, 리포트 `/insights#transactions`.
- `시그널`·`리포트`가 `/insights` 하위 앵커인데 최상위 탭과 같은 층위로 배치 → **정보 계층 혼동**. 인사이트 진입 후 sidebar 네비와 중복.
- **조치**(P2, 디자인 결정 필요): 최상위 탭은 `대시보드 / 인사이트` 2개로 축약하고, `시그널 / 리포트`는 InsightsSidebar로 이관. 또는 셋 모두 현 위치 유지하되 탭 레이아웃에 구분 기호(`|`) 삽입.

### 5.3 `InsightsSidebar` 링크와 `TopNavbar` 탭 중복
- Sidebar 링크: 대시보드 / 분석 / 고래 감시 `#watchlist` / 시그널 허브 `#signals` / (설정 — disabled).
- TopNavbar 탭: 대시보드 / 인사이트 / 시그널 `#signals` / 리포트 `#transactions`.
- `#signals`가 두 네비에 모두 존재 → 진입 경로 이원화. 포커스 링 이동이 혼란스러움.
- **조치**(P2): §5.2와 함께 IA 결정.

---

## 6. 실행 우선순위 및 체크리스트

### 6.1 P0 — 즉시 (AI-slop 제거)
- [ ] `apps/dashboard/app/insights/insights.module.css:219` — `.riskBanner`의 `border-left: 4px solid var(--bad-soft);` 제거, §2.2 Option A로 대체.
- [ ] 변경 후 `insights.module.css` 전체 `border-left` · `border-right` 검색해 side-stripe 잔재 없음 재확인.

### 6.2 P1 — 이번 스프린트 (네비/헤더 통합)
- [ ] `top-navbar.module.css` — §4 B1~B8 8건 Edit 적용 (파일 재작성 금지, Edit으로 부분 수정).
- [ ] `top-navbar.tsx` — §4.1 JSX 변경 적용 (`brandTextBlock` 래퍼 추가).
- [ ] 변경 후 `/`·`/insights`·`/preview` 3개 페이지 각각 `pnpm dev` 띄워 육안 확인.
- [ ] `npx tsc --noEmit -p apps/dashboard` 통과 재확인.

### 6.3 P2 — 다음 스프린트 (정합성·IA)
- [ ] `preview.module.css:112-115` `themeBtn:focus-visible`를 box-shadow 패턴으로 통일.
- [ ] TopNavbar ↔ InsightsSidebar 정보 계층 재정의 (§5.2–5.3). 디자인 결정 회의 필요.
- [ ] 전체 `*.module.css`에서 `<div onClick>`/`<span onClick>` grep (본 문서 §2.1 Deferred 항목).

---

## 7. 시각 QA 수동 실행 가이드 (Task #18 Follow-up)

> 본 문서 작성 시점에 `localhost:3000` 미실행 → 동적 스크린샷 QA를 후속 실행해야 함.

### 7.1 서버 기동
```bash
cd apps/dashboard
pnpm dev   # localhost:3000 (또는 3001)
```

### 7.2 design-checker 스킬 호출 예
```
/design-checker

URL: http://localhost:3000
Pages: /  /insights  /preview
Viewports: 1440x900 (desktop), 393x852 (mobile, iPhone 14)
Themes: light, dark  (data-theme 수동 토글 — 헤더의 테마 버튼 클릭)
Output: /sessions/sharp-eloquent-euler/mnt/02015_reuton_whale/docs/demo_pic/06-checkpoints/
```

### 7.3 확인 포인트
- [ ] 3개 페이지 × 2 뷰포트 × 2 테마 = **12장** 스크린샷 수집.
- [ ] 헤더 `/`, `/insights`, `/preview` 간 동일 스티키 톤 (이 문서의 §4 After 상태 반영 후).
- [ ] 다크 테마에서 `--panel-glass` 블러가 배경 레이어와 분리되는지 (글래스 효과 유지).
- [ ] 모바일 393px에서 탭바 가로 스크롤 정상 동작, `.brandSubtitle` 정상 숨김(§4 B3).
- [ ] `.riskBanner` (후속 P0 패치 후) side-stripe가 완전히 제거되었는지.
- [ ] WCAG 대비: `--accent` on `--panel-glass` 배경 contrast ≥ 4.5:1.

### 7.4 QA 결과 회신
결과는 별도 문서 `07_DesignCheck_VisualQA_Results.md`로 저장하고 본 문서의 §6.2 체크박스와 교차 참조.

---

## 8. 리스크 및 트레이드오프

### 8.1 B2 (max-width 1440px로 축소)
- **이점**: 모든 카드(`.main`, `.layoutShell`)와 너비 통일 → 콘텐츠–네비 축 일치.
- **리스크**: ultrawide(>1920px) 모니터에서 네비 양옆 빈 공간 발생. 운영 팀이 27" 이상 모니터를 쓰는 경우 어색할 수 있음.
- **완화**: 필요 시 `.navbar`에 `background` 풀폭 유지, `.inner`만 1440으로 제한 → 이미 이 구조임(프리뷰 `.topBar`/`.topBarInner` 분리 그대로 계승).

### 8.2 B5–B7 (탭 액티브 표시 변경)
- **이점**: 시각 노이즈 감소, pill 형태 일관성 회복.
- **리스크**: 기존 "강한 액티브 표시"에 익숙한 유저가 현재 탭 위치를 놓칠 수 있음. 특히 외부 리뷰어(투자자)가 스크린 공유 중에는 즉각성이 중요.
- **완화**: `color + weight + ::after underline` 조합은 여전히 3채널 강조. 시선 방향(상→하 underline)이 오히려 탭 콘텐츠와의 연결을 명확히 함. 두 주 운영 후 피드백 수집 제안.

### 8.3 B3 (브랜드 서브타이틀 도입)
- **이점**: editorial voice 회복, Layer 1 톤 복원.
- **리스크**: 다국어 지원(i18n) 시 서브타이틀 텍스트 길이가 튈 수 있음. "Whale intelligence · v0.1"은 13자 → 영어 기준 문제 없음. 한국어 번역 시 "고래 인텔리전스 · v0.1"도 공간 수용 가능.
- **완화**: `text-overflow: ellipsis` + `max-width`로 안전장치, 다만 프리뷰와 동일 방식.

---

## 9. 변경 추적용 부록 — Edit 가이드

> Claude Code에 던질 때 파일 전체 재작성 금지. Edit으로 부분만 수정.

### 9.1 `insights.module.css` 패치 (P0)
```
Edit file: apps/dashboard/app/insights/insights.module.css
Old string:
  background: var(--bad-softer);
  border-left: 4px solid var(--bad-soft);
  border-radius: var(--radius-md);
New string:
  background: var(--bad-softer);
  border: 1px solid var(--bad-soft);
  border-radius: var(--radius-md);
```

### 9.2 `top-navbar.module.css` 패치 (P1, 8 hunks)
1. `.navbar` 블록 — `box-shadow: var(--elev-1);` → `var(--elev-2);`.
2. `.inner` 블록 — `padding: var(--space-sm) var(--space-xl);` → `var(--space-md) var(--space-xl);`; `max-width: 1920px;` → `1440px;`.
3. `.brand` 아래 `.brandTextBlock` / `.brandTitle` / `.brandSubtitle` 3개 클래스 추가.
4. `.tabNav` 블록 — `gap: var(--space-2xs);` → `var(--space-xs);`.
5. `.tabLink` 블록 — `border-bottom: 2px solid transparent;` 제거.
6. `.tabLink:hover` — `background: var(--accent-soft);` → `var(--accent-softer);`.
7. `.tabLink[data-active="true"]` — `background` 제거, `border-bottom-color` 제거, 대신 `::after` 의사요소 추가.
8. `.themeBtn` — `width: 36px; height: 36px;` → `40px; 40px;`.

### 9.3 `top-navbar.tsx` 패치 (P1, 1 hunk)
```
Old string:
  <Image src="/logo.png" alt="" width={28} height={28} className={styles.brandLogo} priority />
  <span>WhaleScope</span>
New string:
  <Image src="/logo.png" alt="" width={28} height={28} className={styles.brandLogo} priority />
  <span className={styles.brandTextBlock}>
    <span className={styles.brandTitle}>WhaleScope</span>
    <span className={styles.brandSubtitle}>Whale intelligence · v0.1</span>
  </span>
```

---

## 10. 결론

W1–W5 리팩터 결과물은 **토큰 계층에서 구조적으로 건강**하다. 남은 위험은 두 축에 집중된다:
1. **단일 AI-slop 잔재** (`.riskBanner` side-stripe) — 3분 이내 Edit 한 건으로 제거 가능, P0.
2. **프리뷰 ↔ 실제 TopNavbar 톤 드리프트** — 운영 UI가 editorial-calm 기준선에서 operational-dense 쪽으로 밀림. §4의 8 hunks로 단일 커밋에 되돌릴 수 있음, P1.

이후 P2 정합성 개선과 수동 시각 QA(§7)를 완료하면 Layer 1에서 잡은 톤이 3개 페이지(대시보드 · 인사이트 · 프리뷰)에 일관되게 투영된다.

**다음 액션**: §6.1 → §6.2 순차 실행, §7 시각 QA로 검증, 결과를 `07_DesignCheck_VisualQA_Results.md`로 회신.
