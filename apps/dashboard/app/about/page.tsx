/**
 * /about — 과제 소개 페이지 (Server Component shell)
 *
 * 역할:
 *   1. 언어 쿠키 해석 → <TopNavbar initialLanguage />에 주입.
 *   2. ONE_PAGER.md / README.md를 서버에서 한 번 읽고 sanitized HTML로 직렬화.
 *   3. 작업 로그 manifest를 서버에서 읽어 AboutClient에 엔트리 배열로 전달.
 *   4. 정적인 hero / 4-summary-cards / footer를 직접 렌더. 상호작용 파트는 AboutClient.
 *
 * 마크다운 파이프라인(marked + isomorphic-dompurify)은 lib/about/markdown.ts에 집중.
 * API 라우트 /api/about/doc은 동일 파이프라인을 공유해 세션 로그를 지연 로딩.
 */

import path from "node:path";
import type { Metadata } from "next";
import Link from "next/link";

import { TopNavbar } from "@/components/top-navbar";
import { getCurrentDashboardLanguage } from "@/lib/i18n/server";
import { REPO_ROOT, readAndRender } from "@/lib/about/markdown";
import { loadLogManifest } from "@/lib/about/manifest";

import { AboutClient } from "./AboutClient";
import "./about.css";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "WhaleScope | 과제 소개",
  description:
    "뤼튼 PE 과제 — 영역 C(AI 활용 콘텐츠 요약). 가설·증거·판단 기록을 5분 안에 확인하는 아카이브 페이지.",
};

export default async function AboutPage() {
  const language = await getCurrentDashboardLanguage();

  const [onePagerHtml, readmeHtml, manifest] = await Promise.all([
    readAndRender(path.join(REPO_ROOT, "ONE_PAGER.md")),
    readAndRender(path.join(REPO_ROOT, "README.md")),
    loadLogManifest(),
  ]);

  const logCount = manifest.entries.length;

  return (
    <div className="about-page wave-bg">
      <a className="skip-link" href="#main">
        본문으로 건너뛰기
      </a>

      <TopNavbar initialLanguage={language} />

      <main id="main" className="about-container">
        {/* ==================== Hero ==================== */}
        <section className="grid-12" aria-labelledby="hero-title" style={{ marginBottom: "40px" }}>
          <article className="col-12 lg-col-8 glass-card" style={{ padding: "24px" }}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginBottom: "20px" }}>
              <span className="hero-chip hero-chip--primary">
                <span className="material-symbols-outlined" aria-hidden="true" style={{ fontSize: 14 }}>
                  insights
                </span>
                영역 C · AI 활용 콘텐츠 요약
              </span>
              <span className="hero-chip hero-chip--tertiary">
                <span className="material-symbols-outlined" aria-hidden="true" style={{ fontSize: 14 }}>
                  schedule
                </span>
                Day 7 · MVP 제출
              </span>
            </div>

            <h1 id="hero-title" className="hero-title">
              매일 아침 읽는 한 장의<br />
              고래 레터, <span className="accent">WhaleScope</span>
            </h1>

            <div className="editorial-rule" />

            <p className="hero-lead">
              온체인 고래 지갑의 이동을 <strong>규칙 엔진 + LLM 라우터</strong>로 해석하고, 한국어 2–3문장
              컨텍스트로 매일 09:00·15:00·21:00 큐레이션합니다. Streamlit 프로토타입에서 Next.js + Google
              Sheets + Upstash Redis로 재설계했습니다.
            </p>

            <p className="hero-sub">
              이 페이지는 배포 URL에 도달한 심사위원이 GitHub을 보지 않고도 맥락·증거·판단 기록을 5분 안에
              확인할 수 있도록 재구성한 아카이브입니다.
            </p>

            <div className="hero-cta-row">
              <Link href="/" className="btn-primary">
                <span className="material-symbols-outlined" aria-hidden="true" style={{ fontSize: 18 }}>
                  dashboard
                </span>
                라이브 대시보드 열기
              </Link>
              <a
                href="https://github.com/basilry/reuton_whale"
                rel="noopener"
                target="_blank"
                className="btn-ghost"
              >
                <span className="material-symbols-outlined" aria-hidden="true" style={{ fontSize: 18 }}>
                  code
                </span>
                GitHub 원문 저장소
              </a>
              <a
                href="https://t.me/whalescope_alertz"
                rel="noopener"
                target="_blank"
                className="btn-ghost"
              >
                <span className="material-symbols-outlined" aria-hidden="true" style={{ fontSize: 18 }}>
                  send
                </span>
                Telegram 구독
              </a>
            </div>

            <aside className="hero-callout" role="note">
              <span className="material-symbols-outlined" aria-hidden="true" style={{ flexShrink: 0 }}>
                info
              </span>
              <p>
                본 제출물은 Codex · Claude Code · Cursor · Obsidian 기반 AI 협업 워크플로우로 제작되었습니다.
                AI는 의사결정의 <strong>보조 도구</strong>이며, 가설 설정 · 아키텍처 선택 · 코드 리뷰는
                지원자 본인이 수행하였습니다.
              </p>
            </aside>
          </article>

          <aside className="col-12 lg-col-4 hero-stats" aria-label="주요 지표">
            <div className="glass-card" style={{ padding: "20px" }}>
              <div className="stat-card-label">Test Coverage</div>
              <div className="stat-card-value v-primary tabular-nums">402</div>
              <div className="stat-card-sub">pytest · 전체 green</div>
            </div>
            <div className="glass-card" style={{ padding: "20px" }}>
              <div className="stat-card-label">First Load JS</div>
              <div className="stat-card-value v-tertiary tabular-nums">
                −34<span className="suffix">%</span>
              </div>
              <div className="stat-card-sub">312 → 206 kB · 번들 최적화</div>
            </div>
            <div className="glass-card" style={{ padding: "20px" }}>
              <div className="stat-card-label">Runtime Cost</div>
              <div className="stat-card-value v-secondary tabular-nums">
                $9<span className="suffix">/mo</span>
              </div>
              <div className="stat-card-sub">$21 → $9 · 하이브리드 브리핑</div>
            </div>
          </aside>
        </section>

        {/* ==================== 4 Summary Cards ==================== */}
        <section aria-labelledby="summary-title" style={{ marginBottom: "40px" }}>
          <h2 id="summary-title" className="summary-section-label">
            한 눈에 보는 WhaleScope
          </h2>
          <div className="summary-grid">
            <article className="glass-card summary-card summary-card--err">
              <div className="summary-card-head">
                <span className="material-symbols-outlined" aria-hidden="true">
                  report
                </span>
                <h3>문제</h3>
              </div>
              <p className="summary-card-lede">데이터는 넘치는데, 해석이 없다.</p>
              <ul className="summary-card-list">
                <li>• 해석 부재 — raw tx만 남음</li>
                <li>• 정보 과부하 — 하루 100+ 시그널</li>
                <li>• 언어 장벽 — 영어 텍스트/TG 중심</li>
                <li>• 비용 장벽 — 유료 구독 $30–$100/월</li>
              </ul>
            </article>

            <article className="glass-card summary-card summary-card--pri">
              <div className="summary-card-head">
                <span className="material-symbols-outlined" aria-hidden="true">
                  auto_awesome
                </span>
                <h3>해법</h3>
              </div>
              <p className="summary-card-lede">규칙은 정확히, 설명은 자연스럽게.</p>
              <ul className="summary-card-list">
                <li>• Detection — 8개 결정론 규칙</li>
                <li>• Explanation — Anthropic→Gemini→Groq 라우터</li>
                <li>• Telegram 주요 채널 · 한국어 UX</li>
                <li>• Daily Brief 09/15/21 KST</li>
              </ul>
            </article>

            <article className="glass-card summary-card summary-card--ter">
              <div className="summary-card-head">
                <span className="material-symbols-outlined" aria-hidden="true">
                  verified
                </span>
                <h3>증거</h3>
              </div>
              <p className="summary-card-lede">제출 전 이미 운영되는 파이프라인.</p>
              <ul className="summary-card-list">
                <li>
                  • pytest <span className="tabular-nums" style={{ fontWeight: 700 }}>402</span>개 · smoke 경로 포함
                </li>
                <li>
                  • First Load JS <span className="tabular-nums" style={{ fontWeight: 700 }}>206</span> kB
                </li>
                <li>• 6 체인 상시 + 4 체인 카나리</li>
                <li>• Sheets L1 + Redis L2 dual-cache</li>
              </ul>
            </article>

            <article className="glass-card summary-card summary-card--sec">
              <div className="summary-card-head">
                <span className="material-symbols-outlined" aria-hidden="true">
                  target
                </span>
                <h3>지표</h3>
              </div>
              <p className="summary-card-lede">판단 가능한 서비스인지 수치로.</p>
              <ul className="summary-card-list">
                <li>
                  • Daily Brief 열람률 목표{" "}
                  <span className="tabular-nums" style={{ fontWeight: 700 }}>60%</span>
                </li>
                <li>
                  • Kill 기준 <span className="tabular-nums" style={{ fontWeight: 700 }}>30 / 10 / 30</span>
                </li>
                <li>• 비추적 KPI — 일일 발송 수량</li>
                <li>• Runtime $21 → $9 / month</li>
              </ul>
            </article>
          </div>
        </section>

        {/* ==================== Tab bar + panels (client-interactive) ==================== */}
        <AboutClient
          entries={manifest.entries}
          logCount={logCount}
          onePagerHtml={onePagerHtml}
          readmeHtml={readmeHtml}
        />

        {/* ==================== Footer ==================== */}
        <footer className="about-footer">
          <div className="glass-card about-footer-inner">
            <p className="about-footer-meta">
              <strong style={{ fontWeight: 700 }}>WhaleScope · /about</strong>
              <span className="small">
                문서 최종 갱신{" "}
                <time dateTime="2026-04-23" className="tabular-nums" style={{ fontWeight: 700 }}>
                  2026-04-23
                </time>{" "}
                · 빌드 <span className="tabular-nums" style={{ fontWeight: 700 }}>v0.9.3</span>
              </span>
              <span className="small">
                이 페이지의 원본 문서는 GitHub <code>ONE_PAGER.md</code> · <code>README.md</code>에서 확인할 수
                있습니다.
              </span>
            </p>
            <div className="about-footer-actions">
              <a
                href="/about/WhaleScope-Submission.pdf"
                className="btn-ghost"
                download
                rel="noopener"
              >
                <span className="material-symbols-outlined" aria-hidden="true" style={{ fontSize: 18 }}>
                  picture_as_pdf
                </span>
                PDF 내려받기
              </a>
              <a
                href="https://github.com/basilry/reuton_whale"
                rel="noopener"
                target="_blank"
                className="btn-ghost"
              >
                <span className="material-symbols-outlined" aria-hidden="true" style={{ fontSize: 18 }}>
                  code
                </span>
                GitHub
              </a>
              <a
                href="https://t.me/whalescope_alertz"
                rel="noopener"
                target="_blank"
                className="btn-primary"
              >
                <span className="material-symbols-outlined" aria-hidden="true" style={{ fontSize: 18 }}>
                  send
                </span>
                Telegram 구독
              </a>
            </div>
          </div>
        </footer>
      </main>
    </div>
  );
}
