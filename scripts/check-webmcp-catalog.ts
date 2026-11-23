/**
 * WebMCP catalog check — the half of feature parity that is not about tRPC.
 *
 * The browser agent surface (apps/web/src/lib/webmcp/tools) is curated, and the
 * decision for every MCP tool is recorded in
 * packages/mcp/src/lib/webmcpCatalog.ts. This check fails when the two drift:
 *
 *   - a WebMCP tool is not in the catalog (and is not a browser-only tool)
 *   - a WebMCP tool is in the catalog with any status other than "exposed"
 *   - a catalog entry has no (or an invalid) status
 *   - a catalog entry is "exposed" but no WebMCP tool implements it
 *   - the catalog and TOOL_META do not list exactly the same MCP tools
 *
 * Called from `scripts/check-parity.ts --validate` (and `--webmcp` on its own).
 * The pure rules live in `evaluateWebMcpCatalog` so they are unit-tested in
 * scripts/check-webmcp-catalog.test.ts without touching the file system.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";

export interface CatalogEntryLike {
  webmcp?: unknown;
  narrowed?: unknown;
}

export interface WebMcpCheckInput {
  /** Names registered by apps/web/src/lib/webmcp/tools (every `name: "..."` definition). */
  webTools: readonly string[];
  /** Tools that exist only in the browser and need no catalog entry. */
  browserOnly: readonly string[];
  catalog: Readonly<Record<string, CatalogEntryLike | undefined>>;
  /** Every tool name in packages/mcp/src/lib/toolMeta.ts. */
  mcpTools: readonly string[];
}

export interface WebMcpCheckResult {
  errors: string[];
  warnings: string[];
}

const STATUS_RE = /^(exposed|planned|excluded:[a-z][a-z0-9-]*)$/;

/** Every tool-definition `name: "..."` in a tools/*.ts source file (schema properties are never string-valued `name`s). */
export function extractWebMcpToolNames(source: string): string[] {
  const names: string[] = [];
  const re = /^\s*name:\s*"([A-Za-z0-9_.-]+)"\s*,/gm;
  for (let m = re.exec(source); m; m = re.exec(source)) names.push(m[1]);
  return names;
}

export function evaluateWebMcpCatalog(input: WebMcpCheckInput): WebMcpCheckResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const browserOnly = new Set(input.browserOnly);
  const webTools = new Set(input.webTools);
  const mcpTools = new Set(input.mcpTools);

  for (const name of input.webTools) {
    if (browserOnly.has(name)) continue;
    const entry = input.catalog[name];
    if (!entry) {
      errors.push(`WebMCP tool "${name}" is not in packages/mcp/src/lib/webmcpCatalog.ts — add it (status "exposed") or list it in WEBMCP_BROWSER_ONLY_TOOLS`);
    } else if (entry.webmcp !== "exposed") {
      errors.push(`WebMCP tool "${name}" is implemented in the browser but the catalog says ${JSON.stringify(entry.webmcp)} — set it to "exposed" or remove the tool`);
    }
  }

  for (const [name, entry] of Object.entries(input.catalog)) {
    if (!entry || typeof entry.webmcp !== "string" || !STATUS_RE.test(entry.webmcp)) {
      errors.push(`WebMCP catalog entry "${name}" has no valid status (expected "exposed", "planned" or "excluded:<reason>", got ${JSON.stringify(entry?.webmcp)})`);
      continue;
    }
    if (entry.webmcp === "exposed" && !webTools.has(name)) {
      errors.push(`WebMCP catalog says "${name}" is "exposed" but apps/web/src/lib/webmcp/tools has no such tool`);
    }
    if (!mcpTools.has(name)) {
      errors.push(`WebMCP catalog entry "${name}" does not match any tool in packages/mcp/src/lib/toolMeta.ts`);
    }
  }

  for (const name of input.mcpTools) {
    if (!(name in input.catalog)) {
      errors.push(`MCP tool "${name}" has no WebMCP catalog entry — decide exposed / planned / excluded:<reason>`);
    }
  }

  for (const name of browserOnly) {
    if (!webTools.has(name)) warnings.push(`WEBMCP_BROWSER_ONLY_TOOLS lists "${name}" but no such WebMCP tool exists`);
    if (mcpTools.has(name)) errors.push(`"${name}" is listed as browser-only but is also an MCP tool — give it a catalog entry instead`);
  }

  return { errors, warnings };
}

/** Load the real tool list, catalog and TOOL_META from the repo and evaluate them. */
export async function checkWebMcpCatalog(root: string): Promise<WebMcpCheckResult> {
  const toolsDir = path.join(root, "apps/web/src/lib/webmcp/tools");
  const webTools: string[] = [];
  for (const file of fs.readdirSync(toolsDir).sort()) {
    if (!file.endsWith(".ts") || file === "index.ts" || file === "shared.ts") continue;
    webTools.push(...extractWebMcpToolNames(fs.readFileSync(path.join(toolsDir, file), "utf-8")));
  }

  const catalogMod = await import(pathToFileURL(path.join(root, "packages/mcp/src/lib/webmcpCatalog.ts")).href);
  const metaMod = await import(pathToFileURL(path.join(root, "packages/mcp/src/lib/toolMeta.ts")).href);

  return evaluateWebMcpCatalog({
    webTools,
    browserOnly: catalogMod.WEBMCP_BROWSER_ONLY_TOOLS,
    catalog: catalogMod.WEBMCP_CATALOG,
    mcpTools: Object.keys(metaMod.TOOL_META),
  });
}
