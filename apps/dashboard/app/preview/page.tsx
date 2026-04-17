import type { Metadata } from "next";
import { ThemeToggle } from "@/components/theme-toggle";
import styles from "./preview.module.css";

export const metadata: Metadata = {
  title: "WhaleScope — Design Preview",
  description:
    "Design tokens + menu-mapped component patterns for visual verification across light/dark themes.",
};

/* -----------------------------------------------------------------------------
 * Preview data — static, for visual verification only. No network calls.
 * ---------------------------------------------------------------------------*/

const ANCHORS = [
  { id: "foundations", label: "파운데이션" },
  { id: "colors", label: "컬러" },
  { id: "typography", label: "타이포" },
  { id: "spacing", label: "스페이싱" },
  { id: "radius", label: "라운드" },
  { id: "elevation", label: "엘리베이션" },
  { id: "motion", label: "모션" },
  { id: "navigation", label: "내비게이션" },
  { id: "brief", label: "데일리 브리프" },
  { id: "signals", label: "시그널" },
  { id: "services", label: "서비스 헬스" },
  { id: "checklist", label: "오퍼레이터" },
  { id: "timeline", label: "타임라인" },
  { id: "mood", label: "무드" },
  { id: "explain", label: "AI 설명" },
  { id: "components", label: "컴포넌트" },
];

const COLOR_PAPER: Array<{ name: string; token: string; role: string }> = [
  { name: "--paper", token: "var(--paper)", role: "페이지 바탕 · 60%" },
  { name: "--paper-alt", token: "var(--paper-alt)", role: "서브 바탕" },
  { name: "--surface-container-low", token: "var(--surface-container-low)", role: "낮은 컨테이너" },
  { name: "--surface-container", token: "var(--surface-container)", role: "기본 컨테이너" },
  { name: "--surface-container-high", token: "var(--surface-container-high)", role: "강조 컨테이너" },
];

const COLOR_SEMANTIC: Array<{ name: string; token: string; role: string }> = [
  { name: "--accent", token: "var(--accent)", role: "브랜드 · CTA · 링크 · 10%" },
  { name: "--accent-dark", token: "var(--accent-dark)", role: "hover / pressed" },
  { name: "--accent-soft", token: "var(--accent-soft)", role: "배지 / hover 배경" },
  { name: "--ink", token: "var(--ink)", role: "본문 잉크 · 30%" },
  { name: "--muted", token: "var(--muted)", role: "보조 텍스트" },
  { name: "--outline-variant", token: "var(--outline-variant)", role: "구분선" },
];

const COLOR_SIGNAL: Array<{ name: string; token: string; role: string }> = [
  { name: "--good", token: "var(--good)", role: "긍정 · 완료" },
  { name: "--warn", token: "var(--warn)", role: "주의 · 지연" },
  { name: "--bad", token: "var(--bad)", role: "실패 · 경고" },
  { name: "--signal-neutral-fg", token: "var(--signal-neutral-fg)", role: "중립 · 정보" },
];

const COLOR_INVERSE: Array<{ name: string; token: string; role: string }> = [
  { name: "--inverse-surface", token: "var(--inverse-surface)", role: "다크 카드 바탕" },
  { name: "--inverse-on-surface", token: "var(--inverse-on-surface)", role: "다크 카드 텍스트" },
  { name: "--inverse-outline", token: "var(--inverse-outline)", role: "다크 카드 구분선" },
  { name: "--inverse-accent", token: "var(--inverse-accent)", role: "다크 카드 강조 (teal)" },
];

const SPACING_SCALE = [
  { name: "3xs", value: "2px" },
  { name: "2xs", value: "4px" },
  { name: "xs", value: "8px" },
  { name: "sm", value: "12px" },
  { name: "md", value: "16px" },
  { name: "lg", value: "24px" },
  { name: "xl", value: "32px" },
  { name: "2xl", value: "48px" },
  { name: "3xl", value: "64px" },
  { name: "4xl", value: "96px" },
];

const RADIUS_SCALE: Array<{ name: string; token: string }> = [
  { name: "sm", token: "var(--radius-sm)" },
  { name: "md", token: "var(--radius-md)" },
  { name: "lg", token: "var(--radius-lg)" },
  { name: "xl", token: "var(--radius-xl)" },
  { name: "2xl", token: "var(--radius-2xl)" },
  { name: "full", token: "var(--radius-full)" },
];

const ELEV_SCALE: Array<{ name: string; shadow: string; role: string }> = [
  { name: "elev-1", shadow: "var(--elev-1)", role: "칩 · 툴팁" },
  { name: "elev-2", shadow: "var(--elev-2)", role: "카드 (기본)" },
  { name: "elev-3", shadow: "var(--elev-3)", role: "hero · 플로팅 배지" },
  { name: "elev-4", shadow: "var(--elev-4)", role: "popover · dropdown" },
  { name: "elev-5", shadow: "var(--elev-5)", role: "modal · drawer" },
];

const MOTION_PRESETS: Array<{
  speed: "instant" | "quick" | "standard" | "emphatic" | "spring";
  duration: string;
  ease: string;
  usage: string;
}> = [
  { speed: "instant", duration: "80ms", ease: "ease-out", usage: "토글 · 체크박스 · 상태 반전" },
  { speed: "quick", duration: "160ms", ease: "ease-out", usage: "hover · focus · 입력 반응" },
  { speed: "standard", duration: "200ms", ease: "ease-out", usage: "탭 전환 · 사이드바 · 드롭다운" },
  { speed: "emphatic", duration: "300ms", ease: "ease-drawer", usage: "모달 · 시트 · 드로어" },
  { speed: "spring", duration: "400ms", ease: "ease-spring-soft", usage: "온보딩 · 성공 세리머니" },
];

type SignalTone = "good" | "warn" | "bad" | "neutral";
const SIGNAL_CARDS: Array<{
  tone: SignalTone;
  severity: string;
  time: string;
  title: string;
  desc: string;
}> = [
  {
    tone: "good",
    severity: "긍정",
    time: "2분 전",
    title: "BTC 대규모 순유입 확인",
    desc: "거래소 바깥으로 1,240 BTC 이동. 누적 48시간 +2.3K BTC.",
  },
  {
    tone: "warn",
    severity: "주의",
    time: "14분 전",
    title: "ETH 파생 포지션 불균형",
    desc: "롱/숏 비중 1.8 초과 — 레버리지 청산 리스크 감시.",
  },
  {
    tone: "bad",
    severity: "경고",
    time: "27분 전",
    title: "Stablecoin 대량 발행 감지",
    desc: "USDT 350M 신규 발행 — 유동성 이벤트 대비 체크리스트 실행.",
  },
  {
    tone: "neutral",
    severity: "정보",
    time: "1시간 전",
    title: "일일 온체인 스캔 완료",
    desc: "30개 체인 · 186K 트랜잭션 처리 · 이상치 0건.",
  },
];

type ServiceTone = "good" | "warn" | "bad" | "neutral";
const SERVICES: Array<{
  tone: ServiceTone;
  icon: string;
  name: string;
  desc: string;
  badge: string;
}> = [
  { tone: "good", icon: "sync", name: "Google Sheets", desc: "데이터 동기화", badge: "정상" },
  { tone: "good", icon: "rss_feed", name: "Feed Ingest", desc: "RSS · 체인 이벤트", badge: "정상" },
  { tone: "warn", icon: "memory", name: "Model Runner", desc: "Claude Sonnet 4.6", badge: "지연" },
  { tone: "neutral", icon: "send", name: "Telegram Relay", desc: "알림 푸시", badge: "대기" },
];

const CHECKLIST: Array<{ checked: boolean; label: string; status: string }> = [
  { checked: true, label: "피드 수집 상태 점검", status: "완료" },
  { checked: true, label: "시그널 스코어링 재계산", status: "완료" },
  { checked: false, label: "리포트 발송 전 맞춤법 검수", status: "대기" },
  { checked: false, label: "텔레그램 채널 오류 로그 확인", status: "대기" },
];

const TIMELINE: Array<{
  dir: "in" | "out";
  icon: string;
  headline: string;
  meta: string;
  badge: string;
}> = [
  {
    dir: "in",
    icon: "arrow_downward",
    headline: "1,240 BTC 콜드월렛 유입",
    meta: "0x7fa…9c3 → Coinbase Custody · 09:42",
    badge: "IN",
  },
  {
    dir: "out",
    icon: "arrow_upward",
    headline: "350M USDT 신규 발행",
    meta: "Tether Treasury · 09:28",
    badge: "OUT",
  },
  {
    dir: "in",
    icon: "hub",
    headline: "ETH 스테이킹 추가 4.2K ETH",
    meta: "Lido · Validator 0x44b · 08:55",
    badge: "IN",
  },
];

/* -----------------------------------------------------------------------------
 * Page
 * ---------------------------------------------------------------------------*/

export default function PreviewPage() {
  return (
    <main className={styles.page}>
      {/* §0. Sticky anchor bar ----------------------------------------------*/}
      <header className={styles.topBar}>
        <div className={styles.topBarInner}>
          <div className={styles.brand}>
            <span className={styles.brandTitle}>WhaleScope / Preview</span>
            <span className={styles.brandSubtitle}>Design system · v0.1</span>
          </div>
          <nav className={styles.anchorNav} aria-label="섹션 내비게이션">
            {ANCHORS.map((a) => (
              <a key={a.id} href={`#${a.id}`} className={styles.anchorLink}>
                {a.label}
              </a>
            ))}
          </nav>
          <div className={styles.topBarRight}>
            <ThemeToggle className={styles.themeBtn} />
          </div>
        </div>
      </header>

      {/* §1. Hero ----------------------------------------------------------*/}
      <section className={styles.hero} id="foundations">
        <span className={styles.heroEyebrow}>Design System · Layer 2 · Verification Surface</span>
        <h1 className={styles.heroTitle}>
          토큰과 패턴을 한 화면에서 검증합니다.
        </h1>
        <p className={styles.heroLead}>
          이 페이지는 WhaleScope 디자인 시스템의 단일 검증 표면입니다. 컬러·타이포·스페이싱·모션·엘리베이션
          같은 파운데이션부터, 실제 메뉴(대시보드·인사이트·시그널·리포트)에서 쓰이는 컴포넌트 패턴까지 같은
          스크롤 안에 놓여 있습니다. 우측 상단 버튼으로 라이트/다크 모드를 전환해 두 테마의 정합성을 함께
          확인하세요.
        </p>
        <div className={styles.heroMeta}>
          <span className={styles.metaChip}>
            <strong>17</strong> 섹션
          </span>
          <span className={styles.metaChip}>
            <strong>2</strong> 테마
          </span>
          <span className={styles.metaChip}>
            <strong>OKLCH</strong> 컬러 스페이스
          </span>
          <span className={styles.metaChip}>
            <strong>8pt</strong> 스페이싱 그리드
          </span>
        </div>
      </section>

      {/* §2. Colors --------------------------------------------------------*/}
      <section className={styles.section} id="colors">
        <header className={styles.sectionHeader}>
          <span className={styles.sectionKicker}>§2 · Color</span>
          <h2 className={styles.sectionTitle}>컬러 팔레트</h2>
          <p className={styles.sectionNote}>
            OKLCH 기반 · 60 Paper / 30 Ink / 10 Accent 분배. 라이트에서는 페이퍼가 60%를 차지하고, 다크에서는
            near-black blue-tinted 바탕이 같은 역할을 합니다.
          </p>
        </header>

        <div className={styles.swatchGroup}>
          <h3 className={styles.swatchGroupTitle}>Paper / Surface (60%)</h3>
          <div className={styles.grid3}>
            {COLOR_PAPER.map((c) => (
              <article key={c.name} className={styles.swatch}>
                <div className={styles.swatchChip} style={{ background: c.token }} aria-hidden="true" />
                <div className={styles.swatchMeta}>
                  <span className={styles.swatchName}>{c.name}</span>
                  <span className={styles.swatchDesc}>{c.token}</span>
                  <span className={styles.swatchRole}>{c.role}</span>
                </div>
              </article>
            ))}
          </div>
        </div>

        <div className={styles.swatchGroup}>
          <h3 className={styles.swatchGroupTitle}>Semantic · Accent · Ink (30 / 10%)</h3>
          <div className={styles.grid3}>
            {COLOR_SEMANTIC.map((c) => (
              <article key={c.name} className={styles.swatch}>
                <div className={styles.swatchChip} style={{ background: c.token }} aria-hidden="true" />
                <div className={styles.swatchMeta}>
                  <span className={styles.swatchName}>{c.name}</span>
                  <span className={styles.swatchDesc}>{c.token}</span>
                  <span className={styles.swatchRole}>{c.role}</span>
                </div>
              </article>
            ))}
          </div>
        </div>

        <div className={styles.swatchGroup}>
          <h3 className={styles.swatchGroupTitle}>Signal severity</h3>
          <div className={styles.grid4}>
            {COLOR_SIGNAL.map((c) => (
              <article key={c.name} className={styles.swatch}>
                <div className={styles.swatchChip} style={{ background: c.token }} aria-hidden="true" />
                <div className={styles.swatchMeta}>
                  <span className={styles.swatchName}>{c.name}</span>
                  <span className={styles.swatchDesc}>{c.token}</span>
                  <span className={styles.swatchRole}>{c.role}</span>
                </div>
              </article>
            ))}
          </div>
        </div>

        <div className={styles.swatchGroup}>
          <h3 className={styles.swatchGroupTitle}>Inverse — 의도된 다크 영역</h3>
          <div className={styles.grid4}>
            {COLOR_INVERSE.map((c) => (
              <article key={c.name} className={styles.swatch}>
                <div className={styles.swatchChip} style={{ background: c.token }} aria-hidden="true" />
                <div className={styles.swatchMeta}>
                  <span className={styles.swatchName}>{c.name}</span>
                  <span className={styles.swatchDesc}>{c.token}</span>
                  <span className={styles.swatchRole}>{c.role}</span>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* §3. Typography ----------------------------------------------------*/}
      <section className={styles.section} id="typography">
        <header className={styles.sectionHeader}>
          <span className={styles.sectionKicker}>§3 · Typography</span>
          <h2 className={styles.sectionTitle}>타이포그래피 스케일</h2>
          <p className={styles.sectionNote}>
            디스플레이는 Manrope, 본문은 Pretendard. 10단계 스케일(2xs → 4xl) · 바디 anchor 16px · 최대 행 폭
            65ch(prose).
          </p>
        </header>

        <div className={styles.card}>
          <div className={styles.typeStack}>
            <div className={styles.typeRow}>
              <div className={styles.typeLabel}>
                <strong>Display / 4xl</strong>
                <span>48px · Manrope · weight 700</span>
              </div>
              <p className={styles.typeSampleDisplay}>고래는 숨지 못한다.</p>
            </div>
            <div className={styles.typeRow}>
              <div className={styles.typeLabel}>
                <strong>Body / base</strong>
                <span>16px · Pretendard · weight 400 · leading 1.65</span>
              </div>
              <p className={styles.typeSampleBody}>
                시그널 하나에도 맥락이 있다. 어떤 지갑이, 어떤 시각에, 어떤 금액을 움직였는지 —
                WhaleScope는 그 맥락을 잃지 않도록 설계되었다.
              </p>
            </div>
            <div className={styles.typeRow}>
              <div className={styles.typeLabel}>
                <strong>Mono / sm</strong>
                <span>14px · ui-monospace · tabular-nums</span>
              </div>
              <p className={styles.typeSampleMono}>0x7fa9b21f…c39d · 1,240.00 BTC · 09:42:18 UTC</p>
            </div>
          </div>

          <p className={styles.proseDemo}>
            본문 최대 폭은 <strong>65ch(--measure-prose)</strong>로 제한됩니다. 에디토리얼 신문 칼럼처럼
            눈의 움직임을 좁혀 읽기 피로를 줄이고, <strong>text-wrap: pretty</strong>로 마지막 줄의 고아
            단어를 완화합니다. 헤드라인은 <strong>text-wrap: balance</strong>로 균형을 잡습니다.
          </p>
        </div>
      </section>

      {/* §4. Spacing -------------------------------------------------------*/}
      <section className={styles.section} id="spacing">
        <header className={styles.sectionHeader}>
          <span className={styles.sectionKicker}>§4 · Spacing</span>
          <h2 className={styles.sectionTitle}>8pt 스페이싱 그리드</h2>
          <p className={styles.sectionNote}>
            4pt 베이스 · 8pt 선호. 임의 값(13/17/25px)은 금지. 컴포넌트 간격은 <code>gap</code>을 우선합니다.
          </p>
        </header>

        <div className={styles.card}>
          <div className={styles.spacingList}>
            {SPACING_SCALE.map((s) => (
              <div key={s.name} className={styles.spacingRow}>
                <span className={styles.spacingName}>--space-{s.name}</span>
                <span className={styles.spacingBar} style={{ width: s.value }} aria-hidden="true" />
                <span className={styles.spacingValue}>{s.value}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* §5. Radius --------------------------------------------------------*/}
      <section className={styles.section} id="radius">
        <header className={styles.sectionHeader}>
          <span className={styles.sectionKicker}>§5 · Radius</span>
          <h2 className={styles.sectionTitle}>라운드 스케일</h2>
          <p className={styles.sectionNote}>
            칩은 sm, 버튼은 md, 카드는 lg~xl, 배너는 2xl, 아바타/상태 점은 full.
          </p>
        </header>

        <div className={styles.card}>
          <div className={styles.radiusStack}>
            {RADIUS_SCALE.map((r) => (
              <div key={r.name} className={styles.radiusCell}>
                <div
                  className={styles.radiusBox}
                  style={{ borderRadius: r.token }}
                  aria-hidden="true"
                />
                <span>--radius-{r.name}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* §6. Elevation -----------------------------------------------------*/}
      <section className={styles.section} id="elevation">
        <header className={styles.sectionHeader}>
          <span className={styles.sectionKicker}>§6 · Elevation</span>
          <h2 className={styles.sectionTitle}>엘리베이션 — 블루 틴티드 섀도</h2>
          <p className={styles.sectionNote}>
            순검정 대신 <code>rgb(0 65 106 / α)</code> 섀도를 사용해 라이트 테마의 편안한 깊이를 만듭니다.
            다크 테마에서는 섀도 대신 표면 밝기 단계로 깊이를 표현합니다.
          </p>
        </header>

        <div className={styles.card}>
          <div className={styles.elevStack}>
            {ELEV_SCALE.map((e) => (
              <div key={e.name} className={styles.elevCell} style={{ boxShadow: e.shadow }}>
                <strong>{e.name}</strong>
                <span>{e.role}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* §7. Motion --------------------------------------------------------*/}
      <section className={styles.section} id="motion">
        <header className={styles.sectionHeader}>
          <span className={styles.sectionKicker}>§7 · Motion</span>
          <h2 className={styles.sectionTitle}>모션 프리셋</h2>
          <p className={styles.sectionNote}>
            버튼 위에 커서를 올려 듀레이션과 이징을 비교하세요. UI에는 <code>ease-in</code>을 쓰지 않습니다
            (시작이 느려 둔해 보임). <code>ease-out</code>이 기본이며, 드로어/모달만 <code>ease-drawer</code>,
            드문 세리머니만 <code>ease-spring-soft</code>.
          </p>
        </header>

        <div className={styles.card}>
          <div className={styles.motionRow}>
            {MOTION_PRESETS.map((m) => (
              <button
                key={m.speed}
                type="button"
                className={styles.motionBtn}
                data-speed={m.speed}
                aria-label={`${m.speed} · ${m.duration} · ${m.ease}`}
              >
                <strong>{m.speed}</strong>
                <span>
                  {m.duration} · {m.ease}
                </span>
                <small>{m.usage}</small>
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* §8. Navigation patterns -------------------------------------------*/}
      <section className={styles.section} id="navigation">
        <header className={styles.sectionHeader}>
          <span className={styles.sectionKicker}>§8 · Navigation</span>
          <h2 className={styles.sectionTitle}>내비게이션 패턴</h2>
          <p className={styles.sectionNote}>
            대시보드(오퍼레이터)는 상단 탭 네비를, 인사이트(최종 사용자)는 사이드바를 사용합니다. 두 패턴 모두
            같은 토큰 위에서 동작합니다.
          </p>
        </header>

        <div className={styles.grid2}>
          <div>
            <h3 className={styles.swatchGroupTitle}>Operator top-navbar</h3>
            <div className={styles.navSample} aria-hidden="true">
              <div className={styles.navSampleBrand}>
                <span className="material-symbols-outlined">analytics</span>
                WhaleScope
              </div>
              <nav className={styles.navSampleLinks}>
                <a href="#navigation" data-active="true">대시보드</a>
                <a href="#navigation">인사이트</a>
                <a href="#navigation">시그널</a>
                <a href="#navigation">리포트</a>
              </nav>
              <div className={styles.navSampleAvatar}>K</div>
            </div>
          </div>

          <div>
            <h3 className={styles.swatchGroupTitle}>Insights sidebar</h3>
            <aside className={styles.sidebarSample} aria-hidden="true">
              <div className={styles.sidebarSampleHeader}>
                WhaleScope
                <span className={styles.sidebarSampleSubtitle}>Insights</span>
              </div>
              <a href="#navigation" className={styles.sidebarLink} data-active="true">
                <span className="material-symbols-outlined">dashboard</span>
                대시보드
              </a>
              <a href="#navigation" className={styles.sidebarLink}>
                <span className="material-symbols-outlined">insights</span>
                분석
              </a>
              <a href="#navigation" className={styles.sidebarLink}>
                <span className="material-symbols-outlined">visibility</span>
                고래 감시
              </a>
              <a href="#navigation" className={styles.sidebarLink}>
                <span className="material-symbols-outlined">notifications</span>
                시그널 허브
              </a>
              <a href="#navigation" className={styles.sidebarLink}>
                <span className="material-symbols-outlined">settings</span>
                설정
              </a>
            </aside>
          </div>
        </div>
      </section>

      {/* §9. Daily Brief (differentiator) ----------------------------------*/}
      <section className={styles.section} id="brief">
        <header className={styles.sectionHeader}>
          <span className={styles.sectionKicker}>§9 · Differentiator</span>
          <h2 className={styles.sectionTitle}>Daily Brief — 오늘 시장에 벌어진 일</h2>
          <p className={styles.sectionNote}>
            WhaleScope의 기억에 남는 요소. 에디토리얼 문체 + 구조적 요약 + 시그널/인사이트 투 컬럼을 고정 레이아웃으로
            가져갑니다.
          </p>
        </header>

        <article className={styles.briefCard}>
          <div className={styles.briefHeader}>
            <span className={styles.briefEyebrow}>2026년 4월 17일 · 금요일 · AI 요약</span>
            <span className={styles.briefTime}>
              <span className="material-symbols-outlined" aria-hidden="true">
                schedule
              </span>
              09:00 KST 갱신
            </span>
          </div>
          <h3 className={styles.briefArticleTitle}>
            유동성은 조용했지만, 몇몇 지갑은 분주했다.
          </h3>
          <p className={styles.briefBody}>
            어제 밤부터 오늘 아침까지 이어진 장에서 <strong>거래소 바깥으로 누적 2,300 BTC</strong>가 움직였다.
            대부분은 장기 보유 성향의 콜드월렛 유입이었고, 단기 청산 신호는 관측되지 않았다. 반면{" "}
            <strong>ETH 파생 시장에서는 롱/숏 비중이 1.8을 넘어섰다</strong>. 이 수치가 3거래일 이상 유지된 과거
            14회 사례 중 12회에서 의미 있는 변동성이 뒤따랐다.
          </p>
          <div className={styles.briefCols}>
            <div className={styles.briefCol} data-tone="signals">
              <span className={styles.briefColTitle}>
                <span className="material-symbols-outlined" aria-hidden="true">
                  notifications_active
                </span>
                핵심 시그널 3
              </span>
              <ul className={styles.briefColList}>
                <li>BTC 콜드월렛 유입 1,240 — 경계 완화</li>
                <li>ETH 롱/숏 비중 1.82 — 주의 임계치 근접</li>
                <li>USDT 신규 발행 350M — 유동성 이벤트 감시</li>
              </ul>
            </div>
            <div className={styles.briefCol} data-tone="insights">
              <span className={styles.briefColTitle}>
                <span className="material-symbols-outlined" aria-hidden="true">
                  lightbulb
                </span>
                읽어야 할 인사이트 2
              </span>
              <ul className={styles.briefColList}>
                <li>고래 지갑 N+1 패턴 — 분할 매집의 재개</li>
                <li>스테이블 이벤트와 단기 변동성의 과거 상관</li>
              </ul>
            </div>
          </div>
          <p className={styles.briefDisclaimer}>
            본 브리프는 투자 자문이 아닙니다 · WhaleScope는 관측된 데이터만 보고합니다.
          </p>
        </article>
      </section>

      {/* §10. Signal cards --------------------------------------------------*/}
      <section className={styles.section} id="signals">
        <header className={styles.sectionHeader}>
          <span className={styles.sectionKicker}>§10 · Signals</span>
          <h2 className={styles.sectionTitle}>시그널 카드 — 4단계 톤</h2>
          <p className={styles.sectionNote}>
            심각도에 따라 <code>good / warn / bad / neutral</code> 톤을 가집니다. <strong>bad</strong> 카드의
            점(dot)은 <code>pulseDot</code> 애니메이션으로 주의를 유도합니다. 카드 왼쪽의 컬러 스트라이프 대신
            배경/도트/테두리 조합으로 구분합니다. (사이드 스트라이프는 AI-slop 표식입니다.)
          </p>
        </header>

        <div className={styles.signalGrid}>
          {SIGNAL_CARDS.map((s) => (
            <article key={s.title} className={styles.signalCard} data-tone={s.tone}>
              <div className={styles.signalCardTop}>
                <div className={styles.signalDotRow}>
                  <span className={styles.signalDot} aria-hidden="true" />
                  <span className={styles.signalSeverity}>{s.severity}</span>
                </div>
                <time className={styles.signalTime}>{s.time}</time>
              </div>
              <h3 className={styles.signalTitle}>{s.title}</h3>
              <p className={styles.signalDesc}>{s.desc}</p>
            </article>
          ))}
        </div>
      </section>

      {/* §11. Service health ------------------------------------------------*/}
      <section className={styles.section} id="services">
        <header className={styles.sectionHeader}>
          <span className={styles.sectionKicker}>§11 · Service Health</span>
          <h2 className={styles.sectionTitle}>서비스 상태 — 오퍼레이터 뷰</h2>
          <p className={styles.sectionNote}>
            데이터 파이프라인 4개 컴포넌트의 상태를 고정 배치. 아이콘·배지·설명으로 같은 톤을 반복해 시각적
            중복을 통한 즉시 인식을 유도합니다.
          </p>
        </header>

        <div className={styles.serviceGrid}>
          {SERVICES.map((s) => (
            <article key={s.name} className={styles.serviceCard}>
              <div className={styles.serviceCardHead}>
                <div className={styles.serviceIcon} data-tone={s.tone} aria-hidden="true">
                  <span className="material-symbols-outlined">{s.icon}</span>
                </div>
                <span className={styles.serviceBadge} data-tone={s.tone}>
                  {s.badge}
                </span>
              </div>
              <h3 className={styles.serviceTitle}>{s.name}</h3>
              <p className={styles.serviceDesc}>{s.desc}</p>
            </article>
          ))}
        </div>
      </section>

      {/* §12. Operator checklist (inverse surface) --------------------------*/}
      <section className={styles.section} id="checklist">
        <header className={styles.sectionHeader}>
          <span className={styles.sectionKicker}>§12 · Operator</span>
          <h2 className={styles.sectionTitle}>오퍼레이터 체크리스트 — Inverse Surface</h2>
          <p className={styles.sectionNote}>
            일부 영역은 라이트 테마에서도 의도적으로 다크 서피스를 사용합니다. <code>--inverse-*</code> 토큰
            패밀리를 쓰기 때문에 다크 모드에서도 동일한 역할과 대비가 유지됩니다.
          </p>
        </header>

        <aside className={styles.checklistCard}>
          <h3 className={styles.checklistTitle}>
            <span className="material-symbols-outlined" aria-hidden="true">
              task_alt
            </span>
            오늘의 런북 · 4 / 4
          </h3>
          {CHECKLIST.map((item) => (
            <div key={item.label} className={styles.checklistItem}>
              <div className={styles.checkbox} data-checked={item.checked ? "true" : "false"} aria-hidden="true">
                <span className="material-symbols-outlined">{item.checked ? "check" : ""}</span>
              </div>
              <span className={styles.checklistLabel} data-checked={item.checked ? "true" : "false"}>
                {item.label}
              </span>
              <span className={styles.checklistStatus} data-checked={item.checked ? "true" : "false"}>
                {item.status}
              </span>
            </div>
          ))}
        </aside>
      </section>

      {/* §13. Timeline ------------------------------------------------------*/}
      <section className={styles.section} id="timeline">
        <header className={styles.sectionHeader}>
          <span className={styles.sectionKicker}>§13 · Timeline</span>
          <h2 className={styles.sectionTitle}>온체인 타임라인</h2>
          <p className={styles.sectionNote}>
            유입/유출 방향은 배지 색으로 구분합니다. 모노 폰트와 <code>tabular-nums</code>가 지갑 주소와 수량
            정렬에 쓰입니다.
          </p>
        </header>

        <article className={styles.timelineCard}>
          <ol className={styles.timelineList}>
            {TIMELINE.map((t) => (
              <li key={t.headline} className={styles.timelineItem}>
                <div className={styles.timelineIcon} aria-hidden="true">
                  <span className="material-symbols-outlined">{t.icon}</span>
                </div>
                <div className={styles.timelineBody}>
                  <p className={styles.timelineHeadline}>
                    <strong>{t.headline}</strong>
                    <span className={styles.timelineBadge} data-dir={t.dir}>
                      {t.badge}
                    </span>
                  </p>
                  <span className={styles.timelineMeta}>{t.meta}</span>
                </div>
              </li>
            ))}
          </ol>
        </article>
      </section>

      {/* §14. Mood gauge ----------------------------------------------------*/}
      <section className={styles.section} id="mood">
        <header className={styles.sectionHeader}>
          <span className={styles.sectionKicker}>§14 · Mood</span>
          <h2 className={styles.sectionTitle}>오늘의 시장 무드</h2>
          <p className={styles.sectionNote}>
            인사이트 페이지의 감정 게이지. 숫자 한 개 + 한 줄 카피 + 근거 한 줄로 구성합니다.
          </p>
        </header>

        <article className={styles.moodCard}>
          <span className={styles.moodLabel}>Market Mood Index</span>
          <div className={styles.moodGauge}>
            <svg viewBox="0 0 120 120" role="img" aria-label="시장 무드 지수 68점">
              <circle
                className={styles.moodGaugeBg}
                cx="60"
                cy="60"
                r="52"
                fill="none"
                strokeWidth="12"
              />
              <circle
                className={styles.moodGaugeFill}
                cx="60"
                cy="60"
                r="52"
                fill="none"
                strokeWidth="12"
                strokeDasharray="326.7"
                strokeDashoffset="104.5"
                transform="rotate(-90 60 60)"
                strokeLinecap="round"
              />
            </svg>
            <div className={styles.moodGaugeCenter}>68</div>
          </div>
          <span className={styles.moodTone}>조심스러운 낙관</span>
          <p className={styles.moodCopy}>
            순유입과 스테이킹 증가가 유동성 이벤트를 상쇄하고 있습니다.
          </p>
          <span className={styles.moodDetail}>
            BTC 넷플로우 +1.8K · ETH 스테이킹 +4.2K · 파생 레버리지 1.82 · 지난 7일 평균 대비 +11pt
          </span>
        </article>
      </section>

      {/* §15. AI explain flow -----------------------------------------------*/}
      <section className={styles.section} id="explain">
        <header className={styles.sectionHeader}>
          <span className={styles.sectionKicker}>§15 · AI Explain</span>
          <h2 className={styles.sectionTitle}>AI 설명 플로우</h2>
          <p className={styles.sectionNote}>
            시그널 → 요약 → 리포트로 이어지는 3-step 파이프라인을 단일 카드에서 시각화합니다. 현재 단계는
            <code>data-highlight=&quot;filled&quot;</code>, 다음 단계는 <code>data-highlight=&quot;true&quot;</code>로
            강조합니다.
          </p>
        </header>

        <article className={styles.explainCard}>
          <div className={styles.explainFlow}>
            <div className={styles.explainStep}>
              <div className={styles.explainStepIcon} data-highlight="filled" aria-hidden="true">
                <span className="material-symbols-outlined">sensors</span>
              </div>
              <span className={styles.explainStepLabel} data-highlight="true">
                온체인 시그널 수집
              </span>
            </div>
            <div className={styles.explainConnector} aria-hidden="true" />
            <div className={styles.explainStep}>
              <div className={styles.explainStepIcon} data-highlight="true" aria-hidden="true">
                <span className="material-symbols-outlined">psychology</span>
              </div>
              <span className={styles.explainStepLabel} data-highlight="true">
                Claude 요약 · 맥락화
              </span>
            </div>
            <div className={styles.explainConnector} aria-hidden="true" />
            <div className={styles.explainStep}>
              <div className={styles.explainStepIcon} aria-hidden="true">
                <span className="material-symbols-outlined">description</span>
              </div>
              <span className={styles.explainStepLabel}>Daily Brief 발행</span>
            </div>
          </div>
        </article>
      </section>

      {/* §16. Buttons / pills / empty state --------------------------------*/}
      <section className={styles.section} id="components">
        <header className={styles.sectionHeader}>
          <span className={styles.sectionKicker}>§16 · Components</span>
          <h2 className={styles.sectionTitle}>버튼 · 필 · 빈 상태</h2>
          <p className={styles.sectionNote}>
            버튼은 primary / secondary / ghost / danger 4종. 모든 인터랙티브 요소는 <code>:hover</code>,{" "}
            <code>:active</code>, <code>:focus-visible</code>, <code>disabled</code>를 만족합니다.
          </p>
        </header>

        <div className={styles.card}>
          <div className={styles.btnRow}>
            <button type="button" className={styles.btnPrimary}>
              <span className="material-symbols-outlined" aria-hidden="true">
                bolt
              </span>
              시그널 생성
            </button>
            <button type="button" className={styles.btnSecondary}>
              <span className="material-symbols-outlined" aria-hidden="true">
                download
              </span>
              CSV 내보내기
            </button>
            <button type="button" className={styles.btnGhost}>
              <span className="material-symbols-outlined" aria-hidden="true">
                edit
              </span>
              설정
            </button>
            <button type="button" className={styles.btnDanger}>
              <span className="material-symbols-outlined" aria-hidden="true">
                delete
              </span>
              삭제
            </button>
            <button type="button" className={styles.btnSecondary} disabled>
              <span className="material-symbols-outlined" aria-hidden="true">
                hourglass_empty
              </span>
              처리 중…
            </button>
          </div>

          <div className={styles.pillRow}>
            <span className={styles.pill} data-tone="good">
              정상
            </span>
            <span className={styles.pill} data-tone="warn">
              지연
            </span>
            <span className={styles.pill} data-tone="bad">
              실패
            </span>
            <span className={styles.pill} data-tone="neutral">
              대기
            </span>
          </div>

          <div className={styles.emptyState}>
            <span className="material-symbols-outlined" aria-hidden="true">
              inbox
            </span>
            <h3 className={styles.emptyStateTitle}>아직 시그널이 없습니다</h3>
            <p className={styles.emptyStateBody}>
              새 시그널이 감지되면 이 공간이 Daily Brief의 재료가 됩니다. 모니터링 규칙을 구성하려면 설정 화면으로
              이동하세요.
            </p>
          </div>
        </div>
      </section>

      {/* §17. Footer -------------------------------------------------------*/}
      <footer className={styles.footer}>
        <h3 className={styles.footerTitle}>Validation checklist</h3>
        <ul className={styles.footerList}>
          <li>WCAG 2.1 AA — 본문 대비 4.5:1 · UI 컴포넌트 3:1</li>
          <li>7-State — default / hover / active / focus-visible / disabled / loading / error</li>
          <li>No AI slop — side-stripe / gradient-text / transition:all / ease-in UI 0건</li>
          <li>Tokens only — preview.module.css에는 CSS 변수 재선언 없음</li>
          <li>Responsive — 1180px / 640px 브레이크포인트, 모바일에서 헤더/네비 압축</li>
          <li>Theme parity — 라이트/다크 모두에서 대비·간격·모션 동일</li>
        </ul>
      </footer>
    </main>
  );
}
