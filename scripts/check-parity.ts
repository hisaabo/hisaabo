#!/usr/bin/env npx tsx
/**
 * Feature Parity Scanner
 *
 * Auto-detects tRPC usage across all platforms by scanning source code.
 * A small exceptions file (parity-exceptions.yaml) lists procedures that are
 * intentionally absent from specific platforms. Everything else is derived
 * from the source — no manual maintenance matrix required.
 *
 * Modes:
 *
 *   --scan
 *     Scan all platforms, compare against each other, apply exceptions, and
 *     report gaps. Exits 1 if any true gaps exist (web has a procedure that
 *     mobile does not, and it is not listed in parity-exceptions.yaml).
 *
 *   --validate
 *     Verify that every entry in parity-exceptions.yaml refers to a procedure
 *     that actually exists in the API, and that the platform assignment makes
 *     sense. Exits 1 on hard errors.
 *
 *   --changed <files...>
 *     Given a list of changed file paths (from a PR diff), check whether any
 *     new web procedures are absent from mobile and not in exceptions. Exits 1
 *     if true gaps are introduced.
 *
 *   --report
 *     Print a markdown summary of platform coverage.
 *
 * Usage:
 *   npx tsx scripts/check-parity.ts --scan
 *   npx tsx scripts/check-parity.ts --validate
 *   npx tsx scripts/check-parity.ts --changed apps/web/src/foo.tsx packages/api/src/routers/foo.ts
 *   npx tsx scripts/check-parity.ts --report
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Exceptions {
  schemaVersion: string;
  mobile: Set<string>;
  // Extend here when cli/mcp exceptions are needed.
}

// ---------------------------------------------------------------------------
// Exceptions file parser (minimal YAML, known structure)
// ---------------------------------------------------------------------------

function parseExceptions(filePath: string): Exceptions {
  const result: Exceptions = { schemaVersion: "2.0", mobile: new Set() };
  if (!fs.existsSync(filePath)) return result;

  const content = fs.readFileSync(filePath, "utf-8");
  let inMobileNotApplicable = false;
  let indentLevel = 0;

  for (const rawLine of content.split("\n")) {
    const line = rawLine.trimEnd();
    const trimmed = line.trim();

    if (trimmed === "" || trimmed.startsWith("#")) continue;

    if (trimmed.startsWith("schema_version:")) {
      result.schemaVersion = trimmed.split(":")[1].trim().replace(/["']/g, "");
      continue;
    }

    // Detect the "mobile:" key under "not-applicable:"
    if (trimmed === "not-applicable:") {
      inMobileNotApplicable = true;
      indentLevel = line.length - trimmed.length;
      continue;
    }

    if (inMobileNotApplicable) {
      const currentIndent = line.length - line.trimStart().length;
      if (trimmed.startsWith("- ") && currentIndent > indentLevel) {
        result.mobile.add(trimmed.slice(2).trim());
      } else if (!trimmed.startsWith("- ") && currentIndent <= indentLevel && trimmed !== "") {
        inMobileNotApplicable = false;
      }
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// tRPC usage scanner — trpc.router.procedure pattern (web / mobile / desktop)
// ---------------------------------------------------------------------------

function scanTrpcDotPattern(dir: string): Set<string> {
  const procedures = new Set<string>();
  if (!fs.existsSync(dir)) return procedures;

  function walk(d: string) {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) {
        if (["node_modules", ".next", "dist", ".expo", "android", "ios"].includes(entry.name)) continue;
        walk(full);
      } else if (/\.(tsx?|jsx?)$/.test(entry.name)) {
        const content = fs.readFileSync(full, "utf-8");
        for (const m of content.matchAll(/trpc\.(\w+)\.(\w+)\./g)) {
          procedures.add(`${m[1]}.${m[2]}`);
        }
      }
    }
  }

  walk(dir);
  return procedures;
}

// ---------------------------------------------------------------------------
// tRPC usage scanner — string-based pattern used by CLI and MCP clients
// Matches: .query("router.procedure") or .mutate("router.procedure")
// ---------------------------------------------------------------------------

function scanTrpcStringPattern(dir: string): Set<string> {
  const procedures = new Set<string>();
  if (!fs.existsSync(dir)) return procedures;

  function walk(d: string) {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) {
        if (["node_modules", "dist"].includes(entry.name)) continue;
        walk(full);
      } else if (/\.(tsx?|jsx?)$/.test(entry.name)) {
        const content = fs.readFileSync(full, "utf-8");
        // .query("router.procedure") / .query<T>("router.procedure") / .mutate(...)
        for (const m of content.matchAll(/\.(query|mutate)(?:<[^>]*>)?\(["'](\w+\.\w+)["']/g)) {
          procedures.add(m[2]);
        }
      }
    }
  }

  walk(dir);
  return procedures;
}

// ---------------------------------------------------------------------------
// API procedure extractor (unchanged from original — already works well)
// ---------------------------------------------------------------------------

function extractApiProcedures(): Map<string, string[]> {
  const routersDir = path.join(ROOT, "packages/api/src/routers");
  const routerFile = path.join(ROOT, "packages/api/src/router.ts");

  const routerContent = fs.readFileSync(routerFile, "utf-8");
  const namespaceMap = new Map<string, string>();
  for (const m of routerContent.matchAll(/(\w+):\s*(\w+Router)/g)) {
    namespaceMap.set(m[2], m[1]); // e.g. authRouter -> auth
  }

  const procedures = new Map<string, string[]>();

  // Collect all .ts files in a directory recursively
  function collectTsFiles(dir: string): string[] {
    const results: string[] = [];
    for (const entry of fs.readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (fs.statSync(full).isDirectory()) {
        results.push(...collectTsFiles(full));
      } else if (entry.endsWith(".ts")) {
        results.push(full);
      }
    }
    return results;
  }

  // Extract procedure names from file content — handles both styles:
  //   key: adminProcedure   (inline in router file)
  //   export const name = adminProcedure   (separate procedure file)
  function extractProcs(content: string): string[] {
    const procs: string[] = [];
    for (const m of content.matchAll(
      /^\s+(\w+):\s*(?:public|protected|tenant|viewer|member|admin)Procedure/gm
    )) {
      procs.push(m[1]);
    }
    for (const m of content.matchAll(
      /export const (\w+)\s*=\s*(?:public|protected|tenant|viewer|member|admin)Procedure/gm
    )) {
      procs.push(m[1]);
    }
    return procs;
  }

  for (const entry of fs.readdirSync(routersDir)) {
    const fullPath = path.join(routersDir, entry);

    // Directory-based router module (e.g. import/)
    if (fs.statSync(fullPath).isDirectory()) {
      const indexFile = path.join(fullPath, "index.ts");
      if (!fs.existsSync(indexFile)) continue;

      const indexContent = fs.readFileSync(indexFile, "utf-8");
      const exportMatch = indexContent.match(/export const (\w+Router)/);
      if (!exportMatch) continue;

      const namespace = namespaceMap.get(exportMatch[1]);
      if (!namespace) continue;

      // Scan all .ts files in the directory tree for procedure definitions
      const procs: string[] = [];
      for (const tsFile of collectTsFiles(fullPath)) {
        const content = fs.readFileSync(tsFile, "utf-8");
        procs.push(...extractProcs(content));
      }
      procedures.set(namespace, procs);
      continue;
    }

    if (!entry.endsWith(".ts")) continue;
    const content = fs.readFileSync(fullPath, "utf-8");

    const procs = extractProcs(content);

    if (entry === "document.ts") {
      const factoryProcs = ["list", "getById", "create", "updateStatus", "delete"];
      for (const m of [...content.matchAll(/export const (\w+Router)/g)]) {
        const routerName = m[1];
        const namespace = namespaceMap.get(routerName);
        if (!namespace) continue;
        procedures.set(namespace, namespace === "document" ? procs : [...factoryProcs]);
      }
      continue;
    }

    const exportMatch = content.match(/export const (\w+Router)/);
    if (exportMatch) {
      const namespace = namespaceMap.get(exportMatch[1]);
      if (namespace) {
        procedures.set(namespace, procs);
      }
    }
  }

  return procedures;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function allApiProcedureNames(apiProcs: Map<string, string[]>): Set<string> {
  const out = new Set<string>();
  for (const [ns, procs] of apiProcs) {
    for (const p of procs) out.add(`${ns}.${p}`);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Scan all platforms and return usage sets
// ---------------------------------------------------------------------------

interface PlatformUsage {
  web: Set<string>;
  mobile: Set<string>;
  cli: Set<string>;
  mcp: Set<string>;
}

function scanAllPlatforms(): PlatformUsage {
  return {
    web: scanTrpcDotPattern(path.join(ROOT, "apps/web/src")),
    mobile: scanTrpcDotPattern(path.join(ROOT, "apps/mobile")),
    cli: scanTrpcStringPattern(path.join(ROOT, "packages/cli/src")),
    mcp: scanTrpcStringPattern(path.join(ROOT, "packages/mcp/src")),
  };
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

function cmdScan() {
  console.log("=== tRPC Coverage Analysis ===\n");

  const usage = scanAllPlatforms();
  const exceptions = parseExceptions(path.join(ROOT, "parity-exceptions.yaml"));
  const apiProcs = extractApiProcedures();
  const allApi = allApiProcedureNames(apiProcs);

  // --- Web vs Mobile gap analysis ---
  const webOnly = [...usage.web].filter((p) => !usage.mobile.has(p)).sort();
  const mobileOnly = [...usage.mobile].filter((p) => !usage.web.has(p)).sort();
  const shared = [...usage.web].filter((p) => usage.mobile.has(p)).sort();

  const excluded = webOnly.filter((p) => exceptions.mobile.has(p));
  const trueGaps = webOnly.filter((p) => !exceptions.mobile.has(p));

  // --- Unimplemented (in API but used nowhere) ---
  const usedAnywhere = new Set([...usage.web, ...usage.mobile, ...usage.cli, ...usage.mcp]);
  const unimplemented = [...allApi].filter((p) => !usedAnywhere.has(p)).sort();

  // --- Print stats ---
  console.log("Platform procedure counts:");
  console.log(`  Web:    ${usage.web.size}`);
  console.log(`  Mobile: ${usage.mobile.size}`);
  console.log(`  CLI:    ${usage.cli.size === 0 ? "0 (package not present or no usage)" : usage.cli.size}`);
  console.log(`  MCP:    ${usage.mcp.size === 0 ? "0 (package not present or no usage)" : usage.mcp.size}`);
  console.log(`  API:    ${allApi.size} procedures defined`);
  console.log();

  console.log(`Web + Mobile shared: ${shared.length} procedures`);
  console.log();

  if (excluded.length > 0) {
    console.log(`--- Intentionally excluded from mobile (parity-exceptions.yaml): ${excluded.length} ---`);
    for (const p of excluded) console.log(`  [skip] ${p}`);
    console.log();
  }

  if (trueGaps.length > 0) {
    console.log(`--- TRUE PARITY GAPS (web has it, mobile does not, not in exceptions): ${trueGaps.length} ---`);
    for (const p of trueGaps) console.log(`  [GAP]  ${p}`);
    console.log();
  } else {
    console.log("--- True parity gaps: 0 (all web procedures are on mobile or in exceptions) ---\n");
  }

  if (mobileOnly.length > 0) {
    console.log(`--- Mobile-only (${mobileOnly.length}) ---`);
    for (const p of mobileOnly) console.log(`  [mob]  ${p}`);
    console.log();
  }

  if (usage.cli.size > 0) {
    const cliOnly = [...usage.cli].filter((p) => !usage.web.has(p) && !usage.mobile.has(p)).sort();
    if (cliOnly.length > 0) {
      console.log(`--- CLI-only (${cliOnly.length}) ---`);
      for (const p of cliOnly) console.log(`  [cli]  ${p}`);
      console.log();
    }
  }

  if (usage.mcp.size > 0) {
    const mcpOnly = [...usage.mcp].filter((p) => !usage.web.has(p) && !usage.mobile.has(p)).sort();
    if (mcpOnly.length > 0) {
      console.log(`--- MCP-only (${mcpOnly.length}) ---`);
      for (const p of mcpOnly) console.log(`  [mcp]  ${p}`);
      console.log();
    }
  }

  if (unimplemented.length > 0) {
    console.log(`--- Unimplemented (in API, used on no platform): ${unimplemented.length} ---`);
    for (const p of unimplemented) console.log(`  [api]  ${p}`);
    console.log();
  }

  // --- Parity percentages ---
  const totalUnique = new Set([...usage.web, ...usage.mobile]).size;
  const rawPct = totalUnique > 0 ? ((shared.length / totalUnique) * 100).toFixed(1) : "100.0";
  console.log(`Raw web/mobile parity: ${rawPct}% (${shared.length}/${totalUnique})`);

  const applicable = [...usage.web].filter((p) => !exceptions.mobile.has(p));
  const applicableShared = applicable.filter((p) => usage.mobile.has(p));
  const adjPct = applicable.length > 0
    ? ((applicableShared.length / applicable.length) * 100).toFixed(1)
    : "100.0";
  console.log(`Adjusted parity (excl. not-applicable): ${adjPct}% (${applicableShared.length}/${applicable.length})\n`);

  // Exit 1 when true gaps exist — CI should block.
  if (trueGaps.length > 0) {
    process.exitCode = 1;
  }
}

function cmdValidate() {
  console.log("=== Exceptions File Validation ===\n");

  const exceptionsPath = path.join(ROOT, "parity-exceptions.yaml");
  if (!fs.existsSync(exceptionsPath)) {
    console.error("ERROR: parity-exceptions.yaml not found at repo root");
    process.exitCode = 1;
    return;
  }

  const exceptions = parseExceptions(exceptionsPath);
  const apiProcs = extractApiProcedures();
  const allApi = allApiProcedureNames(apiProcs);

  let errors = 0;
  let warnings = 0;

  // 1. Every exception must reference a real API procedure.
  console.log("Checking that exceptions reference real API procedures...");
  for (const proc of exceptions.mobile) {
    if (!allApi.has(proc)) {
      console.log(`  ERROR: ${proc} is in parity-exceptions.yaml but does not exist in the API`);
      errors++;
    }
  }

  if (errors === 0) console.log("  All exceptions reference valid API procedures.");

  // 2. Scan web usage and check for stale exceptions (procedure no longer used on web).
  console.log("\nChecking for stale exceptions (procedure excluded but web no longer uses it)...");
  const webUsage = scanTrpcDotPattern(path.join(ROOT, "apps/web/src"));
  for (const proc of exceptions.mobile) {
    if (!webUsage.has(proc)) {
      console.log(`  WARNING: ${proc} is in exceptions but web does not use it — may be stale`);
      warnings++;
    }
  }
  if (warnings === 0) console.log("  No stale exceptions detected.");

  // 3. Check for procedures in API not used anywhere (informational).
  console.log("\nChecking for API procedures not used on any platform...");
  const usage = scanAllPlatforms();
  const usedAnywhere = new Set([...usage.web, ...usage.mobile, ...usage.cli, ...usage.mcp]);
  let unused = 0;
  for (const proc of allApi) {
    if (!usedAnywhere.has(proc)) {
      console.log(`  INFO: ${proc} is defined in API but used on no platform`);
      unused++;
    }
  }
  if (unused === 0) console.log("  All API procedures are used on at least one platform.");

  console.log(`\n--- Summary: ${exceptions.mobile.size} mobile exceptions, ${warnings} warnings, ${errors} errors ---`);

  if (errors > 0) process.exitCode = 1;
}

function cmdChanged(changedFiles: string[]) {
  console.log("=== Changed Files Parity Check ===\n");

  const touchesWeb = changedFiles.some((f) => f.startsWith("apps/web/"));
  const touchesMobile = changedFiles.some((f) => f.startsWith("apps/mobile/"));
  const touchesApi = changedFiles.some((f) => f.includes("packages/api/src/routers/"));
  const touchesExceptions = changedFiles.some((f) => f.includes("parity-exceptions.yaml"));

  if (!touchesWeb && !touchesApi) {
    console.log("No web or API files changed — skipping parity check.");
    return;
  }

  const exceptions = parseExceptions(path.join(ROOT, "parity-exceptions.yaml"));
  const webUsage = scanTrpcDotPattern(path.join(ROOT, "apps/web/src"));
  const mobileUsage = scanTrpcDotPattern(path.join(ROOT, "apps/mobile"));

  const trueGaps = [...webUsage]
    .filter((p) => !mobileUsage.has(p) && !exceptions.mobile.has(p))
    .sort();

  if (touchesApi && !touchesExceptions && !touchesMobile) {
    console.log(
      "NOTE: API routers changed but parity-exceptions.yaml was not updated.\n" +
      "      If you added a new procedure that is intentionally desktop-only, add it to parity-exceptions.yaml."
    );
    console.log();
  }

  if (trueGaps.length === 0) {
    console.log("No parity gaps detected — web and mobile are in sync (or all gaps are in exceptions).");
  } else {
    console.log(`TRUE PARITY GAPS (${trueGaps.length}) — web has these procedures, mobile does not:\n`);
    for (const p of trueGaps) console.log(`  [GAP] ${p}`);
    console.log(
      "\nFor each gap, either:\n" +
      "  a) implement it on mobile, or\n" +
      "  b) add it to parity-exceptions.yaml with a justification comment."
    );
    process.exitCode = 1;
  }

  console.log(`\n${trueGaps.length} gap(s) found`);
}

function cmdReport() {
  const usage = scanAllPlatforms();
  const exceptions = parseExceptions(path.join(ROOT, "parity-exceptions.yaml"));
  const apiProcs = extractApiProcedures();
  const allApi = allApiProcedureNames(apiProcs);

  const shared = [...usage.web].filter((p) => usage.mobile.has(p));
  const trueGaps = [...usage.web]
    .filter((p) => !usage.mobile.has(p) && !exceptions.mobile.has(p))
    .sort();
  const excluded = [...usage.web]
    .filter((p) => !usage.mobile.has(p) && exceptions.mobile.has(p))
    .sort();
  const usedAnywhere = new Set([...usage.web, ...usage.mobile, ...usage.cli, ...usage.mcp]);
  const unimplemented = [...allApi].filter((p) => !usedAnywhere.has(p)).sort();

  const applicable = [...usage.web].filter((p) => !exceptions.mobile.has(p));
  const applicableShared = applicable.filter((p) => usage.mobile.has(p));
  const adjPct = applicable.length > 0
    ? ((applicableShared.length / applicable.length) * 100).toFixed(1)
    : "100.0";

  const lines: string[] = [];
  lines.push("# Feature Parity Report");
  lines.push("");
  lines.push(`Generated: ${new Date().toISOString().split("T")[0]}`);
  lines.push("");
  lines.push("## Platform Coverage");
  lines.push("");
  lines.push("| Platform | Procedures Used | Notes |");
  lines.push("|----------|----------------|-------|");
  lines.push(`| Web      | ${usage.web.size} | auto-detected from apps/web/src |`);
  lines.push(`| Mobile   | ${usage.mobile.size} | auto-detected from apps/mobile |`);
  lines.push(`| CLI      | ${usage.cli.size} | auto-detected from packages/cli/src |`);
  lines.push(`| MCP      | ${usage.mcp.size} | auto-detected from packages/mcp/src |`);
  lines.push(`| API      | ${allApi.size} | total procedures defined |`);
  lines.push("");
  lines.push("## Web / Mobile Parity");
  lines.push("");
  lines.push(`- **Shared**: ${shared.length} procedures`);
  lines.push(`- **Adjusted parity**: ${adjPct}% (${applicableShared.length}/${applicable.length} applicable procedures)`);
  lines.push(`- **Excluded (not-applicable)**: ${excluded.length} procedures`);
  lines.push(`- **True gaps**: ${trueGaps.length} procedures`);
  lines.push(`- **Unimplemented** (in API, used nowhere): ${unimplemented.length} procedures`);
  lines.push("");

  if (trueGaps.length > 0) {
    lines.push("## True Parity Gaps");
    lines.push("");
    lines.push("Web has these procedures; mobile does not and they are not in exceptions:");
    lines.push("");
    for (const p of trueGaps) lines.push(`- \`${p}\``);
    lines.push("");
  }

  if (excluded.length > 0) {
    lines.push("## Intentional Exclusions (mobile)");
    lines.push("");
    for (const p of excluded) lines.push(`- \`${p}\``);
    lines.push("");
  }

  if (unimplemented.length > 0) {
    lines.push("## Unimplemented API Procedures");
    lines.push("");
    lines.push("Defined in API but not used on any platform:");
    lines.push("");
    for (const p of unimplemented) lines.push(`- \`${p}\``);
    lines.push("");
  }

  console.log(lines.join("\n"));
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const command = args[0];

switch (command) {
  case "--scan":
    cmdScan();
    break;
  case "--validate":
    cmdValidate();
    break;
  case "--changed":
    cmdChanged(args.slice(1));
    break;
  case "--report":
    cmdReport();
    break;
  default:
    console.log(`Usage:
  npx tsx scripts/check-parity.ts --scan                       Auto-scan all platforms, report gaps (exits 1 if gaps found)
  npx tsx scripts/check-parity.ts --validate                   Validate parity-exceptions.yaml against API
  npx tsx scripts/check-parity.ts --changed <files...>         Check changed files for new parity gaps (exits 1 if gaps found)
  npx tsx scripts/check-parity.ts --report                     Generate markdown parity report
`);
    break;
}
