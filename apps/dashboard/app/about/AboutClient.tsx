"use client";

/**
 * /about — Client Component
 *
 * 책임:
 *   • 6 탭(onepager/readme/ainotes/metrics/timeline/log) 간 전환 + ArrowLeft/Right·Home·End 키내비
 *   • 현재 활성 패널의 h2/h3 헤딩을 스캔해 동적 TOC 구성 + IntersectionObserver 스크롤-스파이
 *   • 작업 로그 목록(76개) 날짜별 그룹핑, 검색 필터(140ms 디바운스), 선택 시 /api/about/doc로 lazy-load
 *   • 데스크탑(≥1024px) 진입 시 로그 사이드바를 좌측 aside로 포털 이동, 그 외 탭에선 TOC 표시
 *   • 딥링크: #<tabId> 또는 #log/<slug> 둘 다 지원, 초기 마운트 + hashchange 시 동기화
 *
 * 서버에서 pre-render된 ONE_PAGER/README HTML은 dangerouslySetInnerHTML로 주입하며,
 * 해당 HTML은 이미 sanitize + heading-id injection을 거친 상태다(서버 lib/about/markdown.ts).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { LogEntry } from "@/lib/about/manifest";

// ─── Types ─────────────────────────────────────────────────────────────────

type TabId = "onepager" | "readme" | "ainotes" | "metrics" | "timeline" | "log";

type TocItem = {
  id: string;
  level: 2 | 3;
  text: string;
};

type LogDocState =
  | { status: "idle" }
  | { status: "loading"; file: string }
  | { status: "ready"; file: string; html: string; label: string; slug: string }
  | { status: "error"; file: string; message: string };

type AboutClientProps = {
  entries: LogEntry[];
  logCount: number;
  onePagerHtml: string;
  readmeHtml: string;
};

const TAB_ORDER: readonly TabId[] = [
  "onepager",
  "readme",
  "ainotes",
  "metrics",
  "timeline",
  "log",
];

const TAB_LABEL: Record<TabId, string> = {
  onepager: "One Pager",
  readme: "README",
  ainotes: "AI 협업 기록",
  metrics: "지표 & 성능",
  timeline: "판단 기록",
  log: "작업 로그",
};

// CSS에 정의된 known 카테고리 화이트리스트. 그 밖은 "기타"로 폴백.
const KNOWN_CATEGORIES = new Set([
  "다관점 리뷰",
  "개선 계획 · 프롬프트",
  "아키텍처 · 데이터",
  "QA · 종합 보고서",
  "UX · 디자인",
  "문서 스냅샷",
  "자료 · 레퍼런스",
  "기타",
]);

// ─── Helpers ───────────────────────────────────────────────────────────────

function parseHash(): { tab: TabId | null; logSlug: string | null } {
  if (typeof window === "undefined") return { tab: null, logSlug: null };
  const raw = window.location.hash.replace(/^#/, "");
  if (!raw) return { tab: null, logSlug: null };
  if (raw.startsWith("log/")) {
    return { tab: "log", logSlug: decodeURIComponent(raw.slice("log/".length)) };
  }
  if ((TAB_ORDER as readonly string[]).includes(raw)) {
    return { tab: raw as TabId, logSlug: null };
  }
  return { tab: null, logSlug: null };
}

function groupEntriesByDate(entries: LogEntry[]): Array<{ date: string; items: LogEntry[] }> {
  const groups = new Map<string, LogEntry[]>();
  for (const entry of entries) {
    const key = entry.date ?? "기타";
    const bucket = groups.get(key);
    if (bucket) bucket.push(entry);
    else groups.set(key, [entry]);
  }
  // 날짜 역순(최신 먼저), 미분류("기타")는 맨 끝으로.
  const sortedKeys = [...groups.keys()].sort((a, b) => {
    if (a === "기타") return 1;
    if (b === "기타") return -1;
    return b.localeCompare(a);
  });
  return sortedKeys.map((date) => ({
    date,
    items: [...(groups.get(date) ?? [])].sort((a, b) => a.seq.localeCompare(b.seq)),
  }));
}

function categoryBadgeLabel(category: string): string {
  return KNOWN_CATEGORIES.has(category) ? category : "기타";
}

function matchesQuery(entry: LogEntry, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  return (
    entry.title.toLowerCase().includes(q) ||
    entry.file.toLowerCase().includes(q) ||
    entry.category.toLowerCase().includes(q) ||
    entry.slug.toLowerCase().includes(q)
  );
}

// ─── Main component ─────────────────────────────────────────────────────────

export function AboutClient({ entries, logCount, onePagerHtml, readmeHtml }: AboutClientProps) {
  // Tab state
  const [activeTab, setActiveTab] = useState<TabId>("onepager");

  // Search (raw input) + debounced query
  const [searchInput, setSearchInput] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");

  // Log selection
  const [logDoc, setLogDoc] = useState<LogDocState>({ status: "idle" });

  // Viewport (≥1024px) for sidebar portal target
  const [isDesktop, setIsDesktop] = useState(false);

  // TOC derived from active panel's DOM
  const [tocItems, setTocItems] = useState<TocItem[]>([]);
  const [activeTocId, setActiveTocId] = useState<string | null>(null);

  // Desktop aside slot ref (portal target)
  const desktopSlotRef = useRef<HTMLDivElement>(null);
  // Main article ref — TOC scan root
  const panelMainRef = useRef<HTMLDivElement>(null);
  // Tab button refs for keyboard nav
  const tabRefs = useRef<Record<TabId, HTMLButtonElement | null>>({
    onepager: null,
    readme: null,
    ainotes: null,
    metrics: null,
    timeline: null,
    log: null,
  });
  // Track whether we've already consumed initial hash
  const initialHashAppliedRef = useRef(false);

  // ── Initial hash (runs once) ──────────────────────────────────────────────
  useEffect(() => {
    if (initialHashAppliedRef.current) return;
    initialHashAppliedRef.current = true;
    const { tab, logSlug } = parseHash();
    if (tab) setActiveTab(tab);
    if (logSlug) {
      const match = entries.find((e) => e.slug === logSlug);
      if (match) {
        void loadLogEntry(match);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── hashchange listener ───────────────────────────────────────────────────
  useEffect(() => {
    function onHashChange() {
      const { tab, logSlug } = parseHash();
      if (tab && tab !== activeTab) setActiveTab(tab);
      if (logSlug) {
        const match = entries.find((e) => e.slug === logSlug);
        if (match && (logDoc.status === "idle" || (logDoc.status === "ready" && logDoc.slug !== logSlug))) {
          void loadLogEntry(match);
        }
      }
    }
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, entries, logDoc.status]);

  // ── matchMedia: track ≥1024px for portal target ──────────────────────────
  useEffect(() => {
    const mql = window.matchMedia("(min-width: 1024px)");
    const update = () => setIsDesktop(mql.matches);
    update();
    mql.addEventListener("change", update);
    return () => mql.removeEventListener("change", update);
  }, []);

  // ── Debounce search input (140ms) ─────────────────────────────────────────
  useEffect(() => {
    const handle = setTimeout(() => setDebouncedQuery(searchInput.trim()), 140);
    return () => clearTimeout(handle);
  }, [searchInput]);

  // ── Build TOC from active panel ───────────────────────────────────────────
  useEffect(() => {
    const root = panelMainRef.current;
    if (!root) return;

    // Scan only the active panel.
    const activePanel = root.querySelector<HTMLElement>(`#panel-${activeTab}`);
    if (!activePanel) {
      setTocItems([]);
      return;
    }

    // The log panel shows document content in its own scope; allow it too.
    const headings = activePanel.querySelectorAll<HTMLElement>("h2[id], h3[id]");
    const items: TocItem[] = [];
    headings.forEach((h) => {
      const level = h.tagName === "H2" ? 2 : 3;
      items.push({
        id: h.id,
        level: level as 2 | 3,
        text: (h.textContent ?? "").trim(),
      });
    });
    setTocItems(items);
    setActiveTocId(items[0]?.id ?? null);
  }, [activeTab, onePagerHtml, readmeHtml, logDoc]);

  // ── IntersectionObserver scroll-spy ───────────────────────────────────────
  useEffect(() => {
    if (tocItems.length === 0) return;
    const elements = tocItems
      .map((item) => document.getElementById(item.id))
      .filter((el): el is HTMLElement => Boolean(el));
    if (elements.length === 0) return;

    const visibility = new Map<string, number>();
    const observer = new IntersectionObserver(
      (entriesObs) => {
        for (const entry of entriesObs) {
          visibility.set(entry.target.id, entry.intersectionRatio);
        }
        // Highest-ratio element wins. If none intersects, keep prior selection.
        let bestId: string | null = null;
        let bestRatio = 0;
        for (const [id, ratio] of visibility) {
          if (ratio > bestRatio) {
            bestRatio = ratio;
            bestId = id;
          }
        }
        if (bestId) setActiveTocId(bestId);
      },
      {
        root: null,
        rootMargin: "-20% 0px -60% 0px",
        threshold: [0, 0.25, 0.5, 0.75, 1],
      },
    );
    elements.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [tocItems]);

  // ── Load a log entry via API route ────────────────────────────────────────
  const loadLogEntry = useCallback(async (entry: LogEntry) => {
    setLogDoc({ status: "loading", file: entry.file });
    try {
      // source=dashboard → apps/dashboard/<file>, 그 외(undefined/"obsidian") → docs/obsidian/<file>
      const prefix = entry.source === "dashboard" ? "dashboard" : "log";
      const res = await fetch(
        `/api/about/doc?src=${prefix}/${encodeURIComponent(entry.file)}`,
        { cache: "no-store" },
      );
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new Error(`HTTP ${res.status} — ${detail.slice(0, 200)}`);
      }
      const body = (await res.json()) as { html: string; label: string; slug: string };
      setLogDoc({
        status: "ready",
        file: entry.file,
        html: body.html,
        label: body.label,
        slug: entry.slug,
      });
      // Sync hash without scroll jump so deep links can be copied.
      if (typeof window !== "undefined") {
        const nextHash = `#log/${encodeURIComponent(entry.slug)}`;
        if (window.location.hash !== nextHash) {
          history.replaceState(null, "", nextHash);
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setLogDoc({ status: "error", file: entry.file, message });
    }
  }, []);

  // ── Switch tabs (with hash update) ────────────────────────────────────────
  const activateTab = useCallback((tab: TabId) => {
    setActiveTab(tab);
    if (typeof window !== "undefined") {
      const nextHash = `#${tab}`;
      if (window.location.hash !== nextHash) {
        history.replaceState(null, "", nextHash);
      }
    }
  }, []);

  // Keyboard nav: ArrowRight / ArrowLeft / Home / End on tabs
  const onTabKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLButtonElement>, current: TabId) => {
      const idx = TAB_ORDER.indexOf(current);
      let next: TabId | null = null;
      if (e.key === "ArrowRight") next = TAB_ORDER[(idx + 1) % TAB_ORDER.length];
      else if (e.key === "ArrowLeft") next = TAB_ORDER[(idx - 1 + TAB_ORDER.length) % TAB_ORDER.length];
      else if (e.key === "Home") next = TAB_ORDER[0];
      else if (e.key === "End") next = TAB_ORDER[TAB_ORDER.length - 1];
      if (next) {
        e.preventDefault();
        activateTab(next);
        tabRefs.current[next]?.focus();
      }
    },
    [activateTab],
  );

  // ── Derived data ──────────────────────────────────────────────────────────
  const filteredEntries = useMemo(
    () => entries.filter((e) => matchesQuery(e, debouncedQuery)),
    [entries, debouncedQuery],
  );

  const grouped = useMemo(() => groupEntriesByDate(filteredEntries), [filteredEntries]);

  // Sidebar portal: on desktop + log tab, render into aside. On mobile + log tab,
  // render inline in the log panel's mobile slot. In either case, the same
  // element tree is mounted only once to preserve input focus and selection.
  const renderSidebarTarget: "desktop" | "mobile" | null =
    activeTab === "log" ? (isDesktop ? "desktop" : "mobile") : null;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <>
      {/* ============== Tab bar ============== */}
      <section style={{ marginBottom: "24px" }}>
        <div className="glass-card tab-bar" role="tablist" aria-label="과제 문서 섹션">
          {TAB_ORDER.map((tab) => (
            <button
              key={tab}
              ref={(el) => {
                tabRefs.current[tab] = el;
              }}
              type="button"
              className="tab-chip"
              role="tab"
              aria-selected={activeTab === tab}
              aria-controls={`panel-${tab}`}
              id={`tab-${tab}`}
              tabIndex={activeTab === tab ? 0 : -1}
              onClick={() => activateTab(tab)}
              onKeyDown={(e) => onTabKeyDown(e, tab)}
            >
              {TAB_LABEL[tab]}
            </button>
          ))}
        </div>
      </section>

      {/* ============== Panel grid ============== */}
      <section className="panel-grid">
        {/* ---------- Sticky aside (desktop ≥1024px) ---------- */}
        <aside className="panel-aside" aria-label="좌측 사이드바">
          <div className="panel-aside-sticky">
            {/* Desktop slot — portal target for log sidebar when active */}
            <div
              id="ws-log-sidebar-slot-desk"
              ref={desktopSlotRef}
              style={{
                display: activeTab === "log" ? "flex" : "none",
                flex: "1 1 auto",
                minHeight: 0,
                flexDirection: "column",
              }}
            />

            {/* TOC — hidden when log tab is active */}
            <nav
              className="glass-card toc-scope ws-toc-scroll"
              id="toc-nav"
              aria-label="목차"
              style={{ display: activeTab === "log" ? "none" : "block" }}
            >
              <p className="toc-scope-label">이 문서에서</p>
              <ol className="toc-list">
                {tocItems.map((item) => (
                  <li key={item.id}>
                    <a
                      href={`#${item.id}`}
                      className={`toc-link toc-h${item.level}`}
                      aria-current={activeTocId === item.id ? "true" : undefined}
                      onClick={(e) => {
                        // Allow native anchor scroll; keep hash stable.
                        e.stopPropagation();
                      }}
                    >
                      {item.text}
                    </a>
                  </li>
                ))}
                {tocItems.length === 0 && (
                  <li style={{ fontSize: 12, color: "#6b7280", padding: "4px 8px" }}>
                    목차가 없습니다.
                  </li>
                )}
              </ol>
              <div className="toc-footer">
                <a className="toc-footer-link" href="#main">
                  <span
                    className="material-symbols-outlined"
                    aria-hidden="true"
                    style={{ fontSize: 14 }}
                  >
                    arrow_upward
                  </span>
                  맨 위로
                </a>
              </div>
            </nav>
          </div>
        </aside>

        {/* ---------- Main article ---------- */}
        <div className="glass-card panel-main" ref={panelMainRef}>
          {/* === Panel: One Pager === */}
          <article
            id="panel-onepager"
            role="tabpanel"
            aria-labelledby="tab-onepager"
            className={`prose-editorial${activeTab === "onepager" ? " is-active" : ""}`}
          >
            <header className="panel-md-header">
              <div>
                <p className="panel-head-eyebrow">ONE_PAGER.md · 원문 렌더</p>
                <p>
                  저장소 루트의 <code>ONE_PAGER.md</code>를 서버에서 렌더링했습니다. 편집은 원본 파일에서만
                  수행하세요.
                </p>
              </div>
              <a
                href="https://github.com/basilry/reuton_whale"
                rel="noopener"
                target="_blank"
                className="btn-ghost"
                style={{ fontSize: 12, padding: "8px 12px" }}
              >
                <span
                  className="material-symbols-outlined"
                  aria-hidden="true"
                  style={{ fontSize: 16 }}
                >
                  open_in_new
                </span>
                GitHub에서 보기
              </a>
            </header>
            <div className="md-content" dangerouslySetInnerHTML={{ __html: onePagerHtml }} />
          </article>

          {/* === Panel: README === */}
          <article
            id="panel-readme"
            role="tabpanel"
            aria-labelledby="tab-readme"
            className={`prose-editorial${activeTab === "readme" ? " is-active" : ""}`}
          >
            <header className="panel-md-header">
              <div>
                <p className="panel-head-eyebrow">README.md · 원문 렌더</p>
                <p>
                  저장소 루트의 <code>README.md</code>를 서버에서 렌더링했습니다. 편집은 원본 파일에서만
                  수행하세요.
                </p>
              </div>
              <a
                href="https://github.com/basilry/reuton_whale"
                rel="noopener"
                target="_blank"
                className="btn-ghost"
                style={{ fontSize: 12, padding: "8px 12px" }}
              >
                <span
                  className="material-symbols-outlined"
                  aria-hidden="true"
                  style={{ fontSize: 16 }}
                >
                  open_in_new
                </span>
                GitHub에서 보기
              </a>
            </header>
            <div className="md-content" dangerouslySetInnerHTML={{ __html: readmeHtml }} />
          </article>

          {/* === Panel: AI Notes === */}
          <article
            id="panel-ainotes"
            role="tabpanel"
            aria-labelledby="tab-ainotes"
            className={`prose-editorial${activeTab === "ainotes" ? " is-active" : ""}`}
          >
            <header style={{ marginBottom: 24 }}>
              <p className="panel-head-eyebrow">AI 협업 · 투명성</p>
              <h2 className="panel-head-title">AI는 어디에 어떻게 쓰였는가</h2>
            </header>

            <h3 id="ai-1">1. 사용 정의</h3>
            <p>
              AI는 <strong>생성·탐색·리팩토링의 속도를 올리는 보조 도구</strong>로 썼다. 설계의 근거와 평가,
              가설 갱신은 본인이 수행하였다. 아래 표는 각 도구의 실제 역할이다.
            </p>

            <h3 id="ai-2">2. 개발 AI 분업</h3>
            <table>
              <thead>
                <tr>
                  <th>도구</th>
                  <th>주 용도</th>
                  <th>구체 사례</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>
                    <strong>Codex</strong>
                  </td>
                  <td>리서치·스켈레톤</td>
                  <td>초기 폴더 구조, 탐지 규칙 의사코드</td>
                </tr>
                <tr>
                  <td>
                    <strong>Claude Code</strong>
                  </td>
                  <td>리팩토링·테스트 설계</td>
                  <td>402개 pytest 전수, SSE 스트림 재작성</td>
                </tr>
                <tr>
                  <td>
                    <strong>Cursor</strong>
                  </td>
                  <td>실시간 IDE 보조</td>
                  <td>타입 힌트 보정, 오탈자 수정</td>
                </tr>
                <tr>
                  <td>
                    <strong>Claude + Obsidian</strong>
                  </td>
                  <td>설계 의사결정 기록</td>
                  <td>Daily 노트 · 가설 수정 히스토리</td>
                </tr>
              </tbody>
            </table>

            <h3 id="ai-3">3. 런타임 AI 분업</h3>
            <p>
              의도적으로 3개 공급자를 동시에 운영한다. Anthropic이 primary, Gemini는 영미권 뉴스 요약에 강점,
              Groq는 초저 레이턴시 fallback.
            </p>
            <ul>
              <li>
                <strong>Primary</strong> — Anthropic (Claude) · 한국어 뉘앙스 · 규범 준수
              </li>
              <li>
                <strong>Fallback 1</strong> — Google Gemini · 비용 · 영미 컨텍스트
              </li>
              <li>
                <strong>Fallback 2</strong> — Groq · 50ms 단위 응답 · 장애 시 최후 안전망
              </li>
            </ul>
            <blockquote>
              장애 상황 재현 테스트에서 3단 라우터가 평균{" "}
              <span className="tabular-nums">2.4초</span> 이내에 결과를 반환하는 것을 확인했다. primary 전용
              구성은 같은 조건에서 타임아웃 10초 이상이었다.
            </blockquote>

            <h3 id="ai-4">4. AI가 하지 않는 것</h3>
            <ul>
              <li>추천 코인/포지션 제안 — 가격 예측을 생성하지 않는다</li>
              <li>가설 수립·KPI 결정 — 지원자 본인이 한다</li>
              <li>최종 배포 승인 — 테스트 green + 리뷰 후 사람이 푸시</li>
            </ul>

            <h3 id="ai-5">5. 재현 가능성</h3>
            <p>
              설계 · 리팩토링 세션 로그는 Obsidian에 날짜별로 남아 있다. 파이프라인의 deterministic 구간(규칙
              · 집계)은 재실행 시 동일 입력에 동일 출력이며, LLM 구간은 프롬프트 버저닝과 seed 고정으로 변동
              폭을 줄였다.
            </p>
          </article>

          {/* === Panel: Metrics === */}
          <article
            id="panel-metrics"
            role="tabpanel"
            aria-labelledby="tab-metrics"
            className={`prose-editorial${activeTab === "metrics" ? " is-active" : ""}`}
          >
            <header style={{ marginBottom: 24 }}>
              <p className="panel-head-eyebrow">KPI · Test · Perf</p>
              <h2 className="panel-head-title">판단 가능한 서비스인지 수치로 증명한다</h2>
            </header>

            <h3 id="mt-1">1. 북극성 &amp; Kill 기준</h3>
            <p>
              북극성은 <strong>Daily Brief 열람률 60%</strong>, Kill 기준은 2주 기준{" "}
              <span className="tabular-nums">30/10/30</span>.
            </p>
            <table>
              <thead>
                <tr>
                  <th>지표</th>
                  <th>목표</th>
                  <th>Kill 역치</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Daily Brief 열람률</td>
                  <td className="tabular-nums">60%</td>
                  <td>&lt; 30% (2주 연속)</td>
                </tr>
                <tr>
                  <td>4주 리텐션</td>
                  <td className="tabular-nums">35%</td>
                  <td>&lt; 10%</td>
                </tr>
                <tr>
                  <td>허위 시그널 비율</td>
                  <td className="tabular-nums">&lt; 10%</td>
                  <td>&gt; 30%</td>
                </tr>
              </tbody>
            </table>

            <h3 id="mt-2">2. 테스트 커버리지</h3>
            <p>
              <strong>pytest 402개 전체 green.</strong> smoke fallback(keyless 빌드) 경로 포함. 단위 테스트
              (수집·집계·라우터 fallback)와 시나리오 테스트(전체 파이프라인 E2E mock)가 같이 돈다.
            </p>
            <ul>
              <li>수집기 단위 — chain별 fixture 기반 parser 테스트</li>
              <li>규칙 엔진 — 8개 규칙 × edge case per-rule</li>
              <li>LLM 라우터 — primary/fallback 3가지 장애 시나리오</li>
              <li>SSE stream — Redis L2 TTL(45/60초) 경계 테스트</li>
            </ul>

            <h3 id="mt-3">3. 성능 지표</h3>
            <table>
              <thead>
                <tr>
                  <th>지표</th>
                  <th>Before</th>
                  <th>After</th>
                  <th>Δ</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>First Load JS</td>
                  <td className="tabular-nums">312 kB</td>
                  <td className="tabular-nums">206 kB</td>
                  <td className="tabular-nums" style={{ fontWeight: 700, color: "#00691e" }}>
                    −34%
                  </td>
                </tr>
                <tr>
                  <td>Route (대시보드)</td>
                  <td className="tabular-nums">193 kB</td>
                  <td className="tabular-nums">86.1 kB</td>
                  <td className="tabular-nums" style={{ fontWeight: 700, color: "#00691e" }}>
                    −55%
                  </td>
                </tr>
                <tr>
                  <td>Runtime cost</td>
                  <td className="tabular-nums">$21/mo</td>
                  <td className="tabular-nums">$9/mo</td>
                  <td className="tabular-nums" style={{ fontWeight: 700, color: "#00691e" }}>
                    −57%
                  </td>
                </tr>
                <tr>
                  <td>Test count</td>
                  <td className="tabular-nums">—</td>
                  <td className="tabular-nums">402</td>
                  <td>전체 green</td>
                </tr>
              </tbody>
            </table>

            <h3 id="mt-4">4. 하이브리드 브리핑 — 비용 절감 근거</h3>
            <p>
              KST 09 · 15 · 21시에만 전체 브리핑 생성, 나머지 시간은 증분(incremental)으로만 업데이트한다.
              LLM 호출 수 감소로 $21 → $9/month.
            </p>
            <blockquote>
              &quot;하루 3회의 진짜 레터 + 그 사이의 얇은 증분&quot; — 독서감 훼손 없이 비용 절반 이하로 내렸다.
            </blockquote>

            <h3 id="mt-5">5. 비추적 지표</h3>
            <p>
              의도적으로 추적하지 <strong>않는</strong> 지표가 있다. 일일 발송 수량 · DAU 절대값 · 시그널 수.
              이것을 KPI로 두면 양을 늘리기 위해 품질을 희생하게 된다.
            </p>
          </article>

          {/* === Panel: Timeline === */}
          <article
            id="panel-timeline"
            role="tabpanel"
            aria-labelledby="tab-timeline"
            className={`prose-editorial${activeTab === "timeline" ? " is-active" : ""}`}
          >
            <header style={{ marginBottom: 24 }}>
              <p className="panel-head-eyebrow">Decision Log · Day 1 → Day 10</p>
              <h2 className="panel-head-title">가설은 어떻게 갱신되었는가</h2>
            </header>

            <h3 id="tl-1">Day 1–3 · 리서치 → IA → 스택</h3>
            <ul>
              <li>
                <strong>가설 ①</strong> Whale Alert API를 구독해 빠르게 붙인다 → <strong>기각</strong>. 체인
                커버리지 부족 + 월 비용이 MVP 예산 초과. self-collect 방향으로 선회.
              </li>
              <li>
                <strong>가설 ②</strong> 규칙 엔진만으로 충분하다 → <strong>부분 기각</strong>. &quot;왜
                중요한가&quot;에 답할 컨텍스트가 없어 한국어 해석 레이어 필요. LLM 라우터 설계 도입.
              </li>
            </ul>

            <h3 id="tl-2">Day 4–6 · 구현</h3>
            <ul>
              <li>
                <strong>가설 ③</strong> Streamlit이 7일에 적합하다 → <strong>기각</strong>. 공유 URL · SEO ·
                반응성이 나오지 않는다. Next.js 15 App Router로 재작성 결정. 첫 2일 속도 손해는 이후 운영 ·
                확장에서 회수됨.
              </li>
              <li>
                <strong>가설 ④</strong> Anthropic 단일 공급자로 충분 → <strong>기각</strong>. 장애 재현
                테스트에서 타임아웃 10초 이상. 3단 라우터 도입.
              </li>
            </ul>

            <h3 id="tl-3">Day 7 · MVP 제출</h3>
            <p>
              제출 시점 기준 체인 6개 상시 + 4개 카나리 + 규칙 8개 + 라우터 3공급자 + pytest 402. 지원서와
              함께 이 <code>/about</code> 페이지의 초안을 동봉.
            </p>

            <h3 id="tl-4">Day 8–10 · 제출 후 이터레이션</h3>
            <ul>
              <li>번들 분석 · 코드 스플리팅 → First Load JS −34%</li>
              <li>하이브리드 브리핑 도입 → Runtime cost −57%</li>
              <li>Sheets L1 + Redis L2 dual-role 정식화</li>
            </ul>

            <h3 id="tl-5">유지된 결정</h3>
            <blockquote>
              &quot;탐지는 규칙, 설명은 LLM&quot; — 1일차부터 유지된 단일 원칙. 아키텍처 흔들림 없이 10일 내내
              파이프라인의 분업이 유지됨.
            </blockquote>

            <h3 id="tl-6">회고 — 다음에 바꾼다면</h3>
            <ul>
              <li>Day 1에 Next.js로 바로 시작 — Streamlit에서의 2일 투자는 회수되지 않았다</li>
              <li>시장 컨텍스트(가격·매크로) 연결을 Day 5 이전에 — 규칙 품질 상한이 데이터 폭에 묶인다</li>
              <li>피드백 루프 프로토타입을 Day 6에 — 포스트 제출이 아니라 제출 전에</li>
            </ul>
          </article>

          {/* === Panel: Log === */}
          <article
            id="panel-log"
            role="tabpanel"
            aria-labelledby="tab-log"
            className={`prose-editorial${activeTab === "log" ? " is-active" : ""}`}
          >
            <header className="panel-md-header">
              <div>
                <p className="panel-head-eyebrow">Session Log · 2026-04-14 → 2026-04-23</p>
                <h2 className="panel-head-title">
                  10일간의 작업 로그 — <span className="tabular-nums">{logCount}</span>개 세션
                </h2>
                <p style={{ fontSize: 14, marginTop: 8, maxWidth: "65ch" }}>
                  프로젝트 기간 동안 Obsidian에 축적된 설계 / 리뷰 / 개선 이행 문서를 일자별로 열람합니다.
                  왼쪽 목록에서 문서를 선택하면 우측에 원문이 렌더됩니다.
                </p>
              </div>
            </header>

            <div className="ws-log-wrap">
              {/* Mobile slot — portal target for the sidebar on <1024px */}
              <aside
                className="ws-log-sidebar-slot-mobile"
                id="ws-log-sidebar-slot-mobile"
                aria-label="작업 로그 목록"
              />

              <section className="ws-log-content" style={{ minWidth: 0 }}>
                <div className="ws-log-doc-header">
                  <div style={{ minWidth: 0 }}>
                    <p className="meta">
                      {logDoc.status === "idle" && "문서 미선택"}
                      {logDoc.status === "loading" && "불러오는 중…"}
                      {logDoc.status === "ready" && logDoc.label}
                      {logDoc.status === "error" && "불러오기 실패"}
                    </p>
                    <h3 className="title">
                      {logDoc.status === "idle" && "왼쪽에서 세션 문서를 선택하세요"}
                      {logDoc.status === "loading" &&
                        entries.find((e) => e.file === logDoc.file)?.title}
                      {logDoc.status === "ready" &&
                        entries.find((e) => e.file === logDoc.file)?.title}
                      {logDoc.status === "error" && "문서를 불러오지 못했습니다"}
                    </h3>
                  </div>
                </div>

                <div className="md-content" aria-live="polite">
                  {logDoc.status === "idle" && (
                    <div
                      className="md-empty-state"
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 12,
                        padding: 24,
                      }}
                    >
                      <span
                        className="material-symbols-outlined"
                        aria-hidden="true"
                        style={{ fontSize: 28 }}
                      >
                        article
                      </span>
                      <p style={{ fontWeight: 700, margin: 0 }}>작업 로그 미리보기</p>
                      <p style={{ margin: 0 }}>
                        {logCount}개 세션 문서는 프로젝트 기간(10일) 동안 축적된 설계·리뷰·개선 이행
                        기록입니다. 왼쪽 목록에서 날짜를 펼쳐 문서를 선택하면 이 영역에 원문이 렌더됩니다.
                        검색 상자로 키워드(예: 「라우터」, 「큐레이션」, 「다관점」)도 필터링 가능합니다.
                      </p>
                    </div>
                  )}
                  {logDoc.status === "loading" && (
                    <div
                      className="md-empty-state"
                      style={{ display: "flex", alignItems: "center", gap: 12 }}
                    >
                      <span
                        className="material-symbols-outlined md-loader-icon"
                        aria-hidden="true"
                      >
                        progress_activity
                      </span>
                      <span>문서를 불러오는 중…</span>
                    </div>
                  )}
                  {logDoc.status === "error" && (
                    <div className="md-error-state">
                      <strong>오류:</strong> {logDoc.message}
                    </div>
                  )}
                  {logDoc.status === "ready" && (
                    <div dangerouslySetInnerHTML={{ __html: logDoc.html }} />
                  )}
                </div>
              </section>
            </div>
          </article>
        </div>
      </section>

      {/* ============== Log sidebar (portal into slot) ============== */}
      {renderSidebarTarget &&
        (() => {
          const target =
            renderSidebarTarget === "desktop"
              ? desktopSlotRef.current
              : typeof document !== "undefined"
                ? document.getElementById("ws-log-sidebar-slot-mobile")
                : null;
          if (!target) return null;
          return createPortal(
            <LogSidebar
              grouped={grouped}
              totalCount={entries.length}
              filteredCount={filteredEntries.length}
              searchInput={searchInput}
              onSearchChange={setSearchInput}
              selectedFile={
                logDoc.status === "ready" || logDoc.status === "loading" ? logDoc.file : null
              }
              onSelect={loadLogEntry}
            />,
            target,
          );
        })()}
    </>
  );
}

// ─── LogSidebar ────────────────────────────────────────────────────────────

type LogSidebarProps = {
  grouped: Array<{ date: string; items: LogEntry[] }>;
  totalCount: number;
  filteredCount: number;
  searchInput: string;
  onSearchChange: (value: string) => void;
  selectedFile: string | null;
  onSelect: (entry: LogEntry) => void;
};

function LogSidebar({
  grouped,
  totalCount,
  filteredCount,
  searchInput,
  onSearchChange,
  selectedFile,
  onSelect,
}: LogSidebarProps) {
  const [allCollapsed, setAllCollapsed] = useState(false);
  const detailsRefs = useRef<Array<HTMLDetailsElement | null>>([]);

  const toggleAll = useCallback(() => {
    const next = !allCollapsed;
    detailsRefs.current.forEach((d) => {
      if (d) d.open = !next; // allCollapsed=true means we want closed
    });
    setAllCollapsed(next);
  }, [allCollapsed]);

  return (
    <div className="ws-log-sidebar glass-card">
      <label className="ws-log-search-input">
        <span
          className="material-symbols-outlined"
          aria-hidden="true"
          style={{ fontSize: 18, color: "#6b7280" }}
        >
          search
        </span>
        <input
          type="search"
          placeholder="제목 · 키워드 검색"
          aria-label="작업 로그 검색"
          autoComplete="off"
          spellCheck={false}
          value={searchInput}
          onChange={(e) => onSearchChange(e.target.value)}
        />
        {searchInput && (
          <button
            type="button"
            aria-label="검색어 지우기"
            onClick={() => onSearchChange("")}
          >
            <span className="material-symbols-outlined" aria-hidden="true" style={{ fontSize: 16 }}>
              close
            </span>
          </button>
        )}
      </label>

      <div className="ws-log-meta-row">
        <span className="tabular-nums">
          {searchInput
            ? `${filteredCount} / ${totalCount} documents`
            : `${totalCount} documents`}
        </span>
        <button type="button" className="ws-log-collapse-btn" onClick={toggleAll}>
          {allCollapsed ? "모두 펼치기" : "모두 접기"}
        </button>
      </div>

      <div className="ws-log-list ws-toc-scroll">
        {grouped.length === 0 ? (
          <div className="ws-log-empty">검색 결과가 없습니다.</div>
        ) : (
          grouped.map((group, groupIdx) => (
            <details
              key={group.date}
              className="ws-log-group"
              open
              ref={(el) => {
                detailsRefs.current[groupIdx] = el;
              }}
            >
              <summary>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                  <span
                    className="material-symbols-outlined ws-log-chevron"
                    aria-hidden="true"
                    style={{ fontSize: 18 }}
                  >
                    chevron_right
                  </span>
                  <span className="ws-log-date tabular-nums">{group.date}</span>
                </span>
                <span className="ws-log-daycount tabular-nums">{group.items.length}</span>
              </summary>
              <ul className="ws-log-items">
                {group.items.map((entry) => (
                  <li key={entry.file}>
                    <button
                      type="button"
                      className="ws-log-item"
                      aria-current={selectedFile === entry.file ? "true" : undefined}
                      onClick={() => onSelect(entry)}
                    >
                      <span className="ws-log-title">{entry.title}</span>
                      <span className="ws-log-meta">
                        <span className="ws-log-badge" data-cat={categoryBadgeLabel(entry.category)}>
                          {categoryBadgeLabel(entry.category)}
                        </span>
                        {entry.seq && <span className="ws-log-seq">#{entry.seq}</span>}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </details>
          ))
        )}
      </div>
    </div>
  );
}
