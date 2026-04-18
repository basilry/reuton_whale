# WhaleScope Dashboard — Design System Refactor Prompt (Phase 2)

> Claude Code에 던져 넣을 단일 작업 프롬프트. 이미 완성된 Layer 1·2(토큰·프리뷰)를 기준으로 `/`(오퍼레이터)와 `/insights`(사용자) 두 실제 화면을 디자인 시스템에 맞게 재구성합니다.
>
> **사용 방법**: Claude Code 세션을 프로젝트 루트에서 시작한 뒤 이 문서 전체 또는 "Prompt Body" 섹션만 붙여넣기. `@docs/05_ClaudeCode_Prompt_DesignRefactor.md`로 참조해도 됩니다.

---

## 배경 (이 프롬프트를 쓰기 전 사용자가 알아야 할 것)

- Phase 1 완료 상태:
  - `apps/dashboard/app/design-tokens.css` — OKLCH 컬러, 8pt 스페이싱, 5-step 엘리베이션, 6 duration + 6 easing 등 모든 토큰의 단일 소스. 라이트 기본 + `[data-theme="dark"]` 다크.
  - `apps/dashboard/app/globals.css` — 리셋 + 토큰 치환 완료. 레거시 hex/rgba 리터럴 0건.
  - `apps/dashboard/app/layout.tsx` — FOUC 방지 pre-paint 스크립트 탑재. `localStorage['whalescope.theme']` → `prefers-color-scheme` → `light` 순.
  - `apps/dashboard/app/preview/{page.tsx,preview.module.css}` — 17개 섹션 검증 표면. 모든 섹션의 정답 토큰·패턴이 여기 있음.
  - `apps/dashboard/components/theme-toggle.tsx` — 클라이언트 토글. 양쪽 화면에 배치될 예정.
  - `apps/dashboard/DESIGN.md` — 토큰 카탈로그 + 원칙.
- Phase 2 목표: 위 파운데이션을 실제 두 화면(`app/page.tsx`, `app/insights/page.tsx`)과 모든 공유 컴포넌트(`components/*.tsx`)에 적용해 **기능은 바꾸지 않고 외관만** 디자인 시스템에 정합시킴.

---

## Prompt Body (Claude Code에 붙여넣기)

````markdown
# Role
당신은 WhaleScope Dashboard(Next.js 15 App Router · React 19 · TypeScript 5.7)의 디자인 시스템 리팩터링을 수행하는 프론트엔드 엔지니어입니다. 목표는 **외관의 완전한 토큰화**이며, **기능·컴포넌트 API·데이터 흐름은 단 1바이트도 바꾸지 않습니다**.

# Mission
`apps/dashboard/app/page.tsx`(오퍼레이터)와 `apps/dashboard/app/insights/page.tsx`(사용자) 두 화면, 그리고 `apps/dashboard/components/*.tsx` 전부를 Layer 2 토큰 + CSS Module 패턴으로 재구성합니다. `app/preview/`에 이미 완성된 패턴을 사실상의 스펙으로 간주합니다.

# Must-read first (read but do NOT edit)
아래 순서대로 읽고 구조를 파악한 뒤에만 작성 작업에 들어갑니다.

1. `apps/dashboard/DESIGN.md` — 토큰 체계·원칙·금지 패턴 한 번에 보기.
2. `apps/dashboard/app/design-tokens.css` — 사용 가능한 토큰 전량. 새 토큰 추가는 마지막 수단이며, 추가 시에는 이 파일에만, Phase 2 섹션을 주석으로 표시하고 추가.
3. `apps/dashboard/app/globals.css` — 리셋·베이스 타이포그래피·body 스타일. 컴포넌트별 CSS는 **모두 각 컴포넌트의 .module.css로 이전**한 상태여야 최종 형태. 현재 남아 있는 컴포넌트성 클래스들을 다음 Wave에서 이전하세요.
4. `apps/dashboard/app/preview/preview.module.css` — 17개 섹션 정답 레퍼런스. 클래스명/구조/모션/톤 차용의 기준.
5. `apps/dashboard/app/preview/page.tsx` — 동일 컴포넌트의 마크업 레퍼런스.
6. `apps/dashboard/app/insights/insights.module.css` — 이미 CSS Module 패턴을 쓰고 있으므로 토큰 적합성 감사 대상.
7. `apps/dashboard/components/theme-toggle.tsx` — 이미 완성. 양쪽 네비에 배치.
8. 기존 `apps/dashboard/app/page.tsx`, `apps/dashboard/app/insights/page.tsx`, 그리고 `apps/dashboard/components/` 이하 전체 `.tsx`를 훑고 의존관계를 머릿속에 그리세요. 데이터 페칭 함수(`lib/*`)는 건드리지 않습니다.

# Non-negotiable constraints
1. **토큰만 쓴다.** 컴포넌트 CSS 어디에서도 hex / rgb / rgba / oklch 리터럴·임의 px(13/17/25)·임의 ms 사용 금지. 모두 `var(--token)` 경유. 검증 커맨드: `rg -nP '#[0-9a-fA-F]{3,8}|rgba?\(|oklch\(' apps/dashboard/{app,components} --type css` → 출력 0줄.
2. **CSS Module 일관성.** 모든 컴포넌트는 `Component.tsx` + `Component.module.css` 페어. 전역 클래스 신규 추가 금지. 기존 globals의 컴포넌트 클래스는 각 Module로 이전 후 globals에서 제거.
3. **기능 변경 금지.** 컴포넌트 props, export 이름, lib 함수 시그니처, API 라우트, 데이터 스키마 전부 그대로. 리네이밍/이동 금지(단 새 컴포넌트 추출은 허용 — 아래 Wave 1 참조).
4. **Absolute bans (AI slop).** 위반 시 재작업:
   - `border-left: Npx solid <color>` 사이드 스트라이프 카드
   - `background-clip: text` + 그라디언트 텍스트
   - `transition: all` — 반드시 속성 지정(`transform`, `opacity`, `background-color`, `color`, `border-color` 중)
   - `ease-in` 이징을 UI 인터랙션에 사용
   - `outline: none` / `outline-none`에 `:focus-visible` 대체 없음
   - `<div onClick>` / `<span onClick>` — `<button>` 또는 `<a>` 사용
   - 8pt 그리드 이탈 스페이싱(3/5/7/9/13/17/25/27px 등)
   - 보라-핑크 그라디언트(from-purple → to-pink)
5. **테마 정합.** 라이트/다크 모두에서 대비·간격·계층이 깨지지 않을 것. 배경은 `--paper/--surface-*`, 다크 의도 영역만 `--inverse-*`. 섀도는 `--elev-1~5`. 다크에서는 섀도 약해지므로 배경 단계(`--surface-container-*`)로 계층을 표현.
6. **모션 규칙.**
   - 기본 duration: `var(--duration-quick)` (160ms), 표준 UI는 `--duration-standard` (200ms), 드로어/모달만 `--duration-emphatic` + `--ease-drawer`.
   - 고빈도(토글/체크박스)는 `--duration-instant` 또는 무모션.
   - `transform`, `opacity`, `color`, `background-color`, `border-color`, `box-shadow`만 애니메이트. 준비된 프리셋: `--transition-color / --transition-bg / --transition-border / --transition-opacity / --transition-transform`.
   - `@media (prefers-reduced-motion: reduce)`에서 duration → 0.01ms 감소, opacity 전환은 유지.
7. **접근성 floor.**
   - 모든 인터랙티브 요소에 `:hover` / `:active` / `:focus-visible` / `disabled` 스타일.
   - 포커스 링은 `box-shadow: 0 0 0 var(--focus-ring-width) var(--focus-ring-color)` 또는 `outline: var(--focus-ring-width) solid var(--focus-ring-color); outline-offset: var(--focus-ring-offset)` 로만.
   - 모든 아이콘 버튼에 `aria-label`, 장식 아이콘에 `aria-hidden="true"`.
   - 본문 대비 4.5:1, UI 요소 3:1 준수.
8. **Code discipline.**
   - 전체 파일 재작성 금지. `Edit` 기반 최소 변경. 파일당 300줄을 넘기면 분할을 검토.
   - `"use client"`는 꼭 필요한 훅을 쓰는 컴포넌트에만. 서버 컴포넌트 기본.
   - `className={\`${a} ${b}\`}` 보다 `clsx` 또는 템플릿을 사용하되, 새 의존성 도입은 금지(`clsx`가 이미 있다면 활용).

# Token allowlist (CSS에서 쓸 수 있는 것들)
컬러: `--accent / --accent-dark / --accent-soft / --accent-softer / --accent-container / --secondary / --secondary-container / --tertiary / --good / --good-soft / --good-softer / --warn / --warn-soft / --warn-softer / --bad / --bad-soft / --bad-softer / --error / --on-error / --ink / --muted / --muted-strong / --on-surface / --on-surface-variant / --on-accent`

Surface: `--paper / --paper-alt / --surface / --surface-container-low / --surface-container / --surface-container-high / --surface-container-highest / --panel / --panel-strong / --panel-glass`

Inverse(의도된 다크 영역): `--inverse-surface / --inverse-surface-high / --inverse-on-surface / --inverse-on-surface-muted / --inverse-outline / --inverse-accent`

Border/Line: `--line / --line-strong / --outline-variant`

Signal: `--signal-good-fg / --signal-good-bg / --signal-good-border / --signal-warn-fg / --signal-warn-bg / --signal-warn-border / --signal-bad-fg / --signal-bad-bg / --signal-bad-border / --signal-neutral-fg / --signal-neutral-bg / --signal-neutral-border`

Typography: `--font-display / --font-body / --font-mono / --text-2xs ~ --text-4xl / --leading-* / --tracking-* / --weight-* / --measure-prose / --measure-wide`

Space/Radius/Elev/Motion: `--space-3xs ~ --space-5xl / --radius-none ~ --radius-full / --elev-0 ~ --elev-5 / --duration-* / --ease-*`, 프리셋 5종(`--transition-*`).

Z-index: `--z-base / --z-raised / --z-sticky / --z-navbar / --z-dropdown / --z-floating-badge / --z-modal-backdrop / --z-modal / --z-toast / --z-tooltip`.

Focus: `--focus-ring-color / --focus-ring-width / --focus-ring-offset`.

필요하면 inverse 패밀리의 보조 토큰(`--inverse-muted` 등)은 `design-tokens.css`에 추가 가능하되, Phase 2에서 신규 토큰을 5개 이상 추가하게 되면 중단하고 사용자 확인.

# Execution plan — 5 Waves (정확히 이 순서대로)

## Wave 0 — Reconnaissance (읽기만)
- Must-read 목록을 순서대로 읽고, 각 페이지의 현재 섹션 구성(헤더·카드·그리드 레이아웃)을 내 기억 속에 스케치.
- 각 컴포넌트가 현재 어느 CSS 클래스를 사용 중인지 표로 정리(머릿속에만 — 사용자에게 보고하지 않음).
- 이 Wave는 단 하나의 파일도 수정하지 않습니다.

## Wave 1 — Shell extraction & navigation parity
목적: 두 화면이 같은 네비게이션 · 테마 토글 · 사이드바 규칙을 공유.

1. `components/top-navbar.tsx` + `top-navbar.module.css` 신규 생성. 마크업과 클래스는 `preview.module.css`의 `.navSample*` 계열을 레퍼런스로 삼아, 실제 메뉴(대시보드 / 인사이트 / 시그널 / 리포트)를 탭 네비로 배치. 우측에는 `ThemeToggle`과 `LanguageSelector`(이미 존재) 배치. 현재 활성 경로 active state는 Next `usePathname()`으로(이 컴포넌트만 `"use client"`).
2. `components/insights-sidebar.tsx` + `insights-sidebar.module.css` 신규 생성. 마크업은 `.sidebarSample*` 레퍼런스. 링크: 대시보드(`/`) / 분석(`/insights`) / 고래 감시(`/insights#watchlist`) / 시그널 허브(`/insights#signals`) / 설정(향후). 브랜드 헤더에 "WhaleScope / Insights".
3. `app/page.tsx`와 `app/insights/page.tsx` 상단부에 이 두 컴포넌트를 배치. 단, 이 Wave에서는 **shell 교체만**. 본문 카드 마크업 리팩터는 Wave 2·3에서.
4. 두 네비 모두 `:focus-visible` 키보드 내비를 구현하고, 모바일(≤640px)에서 네비는 가로 스크롤로 처리(`overflow-x: auto; scroll-snap-type: x mandatory`). 사이드바는 좁은 화면에서 상단 가로 탭 형태로 변환.
5. `app/globals.css`에 남아 있는 레거시 네비 클래스(`.top-navbar`, `.nav-links` 등)는 **이 Wave에서 제거**. 이전된 스타일은 각 Module에서만.

검증 체크:
- `rg -n 'top-navbar' apps/dashboard` → `globals.css`에서 0건, `components/top-navbar.tsx`와 `.module.css`에서만 검출.
- `npx tsc --noEmit -p apps/dashboard` 통과.
- 두 화면 모두에서 라이트/다크 토글이 동작 + 키보드로 네비 각 링크 이동 가능.

## Wave 2 — `/` 오퍼레이터 대시보드 본문
목적: 히어로 배너, 서비스 헬스, Daily Brief, 시그널 + 체크리스트, 타임라인, OpLog를 preview 레퍼런스에 맞춰 토큰화.

1. `app/page.module.css` 신규 생성(`insights.module.css`와 대칭되는 위치). 레퍼런스: `preview.module.css`의 `.hero / .serviceGrid / .briefCard / .signalGrid / .checklistCard / .timelineCard` 블록.
2. `app/page.tsx`를 **Edit로만** 수정:
   - 기존 JSX 구조는 유지하되 className을 `styles.*`로 교체.
   - 데이터 페칭 훅·lib 함수·컴포넌트 props 변경 금지.
   - 절대 금지: 새 API 호출, 새 상태, 새 라우팅.
3. `BriefPanel`, `SignalActionCard`, `MetricCard`, `RunStatusBadge`, `SystemLogPanel` 등 사용 중인 컴포넌트는 **이 Wave에서는 내부 스타일을 건드리지 않음** — 단, 부모 컨테이너 그리드의 gap·padding은 토큰으로 재설정.
4. 오퍼레이터 체크리스트는 의도된 다크 영역 → `--inverse-*` 토큰 패밀리만 사용. preview의 `.checklistCard` 블록을 참고.
5. 시그널 카드는 4-tone(`good/warn/bad/neutral`) data-attribute로 분기. 사이드 스트라이프 절대 금지.

검증 체크:
- `app/page.module.css`에 hex/rgba/oklch 리터럴 0건.
- 히어로 배너의 카피·메타칩·CTA가 모바일(≤640px)에서 세로로 쌓임.
- 라이트/다크에서 시그널 카드 4종 대비 AA 통과.

## Wave 3 — `/insights` 사용자 뷰 본문
목적: 이미 CSS Module 패턴인 `insights.module.css`의 토큰 적합성을 감사하고 필요한 곳만 토큰 치환.

1. `insights.module.css` 전체를 훑으며 hex/rgba 리터럴을 `var(--token)`로 치환. 가능한 한 `replace_all` 대신 문맥별 최소 치환.
2. Mood 게이지는 preview의 `.moodGauge` SVG 접근(`strokeDasharray` / `strokeDashoffset`)을 채택. 기존 구현이 같은 방식이면 유지.
3. Watchlist 카드·Telegram CTA·Stories 카드·Risk disclaimer 모두 토큰만 참조하도록.
4. 새 `insights-sidebar`를 상단에 연결하고, 본문은 그리드 셸 안에 배치. 데스크탑은 2열(사이드바 + 본문), 모바일(≤768px)에서는 사이드바가 상단 가로 탭으로 변환.
5. AI explain 플로우 섹션은 preview의 `.explainFlow` 구조 차용.

검증 체크:
- `insights.module.css`에 hex/rgba/oklch 리터럴 0건.
- 모든 카드의 radius가 `--radius-md` 또는 `--radius-lg`, spacing이 8pt 그리드 내.

## Wave 4 — Shared components 토큰화
대상 파일 (각 파일에 대응하는 `.module.css`를 **신규 생성**하고 인라인 스타일·글로벌 클래스를 이전):

- `components/brief-panel.tsx` — `brief-panel.module.css`. preview `.briefCard` 톤 차용.
- `components/signal-action-card.tsx` — `signal-action-card.module.css`. preview `.signalCard` 패턴, 4-tone data-attribute.
- `components/signals-table.tsx` — `signals-table.module.css`. 테이블 헤더 `--surface-container`, 바디 행은 hover `--surface-container-low`. 숫자 열은 `font-variant-numeric: tabular-nums`.
- `components/metric-card.tsx` — `metric-card.module.css`. 엘리베이션 `--elev-2`, 라운드 `--radius-lg`.
- `components/run-status-badge.tsx` — `run-status-badge.module.css`. pill 패턴 + 4-tone.
- `components/system-log-panel.tsx` — `system-log-panel.module.css`. 의도적 다크 영역이면 `--inverse-*`, 아니면 `--surface-container-high` 기반.
- `components/transactions-table.tsx` — `transactions-table.module.css`. in/out 배지(`--accent-soft` / `--good-soft`).
- `components/watchlist-editor.tsx` — `watchlist-editor.module.css`. 입력/버튼 pattern은 preview `.btnPrimary/.btnSecondary/.btnDanger` 차용.
- `components/language-selector.tsx` — `language-selector.module.css`. 드롭다운 패턴 + `--z-dropdown`.
- `components/dashboard-shell.tsx` — 존재 여부를 먼저 확인하고, Wave 1의 `top-navbar`로 대체 가능하면 deprecation 주석만 남기고 점진 이전.

각 컴포넌트에 대해:
1. 기존 글로벌 클래스 참조를 `styles.foo`로 치환.
2. 인라인 `style={{ ... }}` 하드코딩은 제거 — 동적 값(width, strokeDashoffset 등)만 허용.
3. props 및 export는 불변.
4. `:hover`, `:focus-visible`, `:active`, `disabled`, `loading`, `error` 상태가 필요한 컴포넌트에 모두 정의.

## Wave 5 — Cleanup · Polish · Verification
1. `app/globals.css`에서 컴포넌트성 클래스(존재한다면)를 모두 제거. 남기는 항목: CSS 리셋, `@font-face`/폰트 임포트, `body` 베이스(폰트·컬러·배경), `html { scroll-behavior: smooth }`, `.sr-only`, `:focus-visible` 공통 규칙, `prefers-reduced-motion` 공통 규칙.
2. 전역 검사:
   - `rg -nP '#[0-9a-fA-F]{3,8}|rgba?\(|oklch\(' apps/dashboard/{app,components} --type css -g '!design-tokens.css'` → 0건.
   - `rg -n 'transition: all' apps/dashboard/{app,components}` → 0건.
   - `rg -n 'ease-in[^-]' apps/dashboard/{app,components} --type css` → UI 애니메이션에 쓰인 곳 0건(프리셋 `--ease-in-out`은 허용).
   - `rg -n 'onClick' apps/dashboard/components --type tsx | rg -v 'button|<a\\b'` → 0건.
3. `npx tsc --noEmit -p apps/dashboard` → 0 에러.
4. `npm --prefix apps/dashboard run lint` → 0 에러(있다면 next lint 룰 기준).
5. `npm --prefix apps/dashboard run build` → 성공.
6. 라이트/다크 두 테마에서 `/`, `/insights`, `/preview` 세 경로를 순회하며 시각적 회귀 점검 — 가능하다면 `design-checker` 또는 `qa-checker` 스킬을 사용해 스크린샷 기반 검증을 수행.
7. WCAG AA 대비 점검 — 본문 4.5:1, UI 3:1. 실패 시 해당 토큰의 α값 또는 `--muted` 톤을 `design-tokens.css`에서 미세 조정(새 토큰 생성은 지양).

# Reporting protocol
각 Wave를 마치면 아래 형식으로 **짧게** 보고하세요. 장문 금지.

```
Wave N — [제목] ✓/✗
Files touched: a.tsx / a.module.css / ...
Verification:
  - tsc: pass/fail
  - rg hex/rgba: N hits (expected 0)
  - visual parity: light ✓ dark ✓
Notes: (있으면 한 줄)
```

모든 Wave 종료 후 최종 보고:
```
## Done
- Refactored pages: /, /insights
- Refactored components: N files
- New modules: M CSS modules
- Removed globals: K component classes

## Verification
- tsc ✓ / lint ✓ / build ✓
- hex/rgba: 0 in components+app (except design-tokens.css)
- theme parity: verified light & dark

## Open questions (if any)
- (예: "Material Symbols → Lucide 마이그레이션을 Phase 3로 분리할까요?")
```

# When to stop and ask
다음 상황이면 **즉시 멈추고 사용자에게 질문**:
- `design-tokens.css`에 신규 토큰을 3개 이상 추가해야 할 때 → 사용자 승인 필요.
- 컴포넌트 props를 바꿔야만 리팩터가 가능하다고 판단될 때 → 사용자 승인 필요.
- 기존 기능이 현재 구현된 방식에 대해 의도가 불분명할 때(특히 lib/*의 비즈니스 로직) → 물어서 확인.
- 테마 정합이 특정 영역에서 불가능해 보일 때 → 토큰으로 해결 불가한 UX 트레이드오프를 제시하고 결정 요청.

# Out of scope (Phase 3 이후)
- Material Symbols → Lucide React 마이그레이션.
- 테이블의 가상 스크롤(`virtua` / `content-visibility`).
- URL 상태 동기화(탭/필터 쿼리 파라미터).
- Storybook 도입.
- E2E 시각 회귀 CI.

이 5개 항목은 **건드리지 마세요**. 필요하다고 느껴도 Open questions에만 올리고 중단.

# Start command (Claude Code)
"Wave 0 Reconnaissance부터 시작. Must-read 파일 8개를 순서대로 읽고, 준비가 되면 Wave 1부터 작업을 실행하세요. 각 Wave의 Verification을 통과하기 전에는 다음 Wave로 넘어가지 않습니다."
````

---

## Tips — 이 프롬프트를 실전에서 잘 돌리는 법

1. **긴 세션 분할**: Wave 1·2 → `/compact` → Wave 3·4 → `/compact` → Wave 5. 컨텍스트 오염 최소화.
2. **하위 에이전트 활용**: Wave 4의 컴포넌트 9개는 `Agent` 툴로 병렬 위임 가능. 다만 **공유 토큰 추가는 병렬 작업 사이 충돌 가능**하므로 토큰 확정은 Wave 0에서 완료.
3. **커밋 전략**: 각 Wave가 Verification을 통과한 직후 원자 커밋. 메시지 예: `refactor(dashboard): wave 2 — operator page CSS modules`.
4. **실패 복구**: 한 Wave의 Verification이 실패하면 다음 Wave로 넘어가지 말고 `git restore --staged` 후 해당 Wave만 재실행.
5. **스크린샷 근거**: Wave 5에서 `design-checker` 스킬로 라이트/다크 모두 1440px · 393px 뷰포트 스크린샷을 남기면 회귀 기준선이 됩니다.

## Changelog
- 2026-04-17 · 초안 작성.
