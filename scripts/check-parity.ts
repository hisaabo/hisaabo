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

type Platform = "mobile" | "cli" | "mcp";

interface Exceptions {
  schemaVersion: string;
  mobile: Set<string>;
  cli: Set<string>;
  mcp: Set<string>;
}

// ---------------------------------------------------------------------------
// Exceptions file parser (minimal YAML, known structure)
// ---------------------------------------------------------------------------

const PLATFORMS: Platform[] = ["mobile", "cli", "mcp"];

function parseExceptions(filePath: string): Exceptions {
  const result: Exceptions = { schemaVersion: "2.0", mobile: new Set(), cli: new Set(), mcp: new Set() };
  if (!fs.existsSync(filePath)) return result;

  const content = fs.readFileSync(filePath, "utf-8");
  let currentPlatform: Platform | null = null;
  let inNotApplicable = false;
  let notApplicableIndent = 0;

  for (const rawLine of content.split("\n")) {
    const line = rawLine.trimEnd();
    const trimmed = line.trim();

    if (trimmed === "" || trimmed.startsWith("#")) continue;

    if (trimmed.startsWith("schema_version:")) {
      result.schemaVersion = trimmed.split(":")[1].trim().replace(/["']/g, "");
      continue;
    }

    // Detect platform key (e.g. "mobile:", "cli:", "mcp:")
    const platformMatch = trimmed.match(/^(mobile|cli|mcp):$/);
    if (platformMatch) {
      currentPlatform = platformMatch[1] as Platform;
      inNotApplicable = false;
      continue;
    }

    // Detect "not-applicable:" under a platform
    if (trimmed === "not-applicable:" && currentPlatform) {
      inNotApplicable = true;
      notApplicableIndent = line.length - trimmed.length;
      continue;
    }

    // Read list items under not-applicable
    if (inNotApplicable && currentPlatform) {
      const currentIndent = line.length - line.trimStart().length;
      if (trimmed.startsWith("- ") && currentIndent > notApplicableIndent) {
        result[currentPlatform].add(trimmed.slice(2).trim());
      } else if (!trimmed.startsWith("- ") && currentIndent <= notApplicableIndent && trimmed !== "") {
        inNotApplicable = false;
        // Check if this is a new platform key
        const pm = trimmed.match(/^(mobile|cli|mcp):$/);
        if (pm) {
          currentPlatform = pm[1] as Platform;
        } else if (trimmed === "exceptions:") {
          currentPlatform = null;
        }
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
        // Use [^(]* instead of generic matching to handle nested generics like PaginatedResult<T>
        for (const m of content.matchAll(/\.(query|mutate)[^(]*\(["'](\w+\.\w+)["']/g)) {
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
      for (const m of content.matchAll(/export const (\w+Router)/g)) {
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

interface PlatformGapResult {
  platform: Platform;
  label: string;
  shared: string[];
  excluded: string[];
  trueGaps: string[];
  platformOnly: string[];
  applicable: string[];
  applicableShared: string[];
}

function analyzePlatformGap(
  webUsage: Set<string>,
  platformUsage: Set<string>,
  platformExceptions: Set<string>,
  platform: Platform,
  label: string,
): PlatformGapResult {
  const webOnly = [...webUsage].filter((p) => !platformUsage.has(p)).sort();
  const shared = [...webUsage].filter((p) => platformUsage.has(p)).sort();
  const excluded = webOnly.filter((p) => platformExceptions.has(p));
  const trueGaps = webOnly.filter((p) => !platformExceptions.has(p));
  const platformOnly = [...platformUsage].filter((p) => !webUsage.has(p)).sort();
  const applicable = [...webUsage].filter((p) => !platformExceptions.has(p));
  const applicableShared = applicable.filter((p) => platformUsage.has(p));
  return { platform, label, shared, excluded, trueGaps, platformOnly, applicable, applicableShared };
}

function printGapResult(r: PlatformGapResult): void {
  console.log(`\n${"═".repeat(60)}`);
  console.log(`  Web ↔ ${r.label}`);
  console.log(`${"═".repeat(60)}`);

  console.log(`\n  Shared: ${r.shared.length} procedures`);

  if (r.excluded.length > 0) {
    console.log(`\n  Intentionally excluded (parity-exceptions.yaml): ${r.excluded.length}`);
    for (const p of r.excluded) console.log(`    [skip] ${p}`);
  }

  if (r.trueGaps.length > 0) {
    console.log(`\n  TRUE PARITY GAPS: ${r.trueGaps.length}`);
    for (const p of r.trueGaps) console.log(`    [GAP]  ${p}`);
  } else {
    console.log(`\n  True parity gaps: 0`);
  }

  if (r.platformOnly.length > 0) {
    console.log(`\n  ${r.label}-only (not on web): ${r.platformOnly.length}`);
    for (const p of r.platformOnly) console.log(`    [${r.platform}]  ${p}`);
  }

  const adjPct = r.applicable.length > 0
    ? ((r.applicableShared.length / r.applicable.length) * 100).toFixed(1)
    : "100.0";
  console.log(`\n  Adjusted parity: ${adjPct}% (${r.applicableShared.length}/${r.applicable.length})`);
}

function cmdScan() {
  console.log("=== tRPC Coverage Analysis ===\n");

  const usage = scanAllPlatforms();
  const exceptions = parseExceptions(path.join(ROOT, "parity-exceptions.yaml"));
  const apiProcs = extractApiProcedures();
  const allApi = allApiProcedureNames(apiProcs);

  // --- Print stats ---
  console.log("Platform procedure counts:");
  console.log(`  Web:    ${usage.web.size}`);
  console.log(`  Mobile: ${usage.mobile.size}`);
  console.log(`  CLI:    ${usage.cli.size}`);
  console.log(`  MCP:    ${usage.mcp.size}`);
  console.log(`  API:    ${allApi.size} procedures defined`);

  // --- Analyze all platforms against web ---
  const results: PlatformGapResult[] = [
    analyzePlatformGap(usage.web, usage.mobile, exceptions.mobile, "mobile", "Mobile"),
    analyzePlatformGap(usage.web, usage.cli, exceptions.cli, "cli", "CLI"),
    analyzePlatformGap(usage.web, usage.mcp, exceptions.mcp, "mcp", "MCP"),
  ];

  for (const r of results) printGapResult(r);

  // --- Unimplemented (in API but used nowhere) ---
  const usedAnywhere = new Set([...usage.web, ...usage.mobile, ...usage.cli, ...usage.mcp]);
  const unimplemented = [...allApi].filter((p) => !usedAnywhere.has(p)).sort();

  if (unimplemented.length > 0) {
    console.log(`\n${"═".repeat(60)}`);
    console.log(`  Unimplemented (in API, used on no platform): ${unimplemented.length}`);
    console.log(`${"═".repeat(60)}`);
    for (const p of unimplemented) console.log(`    [api]  ${p}`);
  }

  console.log();

  // --- Exit 1 when ANY platform has true gaps — CI should block ---
  const totalGaps = results.reduce((s, r) => s + r.trueGaps.length, 0);
  if (totalGaps > 0) {
    console.log(`FAIL: ${totalGaps} total parity gap(s) across all platforms.\n`);
    process.exitCode = 1;
  } else {
    console.log("PASS: All platforms at 100% adjusted parity (or all gaps in exceptions).\n");
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
  for (const platform of PLATFORMS) {
    for (const proc of exceptions[platform]) {
      if (!allApi.has(proc)) {
        console.log(`  ERROR: [${platform}] ${proc} is in parity-exceptions.yaml but does not exist in the API`);
        errors++;
      }
    }
  }
  if (errors === 0) console.log("  All exceptions reference valid API procedures.");

  // 2. Scan web usage and check for stale exceptions (procedure no longer used on web).
  console.log("\nChecking for stale exceptions (procedure excluded but web no longer uses it)...");
  const webUsage = scanTrpcDotPattern(path.join(ROOT, "apps/web/src"));
  for (const platform of PLATFORMS) {
    for (const proc of exceptions[platform]) {
      if (!webUsage.has(proc)) {
        console.log(`  WARNING: [${platform}] ${proc} is in exceptions but web does not use it — may be stale`);
        warnings++;
      }
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

  const totalExceptions = PLATFORMS.reduce((s, p) => s + exceptions[p].size, 0);
  console.log(`\n--- Summary: ${totalExceptions} total exceptions (mobile: ${exceptions.mobile.size}, cli: ${exceptions.cli.size}, mcp: ${exceptions.mcp.size}), ${warnings} warnings, ${errors} errors ---`);

  if (errors > 0) process.exitCode = 1;
}

function cmdChanged(changedFiles: string[]) {
  console.log("=== Changed Files Parity Check ===\n");

  const touchesWeb = changedFiles.some((f) => f.startsWith("apps/web/"));
  const touchesApi = changedFiles.some((f) => f.includes("packages/api/src/routers/"));
  const touchesExceptions = changedFiles.some((f) => f.includes("parity-exceptions.yaml"));

  if (!touchesWeb && !touchesApi) {
    console.log("No web or API files changed — skipping parity check.");
    return;
  }

  const exceptions = parseExceptions(path.join(ROOT, "parity-exceptions.yaml"));
  const usage = scanAllPlatforms();

  if (touchesApi && !touchesExceptions) {
    console.log(
      "NOTE: API routers changed but parity-exceptions.yaml was not updated.\n" +
      "      If you added a new procedure that is platform-specific, add it to parity-exceptions.yaml.\n"
    );
  }

  const platformChecks: Array<{ name: string; usage: Set<string>; exceptions: Set<string> }> = [
    { name: "mobile", usage: usage.mobile, exceptions: exceptions.mobile },
    { name: "cli", usage: usage.cli, exceptions: exceptions.cli },
    { name: "mcp", usage: usage.mcp, exceptions: exceptions.mcp },
  ];

  let totalGaps = 0;
  for (const { name, usage: platformUsage, exceptions: platformExceptions } of platformChecks) {
    const trueGaps = [...usage.web]
      .filter((p) => !platformUsage.has(p) && !platformExceptions.has(p))
      .sort();

    if (trueGaps.length > 0) {
      console.log(`${name.toUpperCase()} PARITY GAPS (${trueGaps.length}):`);
      for (const p of trueGaps) console.log(`  [GAP] ${p}`);
      console.log();
      totalGaps += trueGaps.length;
    }
  }

  if (totalGaps === 0) {
    console.log("No parity gaps detected — all platforms are in sync (or gaps are in exceptions).");
  } else {
    console.log(
      `${totalGaps} total gap(s) found.\n\nFor each gap, either:\n` +
      "  a) implement it on the missing platform, or\n" +
      "  b) add it to parity-exceptions.yaml with a justification comment."
    );
    process.exitCode = 1;
  }
}

function cmdReport() {
  const usage = scanAllPlatforms();
  const exceptions = parseExceptions(path.join(ROOT, "parity-exceptions.yaml"));
  const apiProcs = extractApiProcedures();
  const allApi = allApiProcedureNames(apiProcs);

  const usedAnywhere = new Set([...usage.web, ...usage.mobile, ...usage.cli, ...usage.mcp]);
  const unimplemented = [...allApi].filter((p) => !usedAnywhere.has(p)).sort();

  const lines: string[] = [];
  lines.push("# Feature Parity Report");
  lines.push("");
  lines.push(`Generated: ${new Date().toISOString().split("T")[0]}`);
  lines.push("");
  lines.push("## Platform Coverage");
  lines.push("");
  lines.push("| Platform | Procedures Used | Notes |");
  lines.push("|----------|----------------|-------|");
  lines.push(`| Web      | ${usage.web.size} | source of truth |`);
  lines.push(`| Mobile   | ${usage.mobile.size} | auto-detected from apps/mobile |`);
  lines.push(`| CLI      | ${usage.cli.size} | auto-detected from packages/cli/src |`);
  lines.push(`| MCP      | ${usage.mcp.size} | auto-detected from packages/mcp/src |`);
  lines.push(`| API      | ${allApi.size} | total procedures defined |`);
  lines.push("");

  // Per-platform parity sections
  const platformConfigs: Array<{ platform: Platform; label: string; usage: Set<string> }> = [
    { platform: "mobile", label: "Mobile", usage: usage.mobile },
    { platform: "cli", label: "CLI", usage: usage.cli },
    { platform: "mcp", label: "MCP", usage: usage.mcp },
  ];

  let allGaps = 0;

  for (const { platform, label, usage: platformUsage } of platformConfigs) {
    const r = analyzePlatformGap(usage.web, platformUsage, exceptions[platform], platform, label);
    const adjPct = r.applicable.length > 0
      ? ((r.applicableShared.length / r.applicable.length) * 100).toFixed(1)
      : "100.0";

    lines.push(`## Web / ${label} Parity`);
    lines.push("");
    lines.push(`- **Shared**: ${r.shared.length} procedures`);
    lines.push(`- **Adjusted parity**: ${adjPct}% (${r.applicableShared.length}/${r.applicable.length} applicable)`);
    lines.push(`- **Excluded (not-applicable)**: ${r.excluded.length} procedures`);
    lines.push(`- **True gaps**: ${r.trueGaps.length} procedures`);
    lines.push("");

    if (r.trueGaps.length > 0) {
      lines.push(`### ${label} True Gaps`);
      lines.push("");
      for (const p of r.trueGaps) lines.push(`- \`${p}\``);
      lines.push("");
      allGaps += r.trueGaps.length;
    }

    if (r.excluded.length > 0) {
      lines.push(`<details><summary>${label} Intentional Exclusions (${r.excluded.length})</summary>`);
      lines.push("");
      for (const p of r.excluded) lines.push(`- \`${p}\``);
      lines.push("");
      lines.push("</details>");
      lines.push("");
    }
  }

  lines.push(`- **Unimplemented** (in API, used nowhere): ${unimplemented.length} procedures`);
  lines.push("");

  if (unimplemented.length > 0) {
    lines.push("<details><summary>Unimplemented API Procedures</summary>");
    lines.push("");
    for (const p of unimplemented) lines.push(`- \`${p}\``);
    lines.push("");
    lines.push("</details>");
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
