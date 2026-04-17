# WhaleScope Dashboard — DESIGN.md

> Layer 2 (System & Tokens) — `design-engineering` 스킬 기준 포터블 디자인 시스템 문서.
> **이 문서는 `apps/dashboard/app/design-tokens.css`와 1:1 대응**합니다. 값을 바꿀 때는 두 파일을 동시에 업데이트하세요.
> 페르소나 · 톤 · 차별화는 `apps/dashboard/.design-context.md` 참조.

## 1. Visual Theme

| 항목 | 값 |
|---|---|
| Identity | WhaleScope — 온체인 고래 이동 + Daily Brief 운영 대시보드 |
| Tone | **Editorial-calm** (신뢰·평온) |
| 핵심 차별화 | Daily Brief 히어로 — 에디토리얼 타이포 + 넓은 여백 + 뉴스레터 독서감 |
| 레퍼런스 | The Morning (NYT 뉴스레터) · Stripe Atlas · Google Stitch / Material 3 |
| 배경 무드 | Light blue paper + radial gradient + glassmorphism |
| 다크 모드 | 지원 (Phase 1 — 토큰 레벨 완성, 토글 UI는 Phase 3) |

### 단 하나 기억될 요소

> 매일 아침 읽는 한 장의 레터.
> `brief-card`가 대시보드의 히어로. 다른 위젯은 brief의 사이드바.

## 2. Color Palette

### 2.1 Raw Palette — OKLCH

| Token | Light | Dark | 용도 |
|---|---|---|---|
| `--brand-primary-600` | `oklch(0.45 0.115 240)` | — (auto) | Primary accent (navy blue) |
| `--brand-tertiary-600` | `oklch(0.48 0.130 150)` | — | Good / Success (forest green) |
| `--brand-warn-600` | `oklch(0.60 0.125 70)` | — | Warn (amber) |
| `--brand-error-600` | `oklch(0.52 0.190 27)` | — | Bad / Error (vermilion) |
| `--neutral-50 … 950` | Cool-tinted gray ramp | — | Surface · Ink · Borders |

### 2.2 60/30/10 규칙

| 비중 | 역할 | 토큰 |
|---|---|---|
| 60% | **Paper / Surface** (배경) | `--paper`, `--surface-container-*` |
| 30% | **Ink** (본문·헤더 텍스트) | `--ink`, `--on-surface-variant` |
| 10% | **Accent** (CTA·링크·강조) | `--accent` *only* |

### 2.3 Semantic 토큰

| Token | Light 기본값 | Dark 오버라이드 | 용도 |
|---|---|---|---|
| `--paper` | `oklch(0.985 0.008 240)` | `oklch(0.16 0.015 240)` | 페이지 배경 |
| `--surface-container-low` | `oklch(0.955 0.012 240)` | `oklch(0.20 0.017 240)` | 패널 낮은 층 |
| `--surface-container` | `oklch(0.935 0.014 240)` | `oklch(0.23 0.019 240)` | 패널 기본 |
| `--surface-container-high` | `oklch(0.90 0.016 240)` | `oklch(0.27 0.021 240)` | 패널 강조 |
| `--panel` | `rgb(255 255 255 / 0.78)` | `rgb(30 38 50 / 0.75)` | 글래스 카드 |
| `--ink` | `oklch(0.18 0.012 240)` | `oklch(0.94 0.006 240)` | 본문 텍스트 |
| `--muted` | `oklch(0.60 0.013 240)` | `oklch(0.62 0.012 240)` | 보조 텍스트 |
| `--accent` | `oklch(0.45 0.115 240)` | `oklch(0.72 0.120 240)` | 링크·CTA |
| `--good` | `oklch(0.48 0.130 150)` | `oklch(0.72 0.140 150)` | 긍정 상태 |
| `--warn` | `oklch(0.60 0.125 70)` | `oklch(0.80 0.150 85)` | 주의 상태 |
| `--bad` | `oklch(0.52 0.190 27)` | `oklch(0.72 0.170 27)` | 부정 상태 |

### 2.4 WCAG AA 대비

| 조합 | Light 대비 | Dark 대비 | 통과 |
|---|---|---|---|
| `--ink` on `--paper` | ~15:1 | ~14:1 | ✅ AAA |
| `--muted` on `--paper` | ~5.5:1 | ~5.2:1 | ✅ AA |
| `--accent` on `--paper` | ~6.7:1 | ~7.1:1 | ✅ AA |
| `--on-accent` on `--accent` | ~7.2:1 | ~7.5:1 | ✅ AAA |
| `--bad` on `--paper` | ~5.1:1 | ~4.9:1 | ✅ AA |

### 2.5 금지 팔레트

- 보라(`from-purple-*`) · 핑크(`to-pink-*`) 그라디언트 배경
- 디폴트 Tailwind slate 회색 그대로 사용 (브랜드 hue 틴팅 필수)
- 그라디언트 텍스트 (`background-clip: text` + `linear-gradient`)
- `red-500` 같은 Tailwind raw 팔레트 — 반드시 시맨틱 토큰 경유

## 3. Typography

### 3.1 폰트 패밀리

| 역할 | 스택 | CDN |
|---|---|---|
| Display (헤드라인) | `Manrope` → Pretendard → sans-serif | jsDelivr / Google Fonts |
| Body (본문, 한글 최적화) | `Pretendard` → Manrope → sans-serif | Pretendard (orioncactus) |
| Mono (코드, 숫자 표) | `ui-monospace, SFMono-Regular, Menlo` | OS 네이티브 |

- Manrope는 300·400·500·600·700·800을 Google Fonts로 preload.
- Pretendard는 CSS 변수 정의만 있고 본문은 Pretendard 우선.
- **절대 사용하지 않음**: Inter 디폴트, DM Sans, system-ui 단독, Arial.

### 3.2 Type Scale

| Token | 값 | 용도 |
|---|---|---|
| `--text-2xs` | 11px | micro tag, 배지 |
| `--text-xs` | 12px | label, 메타 |
| `--text-sm` | 14px | 보조 본문 |
| `--text-base` | 16px | 기본 본문 |
| `--text-md` | 18px | 카드 타이틀 / lead |
| `--text-lg` | 20px | 섹션 타이틀 |
| `--text-xl` | 24px | subheading |
| `--text-2xl` | 30px | 페이지 타이틀 |
| `--text-3xl` | 36px | hero 타이틀 |
| `--text-4xl` | 48px | editorial display |

### 3.3 Line-height · Tracking · Weight

| 카테고리 | 토큰 / 값 |
|---|---|
| Line-height | `--leading-tight: 1.2` · `--leading-snug: 1.35` · `--leading-normal: 1.5` · `--leading-relaxed: 1.65` · `--leading-loose: 1.8` |
| Tracking | `--tracking-tighter: -0.03em` · `--tracking-tight: -0.02em` · `--tracking-wide: 0.04em` · `--tracking-widest: 0.12em` |
| Weight | 400 / 500 / 600 / 700 / 800 / 900 (한 화면 **최대 2종**) |
| Body measure | `--measure-prose: 65ch` (뉴스레터 본문) · `--measure-wide: 75ch` |
| Numeric | 모든 숫자 표/카운터는 `font-variant-numeric: tabular-nums` |

### 3.4 디지털 조판 규칙

- 헤딩에 `text-wrap: balance` 적용.
- 본문 단락에 `text-wrap: pretty` (widow/orphan 방지).
- 한글 본문은 `word-break: keep-all` (한 단어 중간 줄바꿈 방지).
- 큰 따옴표는 curly quote (" ")로 치환.
- 말줄임은 `…` 문자 사용 (세 점 `...` 금지).

## 4. Spacing & Sizing

### 4.1 Spacing Scale (8pt 기본 · 4pt 미세)

| Token | px | 사용 |
|---|---|---|
| `--space-3xs` | 2 | 아이콘 ↔ 라벨 미세 |
| `--space-2xs` | 4 | 배지 내부 |
| `--space-xs` | 8 | 라인 갭 |
| `--space-sm` | 12 | 인라인 갭 |
| `--space-md` | 16 | 컴포넌트 내부 (기본) |
| `--space-lg` | 24 | 카드 간 gap |
| `--space-xl` | 32 | 섹션 padding |
| `--space-2xl` | 48 | 섹션 ↔ 섹션 |
| `--space-3xl` | 64 | 히어로 padding |
| `--space-4xl` | 96 | 페이지 하단 여백 |
| `--space-5xl` | 128 | 랜딩 히어로 |

**안티 패턴**: 13px · 17px · 25px · 27px 등 그리드 이탈. 반드시 `--space-*` 토큰 경유.

### 4.2 Container Width

| Token / 값 | 용도 |
|---|---|
| `max-width: 1920px` | `.main-content`, `.top-navbar__inner` — 울트라 와이드 캡 |
| `max-width: 1280px` | 일반 페이지 컨테이너 (차기 단계) |
| `--measure-prose` (65ch) | 본문 단락 최대 폭 |

## 5. Radius

| Token | px | 용도 |
|---|---|---|
| `--radius-none` | 0 | 풀블리드 이미지 |
| `--radius-2xs` | 4 | 아이콘 inline |
| `--radius-xs` | 6 | 태그 내부 요소 |
| `--radius-sm` | 8 | chip, badge 엣지 |
| `--radius-md` | 12 | 버튼, 입력, 소형 카드 |
| `--radius-lg` | 16 | **카드 기본** |
| `--radius-xl` | 24 | hero 카드, 모달 |
| `--radius-2xl` | 32 | 배너, 대형 컨테이너 |
| `--radius-full` | 9999 | avatar, pill, status dot |

## 6. Elevation / Shadows (Light / Dark)

| Token | Light | Dark | 용도 |
|---|---|---|---|
| `--elev-0` | none | none | 플랫 (border가 깊이를 담당) |
| `--elev-1` | 얇은 블루 그림자 | 어두운 그림자 (opacity 30%) | 툴팁, 피커 |
| `--elev-2` | 작은 블루 그림자 2겹 | 어두운 그림자 2겹 | **카드 기본** |
| `--elev-3` | 중간 블루 그림자 | 어두운 그림자 | Hero card, floating badge |
| `--elev-4` | 큰 블루 그림자 | 큰 어두운 그림자 | Popover, dropdown |
| `--elev-5` | 드라마틱 블루 그림자 | 드라마틱 어두운 그림자 | Modal, drawer |

- Light: **블루 틴팅 그림자** (`rgb(0 65 106 / ...)`) — 쿨한 무드 유지.
- Dark: **순수 검정 그림자** (`rgb(0 0 0 / ...)`) — 다크 배경 위에서 블루 틴트는 녹는다.
- 레거시 호환: `--shadow` = `--elev-4`, `--shadow-soft` = `--elev-3`.

## 7. Motion

### 7.1 Duration 표

| Token | ms | 사용 |
|---|---|---|
| `--duration-instant` | 80 | 토글 flip 완료 시 |
| `--duration-quick` | **160** | 프로젝트 기본 (hover, focus, color) |
| `--duration-standard` | 200 | 드롭다운 open |
| `--duration-emphatic` | 300 | 모달·드로어 진입 |
| `--duration-slow` | 400 | 시트 큰 이동 |
| `--duration-deliberate` | 600 | 온보딩·세리머니 |

### 7.2 Easing 표

| Token | Curve | 사용 |
|---|---|---|
| `--ease-out` | `cubic-bezier(0.16, 1, 0.3, 1)` | **기본 UI** (hover, fade) |
| `--ease-in-out` | `cubic-bezier(0.4, 0, 0.2, 1)` | 양방향 전환 |
| `--ease-drawer` | `cubic-bezier(0.32, 0.72, 0, 1)` | 모달·드로어 |
| `--ease-spring-soft` | `cubic-bezier(0.34, 1.56, 0.64, 1)` | 딜라이트 모멘트 (드물게) |
| `--ease-snap` | `cubic-bezier(0.65, 0, 0.35, 1)` | 토글, 체크박스 flip |

### 7.3 빈도 기반 모션 정책

| 빈도 | 정책 |
|---|---|
| 일 100회 이상 (토글, 커맨드팔레트) | **애니메이션 없음** |
| 일 수십 회 (호버, 내비) | `--duration-quick` + `--ease-out` |
| 가끔 (모달, 드로어, 토스트) | `--duration-emphatic` + `--ease-drawer` |
| 드물게 (온보딩) | `--duration-deliberate` + `--ease-spring-soft` |

### 7.4 절대 규칙

- `ease-in`을 UI 애니메이션에 **쓰지 않는다** — 시작이 느려 둔해 보임.
- `transition: all` **금지**. 항상 속성 지정.
- 애니메이트 가능한 속성: `transform`, `opacity`, `filter`, (정 필요할 때) `background-color`.
- 엔트리 시작을 `scale(0)`으로 두지 않음 — `scale(0.95) opacity: 0`부터.
- 300ms가 UI 모션 상한. 180ms가 400ms보다 반응적이다.
- `prefers-reduced-motion: reduce` 자동 대응 (모션 토큰이 0ms로 스왑됨).

## 8. Component Styles

> 기존 `globals.css`의 컴포넌트 스타일을 토큰 참조로 치환합니다. 아래는 Layer 3(Build)에서 지킬 규칙.

### 8.1 Button

| 변형 | 배경 | 텍스트 | 테두리 | 그림자 |
|---|---|---|---|---|
| Primary | `var(--accent)` | `var(--on-accent)` | none | `var(--elev-1)` |
| Secondary | `var(--surface-container-highest)` | `var(--on-surface)` | `1px solid var(--line-strong)` | none |
| Ghost | transparent | `var(--on-surface)` | none | none |
| Danger | `var(--bad)` | `var(--on-error)` | none | `var(--elev-1)` |

- Radius: `var(--radius-md)` 또는 pill (`var(--radius-full)`).
- 높이: sm=32px · md=40px · lg=48px.
- States (필수 7개): default / hover / focus-visible / active / disabled / loading / error.
- 피드백: `:active { transform: scale(0.97); transition: transform var(--duration-instant) var(--ease-out); }`.

### 8.2 Input / Select / Textarea

- 기본 테두리 `1px solid var(--outline-variant)`.
- Focus: `outline: var(--focus-ring-width) solid var(--focus-ring-color); outline-offset: var(--focus-ring-offset);` (focus-visible 경유).
- Error: 테두리 `var(--bad)` + 하단 `aria-describedby` 메시지.
- Placeholder는 **보조 정보**만. 라벨 필수.

### 8.3 Card (기본 패널)

- 배경 `var(--panel)` (글래스) 또는 `var(--surface-container)`.
- Radius `var(--radius-lg)`.
- Padding `var(--space-lg)` 또는 `var(--space-xl)`.
- 그림자 `var(--elev-2)`.
- Hover: 그림자 `var(--elev-3)` + 배경 tint (`var(--surface-container-low)`).

### 8.4 Brief Card (HERO — 차별화 포인트)

- 배경 `var(--panel-strong)`.
- Padding `var(--space-2xl)` (48px) — 여유롭게.
- Radius `var(--radius-xl)`.
- 제목: `font-family: var(--font-display)` · `--text-3xl` · `--weight-extrabold` · `--tracking-tight` · `--leading-tight` · `text-wrap: balance`.
- 본문: `--text-md` · `--leading-relaxed` · `max-width: var(--measure-prose)` · `text-wrap: pretty`.
- 구분선: `var(--line-strong)` + `var(--space-lg)` padding-top.
- **금지**: 배경에 그라디언트 텍스트, 히어로에 여러 CTA, 본문 너비 80ch 초과.

### 8.5 Signal Item (Severity-based)

| Severity | 배경 | 테두리 | 전경 | 도트 |
|---|---|---|---|---|
| good | `var(--signal-good-bg)` | `var(--signal-good-border)` | `var(--signal-good-fg)` | `var(--accent)` |
| warn | `var(--signal-warn-bg)` | `var(--signal-warn-border)` | `var(--signal-warn-fg)` | `var(--warn)` |
| bad | `var(--signal-bad-bg)` | `var(--signal-bad-border)` | `var(--signal-bad-fg)` | `var(--bad)` + `animation: pulse-dot 2s ease-in-out infinite` |
| neutral | `var(--signal-neutral-bg)` | `var(--signal-neutral-border)` | `var(--signal-neutral-fg)` | `var(--accent)` |

### 8.6 Status Pill

- Radius `var(--radius-full)` · padding `0.5rem 0.72rem` · `--text-xs` · `font-weight: 700`.
- 텍스트는 `uppercase` + `letter-spacing: var(--tracking-widest)`.

### 8.7 Timeline Item · Op Log · Checklist

- 기존 컴포넌트 규칙 유지. 하드코딩된 hex (`#1e293b`, `#2dd4bf`, `#cbd5e1`, `#334155`, `#64748b`)는 `--inverse-*` 토큰으로 치환.

### 8.8 Modal / Overlay

- Backdrop: `rgb(21 28 34 / 0.55)` (다크 라이트 공통, OKLCH 자리 확보).
- 진입 애니메이션: `opacity 0 → 1, transform: translateY(8px) → 0` + `--duration-emphatic` + `--ease-drawer`.
- 스크롤 잠금 시 `overflow: hidden; padding-right: var(--scrollbar-width)`로 레이아웃 shift 방지.
- ESC 닫기 + 포커스 트랩 + 초기 포커스 `autofocus` 버튼 또는 닫기 버튼.

## 9. Layout Rules

### 9.1 Grid

- 메인 `.main-content`는 **12열 CSS Grid**, `gap: var(--space-xl)`.
- `col-span-12 / 8 / 4` 헬퍼 유지.
- 모바일에서 모든 col-span을 **12로 스택** (< 1180px).

### 9.2 Rhythm

- 섹션 ↔ 섹션: `--space-2xl`.
- 컴포넌트 ↔ 컴포넌트: `--space-lg`.
- 라인 ↔ 라인 (단락 내): `--space-xs`.

### 9.3 Alignment

- 기본 left-align. 숫자만 right-align + `tabular-nums`.
- Heading은 optical alignment — 큰 제목 앞에 hanging punctuation 허용.
- 아이콘 + 텍스트: `display: inline-flex; align-items: center; gap: var(--space-xs);`.

### 9.4 F-pattern 활용 (Brief Card)

- `Daily Brief` 블록은 F-pattern 첫 가로줄에 **대형 제목**.
- 두 번째 가로줄에 **인용 박스**.
- 좌측 column을 따라 Signals / Insights 2-col.

## 10. Depth / Layering

| Token | z-index | 예시 |
|---|---|---|
| `--z-base` | 0 | 페이지 기본 |
| `--z-raised` | 10 | hover 카드 |
| `--z-sticky` | 20 | sticky sub-nav |
| `--z-navbar` | 50 | top navbar |
| `--z-dropdown` | 60 | 드롭다운 패널 |
| `--z-floating-badge` | 80 | floating-badge |
| `--z-modal-backdrop` | 100 | modal backdrop |
| `--z-modal` | 110 | modal 본체 |
| `--z-toast` | 200 | toast 알림 |
| `--z-tooltip` | 300 | 툴팁 |

## 11. Responsive

### 11.1 Breakpoint

| 이름 | min-width | 용도 |
|---|---|---|
| xs | 0 | 모바일 세로 |
| sm | 520px | 큰 폰 / 태블릿 세로 |
| md | 768px | 태블릿 가로 |
| lg | 1180px | 데스크탑 표준 |
| xl | 1440px | 데스크탑 와이드 |
| 2xl | 1920px | 울트라 와이드 상한 |

### 11.2 Mobile-first 규칙

- 기본 스타일이 xs. 큰 화면은 `@media (min-width: ...)`로 **증강**.
- 터치 타깃 **44 × 44pt** 이상.
- 주요 액션은 **썸존(하단 1/3)**에 배치.
- `env(safe-area-inset-*)`로 노치 대응.
- `100dvh` 사용 (iOS 주소바 대응 — `100vh` 지양).

## 12. Dark Mode

### 12.1 전환 전략

1. `:root`에 light 기본값, `[data-theme="dark"]`에 오버라이드.
2. `layout.tsx` 상단에 **theme-boot script** 주입:
   - `localStorage['whalescope.theme']` 우선.
   - 없으면 `matchMedia('(prefers-color-scheme: dark)')`.
   - `<html>`에 `data-theme` 세팅 — **hydration 이전에 실행**하여 FOUC 방지.
3. `@media (prefers-color-scheme: dark)`는 **JS 비활성 환경 fallback**.

### 12.2 Dark 전용 조정

- 순수 검정(#000) 대신 `oklch(0.16 0.015 240)` — OLED bloom 완화.
- 순수 흰색 대신 `oklch(0.94 0.006 240)` — halation 완화.
- Accent chroma 보강 (dark에서 색이 탁해 보이므로 +20% 채도).
- 그림자는 블루 틴트 대신 검정 (블루 틴트가 다크 배경에 녹음).

### 12.3 Dark 미구현 시 Phase 3

- 토글 UI 컴포넌트 (`components/theme-toggle.tsx`) — **Phase 3** 예정.
- 현재는 토큰 준비 완료 + 시스템 preference 자동 감지까지.

## 13. Accessibility

### 13.1 WCAG 2.1 AA 필수 항목

- [ ] 본문 텍스트 대비 **4.5:1** 이상.
- [ ] 큰 텍스트 (18px+ bold 또는 24px+) **3:1** 이상.
- [ ] UI 컴포넌트 (버튼·입력·아이콘) 인접 대비 **3:1** 이상.
- [ ] 모든 인터랙티브 요소에 `focus-visible` 링.
- [ ] 모든 폼 컨트롤에 `<label>` 또는 `aria-label`.
- [ ] 모든 이미지에 `alt` (장식은 `alt=""` + `aria-hidden`).
- [ ] 키보드만으로 전 기능 도달 가능.
- [ ] `prefers-reduced-motion: reduce` 대응.
- [ ] 색상만으로 상태 구분하지 않음 (아이콘·텍스트 병기).
- [ ] `aria-live="polite"`로 비동기 업데이트 안내.

### 13.2 스크린 리더

- `<button>` vs `<a>` 역할 준수.
- 아이콘 단독 버튼은 `aria-label`.
- Material Symbols 아이콘은 장식일 경우 `<span className="material-symbols-outlined" aria-hidden="true">`.

### 13.3 키보드 내비게이션

- Tab 순서 DOM 순서와 일치.
- Skip link `<a href="#main">메인으로 건너뛰기</a>` 최상단.
- 모달 내부 포커스 트랩.
- ESC 닫기.

## 14. Guardrails — 절대 하지 말 것

| 안티 패턴 | 대안 |
|---|---|
| `border-left: 4px solid <color>` (side-stripe) | `background-color: var(--signal-*-bg)` + `border: 1px solid var(--signal-*-border)` |
| `background-clip: text` + gradient (그라디언트 텍스트) | `color: var(--accent)` 단색 |
| `from-purple-500 to-pink-500` 배경 | `--paper` + `--surface-container-*` |
| `transition: all` | 속성 지정 (`transition: background-color var(--duration-quick) var(--ease-out)`) |
| `outline: none` without fallback | `:focus-visible { outline: var(--focus-ring-*); }` |
| `<div onClick>` | `<button>` 또는 `<a>` |
| 8pt 이탈 스페이싱 (13/17/25) | `--space-*` 토큰 경유 |
| 이모지를 UI 아이콘으로 | Material Symbols Outlined 또는 Lucide React |
| `ease-in` UI 애니메이션 | `--ease-out` / `--ease-in-out` |
| 한 화면 5종+ 폰트 사이즈 | 최대 4종으로 제약 |
| `transition: all 300ms` 글로벌 | 토큰 `--transition-*` 사용 |
| 다크 모드 토글 없이 `color-scheme: light` 하드코딩 | `color-scheme: light dark` + `[data-theme="dark"]` 오버라이드 |

## 15. Agent / Claude Prompts

### 15.1 새 컴포넌트 만들 때

```
우리 프로젝트는 WhaleScope Dashboard 입니다.
톤: Editorial-calm · Light Blue · Glassmorphism (다크 모드 포함)
차별화: Daily Brief 히어로 — 에디토리얼 타이포 + 넓은 여백

다음 규칙을 지켜 컴포넌트 `[이름]`을 작성해줘:
1. Layer 2 토큰(`apps/dashboard/app/design-tokens.css`)만 사용. 하드코딩 hex/px 금지.
2. Radius `--radius-lg`, padding `--space-lg`, 그림자 `--elev-2` 기본.
3. 7-state (default/hover/focus-visible/active/disabled/loading/error) 모두 구현.
4. WCAG AA 대비 통과.
5. 다크 모드 자동 스왑 (토큰만 쓰면 자동 적용됨).
6. `prefers-reduced-motion` 대응.

작업 후 Before/After/Why 테이블로 보고.
```

### 15.2 디자인 리뷰 요청

```
`[컴포넌트 경로]`를 `DESIGN.md` 기준으로 리뷰해줘.
출력 포맷:
1. What works (강점 2-3개)
2. Slop signals found (Absolute Bans 위반, 라인 번호 포함)
3. Missing states (7-state 중 빠진 것)
4. Before / After / Why 테이블
```

### 15.3 Polish 요청

```
`[페이지 경로]`의 Polish 체크리스트 (7-state · pixel-align · widows/orphans · WCAG · Vercel WIG)를 적용해줘.
변경 최소화. 새 컴포넌트 추가 금지. 기존 토큰 재활용.
```

### 15.4 토큰 추가 요청

```
DESIGN.md §[n] 에 `[토큰명]`을 추가해줘.
- 역할:
- Light 값 (OKLCH):
- Dark 값 (OKLCH):
- 사용 예시:
- 기존 토큰과의 관계:

동일 변경을 `design-tokens.css`에도 반영하고 변경 내역을 §16에 기록.
```

## 16. Revision History

| 날짜 | 버전 | 변경 | 근거 |
|---|---|---|---|
| 2026-04-17 | v0.1.0 | 초기 작성. OKLCH 팔레트 + Light/Dark 토큰 + 8pt 스페이싱 + 모션 토큰 + 5단 엘리베이션 + 16섹션 포맷. | `design-engineering` 스킬 Layer 1~2. 기존 `globals.css`의 Material 3 기반 토큰을 OKLCH로 업그레이드. |

---

## Appendix A — 기존 globals.css → 토큰 매핑 표

| 기존 값 | 신규 토큰 | 비고 |
|---|---|---|
| `#151c22` | `var(--ink)` = `oklch(0.18 0.012 240)` | ink 본문 |
| `#546777` | `var(--muted)` | |
| `#404751` | `var(--muted-strong)` / `var(--on-surface-variant)` | |
| `#f6faff` | `var(--paper)` / `var(--surface)` | |
| `#edf4fc` | `var(--paper-alt)` / `var(--surface-container-low)` | |
| `#fbfdff` | `var(--panel-strong)` | |
| `rgba(192,199,210,0.35)` | `var(--line)` | 그대로 rgb() |
| `rgba(192,199,210,0.5)` | `var(--line-strong)` | |
| `#005e97` | `var(--accent)` / `var(--accent-dark)` | primary-600 |
| `rgba(0,94,151,0.08)` | `var(--accent-soft)` | |
| `#0077be` | `var(--accent-container)` | primary-500 |
| `#00691e` | `var(--good)` / `var(--tertiary)` | |
| `rgba(0,105,30,0.08)` | `var(--good-soft)` | |
| `#a56a12` | `var(--warn)` | |
| `rgba(165,106,18,0.1)` | `var(--warn-soft)` | |
| `#ba1a1a` | `var(--bad)` / `var(--error)` | |
| `rgba(186,26,26,0.08)` | `var(--bad-soft)` | |
| `#e8eff7` | `var(--surface-container)` | |
| `#e2e9f1` | `var(--surface-container-high)` | |
| `#dce3eb` | `var(--surface-container-highest)` | |
| `#c0c7d2` | `var(--outline-variant)` | |
| `#455f87` | `var(--secondary)` | |
| `#b5d0fd` | `var(--secondary-container)` | |
| `#18842e` | `var(--tertiary-container)` | |
| `0 20px 40px rgba(0,65,106,0.06)` | `var(--elev-4)` / `var(--shadow)` | |
| `0 10px 24px rgba(0,65,106,0.04)` | `var(--elev-3)` / `var(--shadow-soft)` | |
| `#1e293b` (dark card bg) | `var(--inverse-surface)` | 다크 카드 유지 |
| `#2dd4bf` (teal check) | `var(--inverse-accent)` | 다크 카드 내부 강조 |
| `#cbd5e1` | `var(--inverse-on-surface)` | |
| `#334155` | `var(--inverse-outline)` | |
| `#64748b` | `var(--inverse-on-surface-muted)` | |

## Appendix B — Phase 2 컴포넌트 리팩터 백로그

- [ ] `.top-navbar__avatar` — 배경 `var(--accent-container)` 유지 + 다크 모드 테스트.
- [ ] `.service-card__icon--good/warn/bad/neutral` — `--good-soft`, `--warn-soft`, `--bad-soft`, `--accent-softer`로 교체.
- [ ] `.signal-item--*` — `--signal-*-bg`/`--signal-*-border`로 통일.
- [ ] `.brief-card__article-title` — `text-wrap: balance` 추가.
- [ ] `.brief-card__body-text` — `max-width: var(--measure-prose)` · `text-wrap: pretty` 추가.
- [ ] `.checklist-dark-card` + children — `--inverse-*` 토큰으로 치환.
- [ ] `.top-navbar` — 다크 모드 배경 `var(--panel)` 자동 반영 확인.
- [ ] 모든 `transition:` 규칙 — `var(--transition-*)` 프리셋 또는 `<property> var(--duration-quick) var(--ease-out)` 포맷으로.
- [ ] `.main-content` / 카드 padding — `--space-*` 토큰 경유.
- [ ] Material Symbols 폰트 → Lucide React 이전 검토 (Phase 4).

## Appendix C — 검증 매트릭스

| 항목 | Light | Dark | 통과 기준 |
|---|---|---|---|
| 본문 대비 | `--ink`/`--paper` ≥ 15:1 | `--ink`/`--paper` ≥ 14:1 | AA 4.5:1 |
| 링크 대비 | `--accent`/`--paper` ≥ 6.7:1 | `--accent`/`--paper` ≥ 7.1:1 | AA 4.5:1 |
| 버튼 보더 대비 | `--outline-variant`/`--paper` ≥ 3:1 | `--outline-variant`/`--paper` ≥ 3:1 | AA (UI) |
| Motion 토큰 존재 | 5 duration + 6 easing | 동일 | ✅ |
| Elevation 5단 | 5 토큰 | 5 토큰 | ✅ |
| Reduced motion | 모든 duration 0ms | 동일 | ✅ |
