// scripts/design-check.mjs
// Puppeteer 기반 자동 디자인 점검.
// Usage:
//   NODE_PATH=$(npm root -g) node scripts/design-check.mjs <baseUrl> [pathsCsv]
// Example:
//   NODE_PATH=$(npm root -g) node scripts/design-check.mjs https://whalescope.6esk.com / /admin /insights /preview

import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// ESM은 NODE_PATH를 무시하므로, 전역 설치된 puppeteer를 CJS로 로드한다.
const require = createRequire(import.meta.url);
const puppeteer = require("puppeteer");

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");

const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900, isMobile: false, deviceScaleFactor: 1 },
  { name: "mobile", width: 393, height: 852, isMobile: true, deviceScaleFactor: 2 },
];

const WAIT_AFTER_LOAD_MS = 3500;

function parseArgs(argv) {
  const args = argv.slice(2);
  if (args.length === 0) {
    throw new Error("baseUrl is required. Usage: node scripts/design-check.mjs <baseUrl> [paths]");
  }
  const baseUrl = args[0].replace(/\/$/, "");
  const pathTokens = args.slice(1).length > 0 ? args.slice(1) : null;
  const paths =
    pathTokens == null
      ? ["/"]
      : pathTokens
          .flatMap((token) => token.split(","))
          .map((p) => p.trim())
          .filter(Boolean)
          .map((p) => (p.startsWith("/") ? p : `/${p}`));
  return { baseUrl, paths };
}

function stamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}-${pad(d.getMinutes())}`;
}

function sanitizePath(path) {
  if (path === "/") return "root";
  return path.replace(/^\//, "").replace(/[\/]+/g, "_") || "root";
}

async function auditPage(page, viewport) {
  const result = await page.evaluate((vw) => {
    const doc = document.documentElement;
    const scrollWidth = doc.scrollWidth;
    const scrollHeight = doc.scrollHeight;
    const clientWidth = doc.clientWidth;
    const clientHeight = doc.clientHeight;

    const hasHorizontalScroll = scrollWidth > clientWidth + 10;
    const emptyBody = document.body.scrollHeight < 100;

    const overflowers = [];
    const viewportW = clientWidth;
    const all = document.querySelectorAll("body *");
    for (const el of all) {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      if (rect.right > viewportW + 1) {
        const tag = el.tagName.toLowerCase();
        const cls = typeof el.className === "string" ? el.className : "";
        const id = el.id || "";
        overflowers.push({
          tag,
          id,
          className: cls.slice(0, 120),
          right: Math.round(rect.right),
          width: Math.round(rect.width),
          text: (el.innerText || "").slice(0, 60),
        });
      }
      if (overflowers.length >= 5) break;
    }

    const smallTouchTargets = [];
    if (vw.isMobile) {
      const interactive = document.querySelectorAll("button, a, input, [role='button']");
      for (const el of interactive) {
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue;
        const min = Math.min(rect.width, rect.height);
        if (min < 44) {
          smallTouchTargets.push({
            tag: el.tagName.toLowerCase(),
            id: el.id || "",
            className: (typeof el.className === "string" ? el.className : "").slice(0, 120),
            size: `${Math.round(rect.width)}x${Math.round(rect.height)}`,
            text: (el.innerText || "").slice(0, 40),
          });
        }
        if (smallTouchTargets.length >= 3) break;
      }
    }

    const tinyText = [];
    if (vw.isMobile) {
      const texts = document.querySelectorAll("body p, body span, body li, body a, body button, body div");
      let scanned = 0;
      for (const el of texts) {
        if (scanned > 4000) break;
        scanned += 1;
        const style = window.getComputedStyle(el);
        const fontSize = parseFloat(style.fontSize);
        if (Number.isFinite(fontSize) && fontSize > 0 && fontSize < 11) {
          const innerText = (el.innerText || "").trim();
          if (innerText.length > 0) {
            tinyText.push({
              tag: el.tagName.toLowerCase(),
              className: (typeof el.className === "string" ? el.className : "").slice(0, 100),
              fontSize,
              text: innerText.slice(0, 40),
            });
          }
        }
        if (tinyText.length >= 5) break;
      }
    }

    return {
      scrollWidth,
      scrollHeight,
      clientWidth,
      clientHeight,
      hasHorizontalScroll,
      emptyBody,
      overflowers,
      smallTouchTargets,
      tinyText,
    };
  }, viewport);
  return result;
}

async function checkPage({ browser, baseUrl, path, viewport, outDir }) {
  const page = await browser.newPage();
  const url = `${baseUrl}${path}`;
  const consoleErrors = [];
  page.on("pageerror", (error) => {
    consoleErrors.push({ kind: "pageerror", message: String(error.message ?? error).slice(0, 300) });
  });
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      consoleErrors.push({ kind: "console_error", message: msg.text().slice(0, 300) });
    }
  });

  await page.setViewport({
    width: viewport.width,
    height: viewport.height,
    isMobile: viewport.isMobile,
    deviceScaleFactor: viewport.deviceScaleFactor,
  });

  let status = 0;
  let loadError = null;
  try {
    const response = await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });
    status = response?.status() ?? 0;
  } catch (error) {
    loadError = String(error instanceof Error ? error.message : error);
  }

  if (!loadError) {
    await page.waitForFunction(() => document.readyState === "complete").catch(() => {});
    await new Promise((resolve) => setTimeout(resolve, WAIT_AFTER_LOAD_MS));
  }

  const screenshotName = `${viewport.name}_${sanitizePath(path)}.png`;
  const screenshotPath = join(outDir, screenshotName);

  let audit = null;
  if (!loadError) {
    try {
      audit = await auditPage(page, viewport);
    } catch (error) {
      audit = { auditError: String(error instanceof Error ? error.message : error) };
    }
    try {
      await page.screenshot({ path: screenshotPath, fullPage: true });
    } catch (error) {
      audit = audit || {};
      audit.screenshotError = String(error instanceof Error ? error.message : error);
    }
  }

  await page.close();

  return {
    path,
    url,
    viewport: viewport.name,
    status,
    loadError,
    screenshot: loadError ? null : screenshotName,
    audit,
    consoleErrors: consoleErrors.slice(0, 10),
  };
}

function summarizeResult(r) {
  if (r.loadError) {
    return { icon: "🔴", issues: [`load failed: ${r.loadError}`] };
  }
  const issues = [];
  if (r.status >= 400) issues.push(`HTTP ${r.status}`);
  if (!r.audit) {
    issues.push("no audit");
  } else {
    if (r.audit.emptyBody) issues.push("empty body (no content rendered)");
    if (r.audit.hasHorizontalScroll) issues.push(`horizontal scroll (scrollWidth=${r.audit.scrollWidth})`);
    if (r.audit.overflowers?.length) issues.push(`${r.audit.overflowers.length} overflowing element(s)`);
    if (r.audit.smallTouchTargets?.length) issues.push(`${r.audit.smallTouchTargets.length} small touch target(s)`);
    if (r.audit.tinyText?.length) issues.push(`${r.audit.tinyText.length} tiny text(s) (<11px)`);
  }
  if (r.consoleErrors?.length) issues.push(`${r.consoleErrors.length} console error(s)`);
  const icon = issues.length === 0 ? "✅" : issues.some((m) => /fail|empty|HTTP [45]/.test(m)) ? "🔴" : "🟡";
  return { icon, issues };
}

function buildMarkdown({ baseUrl, generatedAt, results }) {
  const rowsByPath = new Map();
  for (const r of results) {
    const key = r.path;
    if (!rowsByPath.has(key)) rowsByPath.set(key, { path: key, desktop: null, mobile: null });
    const entry = rowsByPath.get(key);
    entry[r.viewport] = r;
  }

  const tableRows = [];
  for (const [path, entry] of rowsByPath) {
    const d = entry.desktop ? summarizeResult(entry.desktop) : null;
    const m = entry.mobile ? summarizeResult(entry.mobile) : null;
    const issueCount = (d?.issues?.length ?? 0) + (m?.issues?.length ?? 0);
    tableRows.push({ path, d, m, issueCount });
  }

  const header = `# 디자인 점검 리포트\n\n- 점검일: ${generatedAt}\n- 대상: ${baseUrl}\n- 뷰포트: 데스크탑(1440×900) + 모바일(393×852)\n\n## 요약\n\n| 페이지 | 데스크탑 | 모바일 | 이슈 수 |\n|---|---|---|---|\n`;

  const summary = tableRows
    .map((row) => `| ${row.path} | ${row.d?.icon ?? "-"} | ${row.m?.icon ?? "-"} | ${row.issueCount} |`)
    .join("\n");

  let details = "\n\n## 상세\n";
  for (const r of results) {
    const { icon, issues } = summarizeResult(r);
    details += `\n### ${icon} \`${r.path}\` — ${r.viewport}\n`;
    details += `- URL: ${r.url}\n`;
    details += `- HTTP: ${r.status}${r.loadError ? ` (load error: ${r.loadError})` : ""}\n`;
    if (r.screenshot) details += `- Screenshot: \`${r.screenshot}\`\n`;
    if (issues.length) {
      details += `- Issues:\n`;
      for (const issue of issues) details += `  - ${issue}\n`;
    }
    if (r.audit?.overflowers?.length) {
      details += `- Overflowers:\n`;
      for (const o of r.audit.overflowers) {
        details += `  - \`${o.tag}\` ${o.className ? `.${o.className.split(/\s+/).slice(0, 2).join(".")}` : ""} right=${o.right} width=${o.width} text="${(o.text || "").replace(/\s+/g, " ").slice(0, 60)}"\n`;
      }
    }
    if (r.audit?.smallTouchTargets?.length) {
      details += `- Small touch targets:\n`;
      for (const t of r.audit.smallTouchTargets) {
        details += `  - \`${t.tag}\` size=${t.size} text="${(t.text || "").slice(0, 40)}"\n`;
      }
    }
    if (r.audit?.tinyText?.length) {
      details += `- Tiny text(<11px):\n`;
      for (const t of r.audit.tinyText) {
        details += `  - \`${t.tag}\` fontSize=${t.fontSize}px text="${(t.text || "").slice(0, 40)}"\n`;
      }
    }
    if (r.consoleErrors?.length) {
      details += `- Console errors (top ${r.consoleErrors.length}):\n`;
      for (const e of r.consoleErrors) {
        details += `  - [${e.kind}] ${e.message.replace(/\s+/g, " ").slice(0, 200)}\n`;
      }
    }
  }

  return `${header}${summary}${details}\n`;
}

async function main() {
  const { baseUrl, paths } = parseArgs(process.argv);
  const runStamp = stamp();
  const outDir = join(repoRoot, "design-check-results", runStamp);
  await mkdir(outDir, { recursive: true });

  console.log(`[design-check] base=${baseUrl} paths=${paths.join(",")}`);
  console.log(`[design-check] out=${outDir}`);

  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
  });

  const results = [];
  for (const viewport of VIEWPORTS) {
    for (const path of paths) {
      console.log(`[design-check] ${viewport.name} ${path}`);
      try {
        const r = await checkPage({ browser, baseUrl, path, viewport, outDir });
        results.push(r);
      } catch (error) {
        const message = String(error instanceof Error ? error.message : error);
        console.warn(`[design-check] error: ${message}`);
        results.push({
          path,
          url: `${baseUrl}${path}`,
          viewport: viewport.name,
          status: 0,
          loadError: message,
          screenshot: null,
          audit: null,
          consoleErrors: [],
        });
      }
    }
  }

  await browser.close();

  const report = {
    generatedAt: new Date().toISOString(),
    baseUrl,
    paths,
    results,
  };

  await writeFile(join(outDir, "report.json"), JSON.stringify(report, null, 2), "utf8");
  const md = buildMarkdown({ baseUrl, generatedAt: report.generatedAt, results });
  await writeFile(join(outDir, "report.md"), md, "utf8");

  console.log(`[design-check] done. report=${join(outDir, "report.md")}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
