/**
 * Validates that docs pages covering features available on both web AND mobile
 * contain ForDesktop / ForMobile content blocks.
 *
 * Pages are classified into three tiers:
 *   - dual-platform: MUST have both ForDesktop and ForMobile sections
 *   - web-only:      Must NOT import ForMobile (content is desktop/web only)
 *   - shared:        Platform-agnostic reference — no blocks expected
 *
 * Run: pnpm --filter @hisaabo/docs check:platform
 */

import { readFileSync, readdirSync, statSync } from "fs";
import { join, relative, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = typeof import.meta.dirname === "string"
  ? import.meta.dirname
  : dirname(fileURLToPath(import.meta.url));

// ── Page classification ──────────────────────────────────────────
// Paths are relative to src/content/docs/

const WEB_ONLY: Set<string> = new Set([
  // Self-hosting and infrastructure
  "getting-started/self-hosting.mdx",
  "self-hosting/index.mdx",

  // Data import (bulk CSV — desktop workflow)
  "getting-started/import-data.mdx",

  // Reports (desktop-only analytics)
  "reports/index.mdx",

  // GST compliance (desktop-only)
  "gst/index.mdx",
  "gst/gstr1.mdx",

  // Online store admin (desktop-only)
  "online-store/index.mdx",

  // AI & automation (developer tooling)
  "ai/index.mdx",
  "ai/mcp-server.mdx",
  "ai/cli.mdx",
  "ai/integrations.mdx",

  // Keyboard shortcuts (desktop-only by definition)
  "reference/keyboard-shortcuts.mdx",
]);

const SHARED: Set<string> = new Set([
  // Landing / splash page
  "index.mdx",

  // Overview pages that are mostly conceptual
  "getting-started/index.mdx",

  // Reference data (platform-agnostic)
  "reference/supported-units.mdx",

  // Conceptual guides where content is identical across platforms
  "invoicing/gst-on-invoices.mdx",
  "invoicing/invoice-statuses.mdx",
]);

// Everything else is dual-platform.

// ── File discovery ───────────────────────────────────────────────

const DOCS_ROOT = join(__dirname, "..", "src", "content", "docs");

function walk(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      results.push(...walk(full));
    } else if (entry.endsWith(".mdx")) {
      results.push(full);
    }
  }
  return results;
}

// ── Check ────────────────────────────────────────────────────────

interface Issue {
  file: string;
  tier: "dual-platform" | "web-only" | "shared";
  message: string;
}

const issues: Issue[] = [];
const allFiles = walk(DOCS_ROOT);

for (const file of allFiles) {
  const rel = relative(DOCS_ROOT, file);
  const content = readFileSync(file, "utf-8");

  const hasDesktop =
    content.includes("ForDesktop") || content.includes("platform-desktop");
  const hasMobile =
    content.includes("ForMobile") || content.includes("platform-mobile");

  if (WEB_ONLY.has(rel)) {
    // Web-only pages must NOT have ForMobile blocks
    if (hasMobile) {
      issues.push({
        file: rel,
        tier: "web-only",
        message:
          "Page is classified web-only but contains ForMobile content. Either remove the mobile block or reclassify the page.",
      });
    }
    continue;
  }

  if (SHARED.has(rel)) {
    // Shared pages shouldn't have platform blocks (no harm, but unusual)
    if (hasDesktop || hasMobile) {
      issues.push({
        file: rel,
        tier: "shared",
        message:
          "Page is classified as shared/platform-agnostic but contains platform-specific blocks. Consider reclassifying to dual-platform.",
      });
    }
    continue;
  }

  // Dual-platform pages MUST have both
  if (!hasDesktop && !hasMobile) {
    issues.push({
      file: rel,
      tier: "dual-platform",
      message:
        "Missing both ForDesktop and ForMobile sections. This page covers a feature available on both platforms — add platform-specific guidance.",
    });
  } else if (hasDesktop && !hasMobile) {
    issues.push({
      file: rel,
      tier: "dual-platform",
      message:
        "Has ForDesktop but missing ForMobile. Every desktop block should have a mobile counterpart.",
    });
  } else if (!hasDesktop && hasMobile) {
    issues.push({
      file: rel,
      tier: "dual-platform",
      message:
        "Has ForMobile but missing ForDesktop. Every mobile block should have a desktop counterpart.",
    });
  }
}

// ── Report ───────────────────────────────────────────────────────

const dualPlatformTotal = allFiles.filter((f) => {
  const rel = relative(DOCS_ROOT, f);
  return !WEB_ONLY.has(rel) && !SHARED.has(rel);
}).length;

const covered = allFiles.filter((f) => {
  const rel = relative(DOCS_ROOT, f);
  if (WEB_ONLY.has(rel) || SHARED.has(rel)) return false;
  const content = readFileSync(f, "utf-8");
  return (
    (content.includes("ForDesktop") || content.includes("platform-desktop")) &&
    (content.includes("ForMobile") || content.includes("platform-mobile"))
  );
}).length;

console.log("\n=== Platform Coverage Report ===\n");
console.log(
  `Total pages: ${allFiles.length}  |  Web-only: ${WEB_ONLY.size}  |  Shared: ${SHARED.size}  |  Dual-platform: ${dualPlatformTotal}`
);
console.log(
  `Dual-platform coverage: ${covered}/${dualPlatformTotal} (${Math.round((covered / dualPlatformTotal) * 100)}%)\n`
);

if (issues.length === 0) {
  console.log("All pages pass platform coverage checks.\n");
  process.exit(0);
} else {
  console.log(`Found ${issues.length} issue(s):\n`);
  for (const issue of issues) {
    const icon = issue.tier === "dual-platform" ? "MISSING" : "WARNING";
    console.log(`  [${icon}] ${issue.file}`);
    console.log(`          ${issue.message}\n`);
  }
  // Exit non-zero only for missing dual-platform coverage
  const blocking = issues.filter((i) => i.tier === "dual-platform");
  if (blocking.length > 0) {
    console.log(
      `${blocking.length} dual-platform page(s) need attention.\n`
    );
    process.exit(1);
  }
}
