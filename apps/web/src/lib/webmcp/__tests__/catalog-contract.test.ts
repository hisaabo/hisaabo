/**
 * Guard tests: the browser tool list must stay consistent with the MCP-side
 * catalog (packages/mcp/src/lib/webmcpCatalog.ts) and the MCP tier metadata
 * (packages/mcp/src/lib/toolMeta.ts).
 *
 * Both are data-only files in another package. They are loaded by path at test
 * time on purpose: importing them statically would pull a package outside
 * `src/` into the web TypeScript program, and — worse — would invite the web
 * bundle to import 194 MCP tool names. The web runtime never touches them.
 */

import { describe, it, expect, beforeAll } from "vitest";
import * as path from "node:path";
import { webMcpTools } from "../tools";
import type { WebMcpToolDefinition } from "../types";

interface CatalogEntry {
  webmcp: string;
  narrowed?: string;
}
interface ToolMetaEntry {
  tier: "read" | "write" | "admin";
  destructive: boolean;
  readOnly?: boolean;
}

let catalog: Record<string, CatalogEntry>;
let browserOnly: readonly string[];
let toolMeta: Record<string, ToolMetaEntry>;

beforeAll(async () => {
  const mcpLib = path.resolve(import.meta.dirname, "../../../../../../packages/mcp/src/lib");
  const catalogMod = await import(/* @vite-ignore */ path.join(mcpLib, "webmcpCatalog.ts"));
  const metaMod = await import(/* @vite-ignore */ path.join(mcpLib, "toolMeta.ts"));
  catalog = catalogMod.WEBMCP_CATALOG;
  browserOnly = catalogMod.WEBMCP_BROWSER_ONLY_TOOLS;
  toolMeta = metaMod.TOOL_META;
});

function isReadOnlyTier(meta: ToolMetaEntry): boolean {
  return meta.tier === "read" || meta.readOnly === true;
}

/** Per-tool proof that a narrowed browser tool really is narrower than its MCP twin. */
const NARROWING_CHECKS: Record<string, (def: WebMcpToolDefinition) => void> = {
  invoice_update_status: (def) => {
    const status = def.inputSchema.properties?.status;
    expect(status?.enum, "status enum").toBeDefined();
    expect(status!.enum).not.toContain("cancelled");
    expect(def.description).not.toMatch(/to void one|void.*'cancelled'/i);
  },
};

describe("WebMCP tools vs the exposure catalog", () => {
  it("every web tool is either browser-only or exposed in the catalog", () => {
    for (const def of webMcpTools) {
      if (browserOnly.includes(def.name)) continue;
      expect(catalog[def.name], `${def.name} is missing from webmcpCatalog.ts`).toBeDefined();
      expect(catalog[def.name].webmcp, def.name).toBe("exposed");
    }
  });

  it("every exposed catalog entry is implemented, and nothing extra is exposed", () => {
    const implemented = new Set(webMcpTools.map((t) => t.name));
    const exposed = Object.entries(catalog)
      .filter(([, e]) => e.webmcp === "exposed")
      .map(([name]) => name);
    for (const name of exposed) expect(implemented.has(name), `${name} is "exposed" but not implemented`).toBe(true);
    const nonBrowserOnly = webMcpTools.filter((t) => !browserOnly.includes(t.name));
    expect(nonBrowserOnly).toHaveLength(exposed.length);
  });

  it("allows only the two documented browser-only tools", () => {
    expect([...browserOnly].sort()).toEqual(["app_navigate", "hisaabo_context"]);
    for (const name of browserOnly) {
      const def = webMcpTools.find((t) => t.name === name);
      expect(def, name).toBeDefined();
      expect(def!.annotations.readOnlyHint, `${name} touches no data`).toBe(true);
    }
  });

  it("readOnlyHint matches the MCP tier of every shared tool", () => {
    for (const def of webMcpTools) {
      if (browserOnly.includes(def.name)) continue;
      const meta = toolMeta[def.name];
      expect(meta, `${def.name} has no TOOL_META entry`).toBeDefined();
      expect(def.annotations.readOnlyHint === true, `${def.name}: readOnlyHint vs tier ${meta.tier}`).toBe(
        isReadOnlyTier(meta),
      );
    }
  });

  it("no exposed tool is destructive or admin, except a declared narrowed form", () => {
    for (const def of webMcpTools) {
      if (browserOnly.includes(def.name)) continue;
      const meta = toolMeta[def.name];
      expect(meta.tier, `${def.name} must not be an admin tool`).not.toBe("admin");
      if (meta.destructive) {
        const narrowed = catalog[def.name].narrowed;
        expect(narrowed, `${def.name} is destructive in MCP: declare how the browser tool is narrower`).toBeTruthy();
        expect(NARROWING_CHECKS[def.name], `${def.name} needs a narrowing check in this file`).toBeDefined();
        NARROWING_CHECKS[def.name](def);
      }
    }
  });

  it("every narrowed catalog entry has a narrowing check", () => {
    for (const [name, entry] of Object.entries(catalog)) {
      if (entry.narrowed) expect(NARROWING_CHECKS[name], name).toBeDefined();
    }
  });

  it("every write tool declares requires, so a role without the permission never sees it", () => {
    for (const def of webMcpTools) {
      if (def.annotations.readOnlyHint) continue;
      expect(def.requires, `${def.name} is a write tool and must declare requires`).toBeDefined();
      expect(def.annotations.consequentialHint, `${def.name} should be flagged consequential`).toBe(true);
    }
  });

  it("no web tool carries a destructive-looking name", () => {
    for (const def of webMcpTools) {
      expect(def.name, def.name).not.toMatch(/_(delete|merge|void|cancel|transfer|revoke|import)$/);
    }
  });
});
