/**
 * GET /api/about/doc?src=<key>
 *
 * Returns a sanitized HTML fragment for a whitelisted markdown source.
 *   - "onepager"              → <repo>/ONE_PAGER.md
 *   - "readme"                → <repo>/README.md
 *   - "log/<filename.md>"     → <repo>/docs/obsidian/<filename.md>
 *   - "dashboard/<filename>"  → <repo>/apps/dashboard/<filename>  (DESIGN 문서만)
 *
 * Path-traversal defense:
 *   - Log filename must match /^[\p{L}\p{N}_\-. ()]+\.md$/u (no slashes, no ..)
 *   - Dashboard source는 명시 화이트리스트(set)로만 허용
 *   - 어떤 경로든 resolve된 절대경로가 허용 디렉토리 밖이면 거부
 *
 * Output: { html, label, slug } with no-store cache headers.
 */

import { NextResponse, type NextRequest } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import { renderMarkdown, REPO_ROOT, OBSIDIAN_DIR, DASHBOARD_DIR } from "@/lib/about/markdown";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Unicode-aware: Obsidian log filenames may contain Korean (e.g. "진행내역").
// `\w` is ASCII-only, so we use \p{L}\p{N} plus an explicit safe-char set.
// Path-traversal is additionally guarded below via path.resolve + path.relative.
const LOG_FILENAME_RE = /^[\p{L}\p{N}_\-. ()]+\.md$/u;

// apps/dashboard 루트에서 노출 가능한 설계 문서만 명시적으로 나열.
// 디렉토리 전체 공개 금지 — /about 용도로 꺼내올 파일을 여기 추가할 때만 늘린다.
const DASHBOARD_ALLOWLIST = new Set<string>([
  "DESIGN.md",
  ".design-context.md",
]);

type ResolvedSource = {
  absolutePath: string;
  label: string;
  slug: string;
};

function resolveSource(src: string | null): ResolvedSource | { error: string; status: number } {
  if (!src || typeof src !== "string") {
    return { error: "Missing ?src parameter", status: 400 };
  }

  if (src === "onepager") {
    return {
      absolutePath: path.join(REPO_ROOT, "ONE_PAGER.md"),
      label: "ONE_PAGER.md",
      slug: "onepager",
    };
  }

  if (src === "readme") {
    return {
      absolutePath: path.join(REPO_ROOT, "README.md"),
      label: "README.md",
      slug: "readme",
    };
  }

  if (src.startsWith("log/")) {
    const filename = src.slice("log/".length);
    if (!LOG_FILENAME_RE.test(filename)) {
      return { error: "Invalid log filename", status: 400 };
    }
    const abs = path.resolve(OBSIDIAN_DIR, filename);
    const rel = path.relative(OBSIDIAN_DIR, abs);
    if (rel.startsWith("..") || path.isAbsolute(rel)) {
      return { error: "Path traversal rejected", status: 400 };
    }
    return {
      absolutePath: abs,
      label: filename,
      slug: filename.replace(/\.md$/, ""),
    };
  }

  if (src.startsWith("dashboard/")) {
    const filename = src.slice("dashboard/".length);
    // 명시 화이트리스트에 없으면 거부 — apps/dashboard 전체 노출 방지.
    if (!DASHBOARD_ALLOWLIST.has(filename)) {
      return { error: "Unknown dashboard document", status: 400 };
    }
    const abs = path.resolve(DASHBOARD_DIR, filename);
    const rel = path.relative(DASHBOARD_DIR, abs);
    if (rel.startsWith("..") || path.isAbsolute(rel)) {
      return { error: "Path traversal rejected", status: 400 };
    }
    return {
      absolutePath: abs,
      label: filename,
      // 슬러그 생성: leading dot·확장자 제거, 'design-context' 등으로 안정화.
      slug: filename.replace(/^\./, "").replace(/\.md$/, ""),
    };
  }

  return { error: "Unknown source", status: 400 };
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const src = req.nextUrl.searchParams.get("src");
  const resolved = resolveSource(src);
  if ("error" in resolved) {
    return NextResponse.json({ error: resolved.error }, { status: resolved.status });
  }

  let raw: string;
  try {
    raw = await fs.readFile(resolved.absolutePath, "utf8");
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    return NextResponse.json(
      { error: `Failed to read ${resolved.label}`, detail: message },
      { status: 404 },
    );
  }

  const html = renderMarkdown(raw);

  return NextResponse.json(
    { html, label: resolved.label, slug: resolved.slug },
    { headers: { "Cache-Control": "public, max-age=0, must-revalidate" } },
  );
}
