/**
 * Server-only markdown rendering for the /about page.
 *
 * Shared by:
 *   - app/about/page.tsx (pre-renders ONE_PAGER/README at request time)
 *   - app/api/about/doc/route.ts (renders Obsidian log entries on demand)
 *
 * All HTML is sanitized (script/iframe/on* stripped); no raw
 * markdown ever reaches the client. Heading IDs are assigned here so the
 * in-page TOC scroll-spy can find them consistently.
 */

import "server-only";

import fs from "node:fs/promises";
import path from "node:path";
import { marked } from "marked";

// `next dev` / `next build` run with cwd = apps/dashboard. Resolve repo root once.
export const REPO_ROOT = path.resolve(process.cwd(), "..", "..");
export const OBSIDIAN_DIR = path.join(REPO_ROOT, "docs", "obsidian");
// 설계 문서(DESIGN.md, .design-context.md)의 단일 출처. 복사 없이 직접 읽어 /about에 노출한다.
export const DASHBOARD_DIR = path.join(REPO_ROOT, "apps", "dashboard");

const FRONTMATTER_RE = /^---\r?\n[\s\S]*?\r?\n---\r?\n/;

export function stripFrontmatter(text: string): string {
  return text.replace(FRONTMATTER_RE, "");
}

/** Unicode-friendly slug — preserves Korean, strips punctuation. */
export function slugify(text: string): string {
  return String(text)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^\p{L}\p{N}\-]+/gu, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Inject deduplicated slug IDs on <h2>/<h3> elements (skip if `id=` present). */
export function assignHeadingIds(html: string): string {
  const seen = new Set<string>();
  return html.replace(
    /<(h[23])([^>]*)>([\s\S]*?)<\/\1>/g,
    (match, tag: string, attrs: string, inner: string) => {
      if (/\bid=/i.test(attrs)) return match;
      const textOnly = inner.replace(/<[^>]*>/g, "");
      const base = slugify(textOnly) || "section";
      let id = base;
      let n = 2;
      while (seen.has(id)) id = `${base}-${n++}`;
      seen.add(id);
      return `<${tag}${attrs} id="${id}">${inner}</${tag}>`;
    },
  );
}

/** Add target/rel to external http(s) links so external nav is safe + opens in new tab. */
export function hardenExternalLinks(html: string): string {
  return html.replace(
    /<a\s+([^>]*\bhref="https?:\/\/[^"]+"[^>]*)>/gi,
    (_match, attrs: string) => {
      const hasTarget = /\btarget=/i.test(attrs);
      const hasRel = /\brel=/i.test(attrs);
      const add =
        (hasTarget ? "" : ' target="_blank"') + (hasRel ? "" : ' rel="noopener noreferrer"');
      return `<a ${attrs}${add}>`;
    },
  );
}

/**
 * Strip dangerous tags/attributes from HTML rendered from trusted committed files.
 * isomorphic-dompurify was removed: it pulls jsdom → html-encoding-sniffer →
 * @exodus/bytes (ESM-only) which crashes the Vercel CJS runtime.
 */
function stripDangerous(html: string): string {
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "")
    .replace(/<(iframe|object|embed)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/\bon\w+\s*=/gi, "data-removed=")
    .replace(/\bjavascript:/gi, "nojs:");
}

/** Render a markdown string to sanitized HTML with heading IDs. */
export function renderMarkdown(markdown: string): string {
  const body = stripFrontmatter(markdown);
  marked.setOptions({ gfm: true, breaks: false });
  const rawHtml = marked.parse(body, { async: false }) as string;
  return hardenExternalLinks(assignHeadingIds(stripDangerous(rawHtml)));
}

/** Read a markdown file from disk and render it. Returns an empty fragment on failure. */
export async function readAndRender(absolutePath: string): Promise<string> {
  try {
    const raw = await fs.readFile(absolutePath, "utf8");
    return renderMarkdown(raw);
  } catch {
    return "";
  }
}
