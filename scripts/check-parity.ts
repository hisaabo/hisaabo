#!/usr/bin/env npx tsx
/**
 * Feature Parity Scanner
 *
 * Two modes of operation:
 *
 * 1. tRPC Coverage Analysis (--scan)
 *    Scans each platform's source for `trpc.<router>.<procedure>` calls and
 *    compares them. Outputs which procedures web uses that mobile does not.
 *
 * 2. Matrix Validation (--validate)
 *    Checks the feature-parity.yaml against the actual codebase:
 *    - Every tRPC procedure defined in packages/api must appear in at least one
 *      feature entry's `api` list.
 *    - Every feature marked `implemented` on web should not be `not-started`
 *      on mobile (warns about potential gaps).
 *
 * 3. Changed Files Check (--changed <files...>)
 *    Given a list of changed file paths (from a PR), outputs warnings if:
 *    - A new procedure was added to the API but no parity matrix entry exists.
 *    - A web feature was changed but the mobile equivalent is `not-started`.
 *
 * Usage:
 *   npx tsx scripts/check-parity.ts --scan
 *   npx tsx scripts/check-parity.ts --validate
 *   npx tsx scripts/check-parity.ts --changed apps/web/src/routes/invoices.tsx packages/api/src/routers/invoice.ts
 *   npx tsx scripts/check-parity.ts --report          # Generate markdown summary
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");

// ---------------------------------------------------------------------------
// YAML parser (minimal -- avoids requiring a dependency)
// We only need to parse the feature-parity.yaml which has a known structure.
// ---------------------------------------------------------------------------

interface Feature {
  id: string;
  name: string;
  category: string;
  api: string[];
  platforms: Record<string, string>;
  notes?: string;
}

function parseParityYaml(filePath: string): Feature[] {
  const content = fs.readFileSync(filePath, "utf-8");
  const features: Feature[] = [];
  let current: Partial<Feature> | null = null;
  let inPlatforms = false;
  let inApi = false;
  let apiItems: string[] = [];

  for (const rawLine of content.split("\n")) {
    const line = rawLine.trimEnd();
    const trimmed = line.trim();

    // Skip comments and empty lines
    if (trimmed.startsWith("#") || trimmed === "" || trimmed.startsWith("schema_version")) continue;
    if (trimmed === "features:") continue;

    // New feature entry
    if (trimmed.startsWith("- id:")) {
      // Save previous
      if (current?.id) {
        if (inApi) current.api = apiItems;
        features.push(current as Feature);
      }
      current = {
        id: trimmed.replace("- id:", "").trim(),
        name: "",
        category: "",
        api: [],
        platforms: {},
      };
      inPlatforms = false;
      inApi = false;
      apiItems = [];
      continue;
    }

    if (!current) continue;

    // Handle inline api: [a, b, c] format
    const apiInlineMatch = trimmed.match(/^api:\s*\[(.+)\]$/);
    if (apiInlineMatch) {
      current.api = apiInlineMatch[1].split(",").map((s) =>
        s.trim().replace(/^["']|["']$/g, "")
      );
      inApi = false;
      inPlatforms = false;
      continue;
    }

    // Handle multiline api:
    if (trimmed === "api:") {
      inApi = true;
      inPlatforms = false;
      apiItems = [];
      continue;
    }

    if (inApi && trimmed.startsWith("- ")) {
      apiItems.push(trimmed.replace(/^- /, "").replace(/^["']|["']$/g, ""));
      continue;
    }

    if (inApi && !trimmed.startsWith("- ")) {
      current.api = apiItems;
      inApi = false;
    }

    if (trimmed === "platforms:") {
      inPlatforms = true;
      inApi = false;
      continue;
    }

    if (inPlatforms) {
      const platformMatch = trimmed.match(/^(\w+):\s*(.+)$/);
      if (platformMatch) {
        const [, platform, statusRaw] = platformMatch;
        // Don't match "name:", "category:", "notes:" etc as platforms
        if (["web", "mobile", "store", "desktop", "cli", "mcp"].includes(platform)) {
          current.platforms[platform] = statusRaw.replace(/#.*$/, "").trim();
          continue;
        }
      }
      inPlatforms = false;
    }

    // Simple key: value fields
    const kvMatch = trimmed.match(/^(\w+):\s*(.+)$/);
    if (kvMatch) {
      const [, key, value] = kvMatch;
      const cleanValue = value.replace(/^["']|["']$/g, "").replace(/#.*$/, "").trim();
      if (key === "name") current.name = cleanValue;
      else if (key === "category") current.category = cleanValue;
      else if (key === "notes") current.notes = cleanValue;
    }
  }

  // Save last entry
  if (current?.id) {
    if (inApi) current.api = apiItems;
    features.push(current as Feature);
  }

  return features;
}

// ---------------------------------------------------------------------------
// tRPC Usage Scanner
// ---------------------------------------------------------------------------

function scanTrpcUsage(dir: string): Set<string> {
  const procedures = new Set<string>();
  if (!fs.existsSync(dir)) return procedures;

  function walk(d: string) {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === ".next" || entry.name === "dist") continue;
        walk(full);
      } else if (/\.(tsx?|jsx?)$/.test(entry.name)) {
        const content = fs.readFileSync(full, "utf-8");
        // Match trpc.<router>.<procedure>.useQuery/useMutation etc
        const matches = content.matchAll(/trpc\.(\w+)\.(\w+)\./g);
        for (const m of matches) {
          procedures.add(`${m[1]}.${m[2]}`);
        }
      }
    }
  }

  walk(dir);
  return procedures;
}

// ---------------------------------------------------------------------------
// API Procedure Extractor
// ---------------------------------------------------------------------------

function extractApiProcedures(): Map<string, string[]> {
  const routersDir = path.join(ROOT, "packages/api/src/routers");
  const routerFile = path.join(ROOT, "packages/api/src/router.ts");

  // Parse router.ts to get the namespace mapping
  const routerContent = fs.readFileSync(routerFile, "utf-8");
  const namespaceMap = new Map<string, string>();
  const nsMatches = routerContent.matchAll(/(\w+):\s*(\w+Router)/g);
  for (const m of nsMatches) {
    namespaceMap.set(m[2], m[1]); // e.g. authRouter -> auth
  }

  const procedures = new Map<string, string[]>();

  for (const file of fs.readdirSync(routersDir)) {
    if (!file.endsWith(".ts")) continue;
    const content = fs.readFileSync(path.join(routersDir, file), "utf-8");

    // Find all procedure definitions
    const procMatches = content.matchAll(
      /^\s+(\w+):\s*(?:public|protected|tenant|viewer|member|admin)Procedure/gm
    );

    const procs: string[] = [];
    for (const m of procMatches) {
      procs.push(m[1]);
    }

    // For document.ts, handle specially:
    // - Factory-generated routers (quotation, creditNote, etc.) get factory procs
    // - The documentRouter itself gets the directly-defined procedures (e.g. convert)
    if (file === "document.ts") {
      const factoryProcs = ["list", "getById", "create", "updateStatus", "delete"];
      const allExports = [...content.matchAll(/export const (\w+Router)/g)];
      for (const m of allExports) {
        const routerName = m[1];
        const namespace = namespaceMap.get(routerName);
        if (!namespace) continue;

        if (namespace === "document") {
          // The documentRouter has directly-defined procedures (e.g. convert)
          procedures.set(namespace, procs);
        } else {
          // Factory-generated routers get the standard CRUD procedures
          procedures.set(namespace, [...factoryProcs]);
        }
      }
      continue; // Skip the generic export matching below
    }

    // Determine namespace from the export name
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
// Commands
// ---------------------------------------------------------------------------

function cmdScan() {
  console.log("=== tRPC Coverage Analysis ===\n");

  const webUsage = scanTrpcUsage(path.join(ROOT, "apps/web/src"));
  const mobileUsage = scanTrpcUsage(path.join(ROOT, "apps/mobile"));

  // Load feature-parity.yaml to determine intentionally excluded procedures
  const yamlPath = path.join(ROOT, "feature-parity.yaml");
  const notApplicableMobile = new Set<string>();
  if (fs.existsSync(yamlPath)) {
    const features = parseParityYaml(yamlPath);
    for (const f of features) {
      if (f.platforms.mobile === "not-applicable") {
        for (const proc of f.api) {
          // Skip REST endpoints (they start with GET/POST/PUT/DELETE)
          if (/^[A-Z]+ /.test(proc)) continue;
          notApplicableMobile.add(proc);
        }
      }
    }
  }

  const webOnly = [...webUsage].filter((p) => !mobileUsage.has(p)).sort();
  const mobileOnly = [...mobileUsage].filter((p) => !webUsage.has(p)).sort();
  const shared = [...webUsage].filter((p) => mobileUsage.has(p)).sort();

  // Split web-only into intentionally excluded vs genuine gaps
  const excluded = webOnly.filter((p) => notApplicableMobile.has(p));
  const trueGaps = webOnly.filter((p) => !notApplicableMobile.has(p));

  console.log(`Web uses ${webUsage.size} tRPC procedures`);
  console.log(`Mobile uses ${mobileUsage.size} tRPC procedures`);
  console.log(`Shared: ${shared.length} procedures\n`);

  if (excluded.length > 0) {
    console.log(`--- Intentionally excluded from mobile (not-applicable): ${excluded.length} ---`);
    for (const p of excluded) {
      console.log(`  - ${p}`);
    }
    console.log();
  }

  if (trueGaps.length > 0) {
    console.log(`--- True parity gaps (mobile should implement): ${trueGaps.length} ---`);
    for (const p of trueGaps) {
      console.log(`  - ${p}`);
    }
    console.log();
  } else {
    console.log("--- True parity gaps (mobile should implement): 0 ---");
    console.log("  (none)\n");
  }

  if (mobileOnly.length > 0) {
    console.log(`--- Mobile-only (${mobileOnly.length}) --- Web is missing these:`);
    for (const p of mobileOnly) {
      console.log(`  - ${p}`);
    }
    console.log();
  }

  // Overall raw parity (for reference)
  const totalUnique = new Set([...webUsage, ...mobileUsage]).size;
  const rawPercent = ((shared.length / totalUnique) * 100).toFixed(1);
  console.log(`Raw parity (all procedures): ${rawPercent}% (${shared.length}/${totalUnique})`);

  // Adjusted parity: exclude not-applicable procedures from the denominator.
  // Applicable web procedures = web procedures that are NOT in the not-applicable set.
  const applicableWebProcs = [...webUsage].filter((p) => !notApplicableMobile.has(p));
  const applicableShared = applicableWebProcs.filter((p) => mobileUsage.has(p));
  const adjustedPercent = applicableWebProcs.length > 0
    ? ((applicableShared.length / applicableWebProcs.length) * 100).toFixed(1)
    : "100.0";
  console.log(`Adjusted parity (excluding not-applicable): ${adjustedPercent}% (${applicableShared.length}/${applicableWebProcs.length} applicable procedures)\n`);

  // Exit code for CI
  if (trueGaps.length > 0) {
    process.exitCode = 0; // Non-blocking -- just informational
  }
}

function cmdValidate() {
  console.log("=== Feature Parity Matrix Validation ===\n");

  const yamlPath = path.join(ROOT, "feature-parity.yaml");
  if (!fs.existsSync(yamlPath)) {
    console.error("ERROR: feature-parity.yaml not found at repo root");
    process.exitCode = 1;
    return;
  }

  const features = parseParityYaml(yamlPath);
  const apiProcedures = extractApiProcedures();

  let warnings = 0;
  let errors = 0;

  // 1. Check that every API procedure appears in some feature's api list
  const allTrackedProcedures = new Set<string>();
  for (const f of features) {
    for (const proc of f.api) {
      // Skip REST endpoints
      if (proc.startsWith("GET ") || proc.startsWith("POST ")) continue;
      allTrackedProcedures.add(proc);
    }
  }

  console.log("Checking API procedure coverage...");
  for (const [namespace, procs] of apiProcedures) {
    for (const proc of procs) {
      const fullName = `${namespace}.${proc}`;
      if (!allTrackedProcedures.has(fullName)) {
        console.log(`  WARNING: ${fullName} is not tracked in any feature entry`);
        warnings++;
      }
    }
  }

  // 2. Check for parity gaps: web=implemented, mobile=not-started
  console.log("\nChecking parity gaps (web=implemented, mobile=not-started)...");
  for (const f of features) {
    const webStatus = f.platforms.web;
    const mobileStatus = f.platforms.mobile;

    if (webStatus === "implemented" && mobileStatus === "not-started") {
      console.log(`  GAP: ${f.id} (${f.name}) -- web is implemented, mobile is not-started`);
      warnings++;
    }
  }

  // 3. Check for features with no platform having implemented status
  console.log("\nChecking for unimplemented features...");
  for (const f of features) {
    const anyImplemented = Object.values(f.platforms).some(
      (s) => s === "implemented" || s === "partial" || s === "placeholder"
    );
    if (!anyImplemented) {
      console.log(`  INFO: ${f.id} (${f.name}) -- not implemented on any platform`);
    }
  }

  console.log(`\n--- Summary: ${features.length} features, ${warnings} warnings, ${errors} errors ---`);

  if (errors > 0) process.exitCode = 1;
}

function cmdChanged(changedFiles: string[]) {
  console.log("=== Changed Files Parity Check ===\n");

  const yamlPath = path.join(ROOT, "feature-parity.yaml");
  if (!fs.existsSync(yamlPath)) {
    console.log("SKIP: feature-parity.yaml not found");
    return;
  }

  const features = parseParityYaml(yamlPath);
  const warnings: string[] = [];

  const touchesApi = changedFiles.some((f) => f.includes("packages/api/src/routers/"));
  const touchesWeb = changedFiles.some((f) => f.startsWith("apps/web/"));
  const touchesMobile = changedFiles.some((f) => f.startsWith("apps/mobile/"));
  const touchesParity = changedFiles.some((f) => f.includes("feature-parity.yaml"));

  // If API routers changed but parity file was not updated
  if (touchesApi && !touchesParity) {
    warnings.push(
      "WARNING: API router files changed but feature-parity.yaml was not updated. " +
      "If you added a new procedure, add it to the parity matrix."
    );
  }

  // If web app changed, find matching features and check mobile status
  if (touchesWeb && !touchesMobile) {
    const webFiles = changedFiles.filter((f) => f.startsWith("apps/web/"));
    for (const f of webFiles) {
      // Try to identify which features this file relates to
      for (const feature of features) {
        const webStatus = feature.platforms.web;
        const mobileStatus = feature.platforms.mobile;

        if (webStatus === "implemented" && mobileStatus === "not-started") {
          // Check if the file path seems related to this feature's category
          const lowerPath = f.toLowerCase();
          const lowerCategory = feature.category.toLowerCase();
          const lowerName = feature.name.toLowerCase();

          if (
            lowerPath.includes(lowerCategory.split(" ")[0]) ||
            lowerPath.includes(feature.id.split(".")[0])
          ) {
            warnings.push(
              `PARITY GAP: ${feature.id} (${feature.name}) is implemented on web but not-started on mobile. ` +
              `File changed: ${f}`
            );
          }
        }
      }
    }
  }

  if (warnings.length === 0) {
    console.log("No parity issues detected for changed files.");
  } else {
    for (const w of warnings) {
      console.log(`  ${w}`);
    }
  }

  console.log(`\n${warnings.length} warning(s)`);
}

function cmdReport() {
  const yamlPath = path.join(ROOT, "feature-parity.yaml");
  if (!fs.existsSync(yamlPath)) {
    console.error("ERROR: feature-parity.yaml not found");
    process.exitCode = 1;
    return;
  }

  const features = parseParityYaml(yamlPath);
  const webUsage = scanTrpcUsage(path.join(ROOT, "apps/web/src"));
  const mobileUsage = scanTrpcUsage(path.join(ROOT, "apps/mobile"));

  // Group by category
  const byCategory = new Map<string, Feature[]>();
  for (const f of features) {
    const list = byCategory.get(f.category) || [];
    list.push(f);
    byCategory.set(f.category, list);
  }

  const statusEmoji: Record<string, string> = {
    implemented: "done",
    partial: "partial",
    planned: "planned",
    "not-started": "missing",
    "not-applicable": "n/a",
    placeholder: "stub",
  };

  const lines: string[] = [];
  lines.push("# Feature Parity Report");
  lines.push("");
  lines.push(`Generated: ${new Date().toISOString().split("T")[0]}`);
  lines.push("");

  // Summary counts
  let webImpl = 0, mobileImpl = 0, storeImpl = 0;
  let total = features.length;
  for (const f of features) {
    if (f.platforms.web === "implemented") webImpl++;
    if (f.platforms.mobile === "implemented") mobileImpl++;
    if (f.platforms.store === "implemented") storeImpl++;
  }

  lines.push("## Summary");
  lines.push("");
  lines.push(`| Platform | Implemented | Total | Coverage |`);
  lines.push(`|----------|-------------|-------|----------|`);
  lines.push(`| Web      | ${webImpl} | ${total} | ${((webImpl / total) * 100).toFixed(0)}% |`);
  lines.push(`| Mobile   | ${mobileImpl} | ${total} | ${((mobileImpl / total) * 100).toFixed(0)}% |`);
  lines.push(`| Store    | ${storeImpl} | ${total} | ${((storeImpl / total) * 100).toFixed(0)}% |`);
  lines.push("");

  // tRPC coverage
  const shared = [...webUsage].filter((p) => mobileUsage.has(p));
  const totalUnique = new Set([...webUsage, ...mobileUsage]).size;
  lines.push(`**tRPC procedure parity**: ${shared.length}/${totalUnique} (${((shared.length / totalUnique) * 100).toFixed(0)}%)`);
  lines.push("");

  // Per-category breakdown
  lines.push("## By Category");
  lines.push("");

  for (const [category, feats] of byCategory) {
    lines.push(`### ${category}`);
    lines.push("");
    lines.push("| Feature | Web | Mobile | Store |");
    lines.push("|---------|-----|--------|-------|");
    for (const f of feats) {
      lines.push(
        `| ${f.name} | ${statusEmoji[f.platforms.web] || f.platforms.web} | ${statusEmoji[f.platforms.mobile] || f.platforms.mobile} | ${statusEmoji[f.platforms.store] || f.platforms.store} |`
      );
    }
    lines.push("");
  }

  // Mobile gaps section
  const gaps = features.filter(
    (f) =>
      f.platforms.web === "implemented" &&
      (f.platforms.mobile === "not-started" || f.platforms.mobile === "placeholder")
  );

  if (gaps.length > 0) {
    lines.push("## Mobile Parity Gaps");
    lines.push("");
    lines.push("Features implemented on web but not on mobile:");
    lines.push("");
    for (const g of gaps) {
      const status = g.platforms.mobile === "placeholder" ? "(placeholder)" : "";
      lines.push(`- **${g.name}** (${g.category}) ${status}`);
    }
  }

  console.log(lines.join("\n"));
}

// ---------------------------------------------------------------------------
// CLI
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
  npx tsx scripts/check-parity.ts --scan       Scan tRPC usage across platforms
  npx tsx scripts/check-parity.ts --validate   Validate parity matrix against API
  npx tsx scripts/check-parity.ts --changed <files...>  Check changed files for parity gaps
  npx tsx scripts/check-parity.ts --report     Generate markdown parity report
`);
    break;
}
