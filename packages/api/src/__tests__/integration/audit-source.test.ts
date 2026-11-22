/**
 * audit-source.test.ts — the agent origin marker on audit rows.
 *
 * `audit_log.source` says "this change came from a browser AI agent (webmcp)"
 * or "from the MCP server (mcp)". It is ATTRIBUTION, not authorisation:
 * the headers are client-supplied, and nothing here may grant or withhold
 * anything because of them. The tests cover:
 *
 *   1. the header parsing (webmcp / mcp / nothing, and which header must NOT count)
 *   2. a real mutation through the tRPC caller writing the right `source`
 *   3. a static guard that every logAudit call site passes `source: ctx.source`,
 *      so a new router cannot silently drop the attribution
 *   4. the marker having no effect on what a caller is allowed to do
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { desc, eq } from "drizzle-orm";
import { auditLog } from "@hisaabo/db";
import { AGENT_HEADER, auditSourceFromHeaders, isAgentRequest } from "../../lib/audit-source.js";
import { createTestWorld, type TestWorld } from "../helpers/fixtures.js";
import { createTestCaller } from "../helpers/create-test-caller.js";
import { getTenantTestDb, truncateAllTables, closeTestDb } from "../helpers/test-db.js";

const h = (init: Record<string, string>) => new Headers(init);

describe("auditSourceFromHeaders", () => {
  it("reads x-hisaabo-agent: webmcp", () => {
    expect(AGENT_HEADER).toBe("x-hisaabo-agent");
    expect(auditSourceFromHeaders(h({ "x-hisaabo-agent": "webmcp" }))).toBe("webmcp");
    expect(auditSourceFromHeaders(h({ "X-Hisaabo-Agent": " WebMCP " }))).toBe("webmcp");
  });

  it("reads the MCP server's existing x-client-type: mcp", () => {
    expect(auditSourceFromHeaders(h({ "x-client-type": "mcp" }))).toBe("mcp");
  });

  it("is null for ordinary clients", () => {
    expect(auditSourceFromHeaders(h({}))).toBeNull();
    expect(auditSourceFromHeaders(h({ "x-client-type": "cli" }))).toBeNull();
    expect(auditSourceFromHeaders(h({ "x-requested-with": "hisaabo" }))).toBeNull();
  });

  it("never reads x-hisaabo-client, which has meaning for auth", () => {
    expect(auditSourceFromHeaders(h({ "x-hisaabo-client": "desktop" }))).toBeNull();
    expect(auditSourceFromHeaders(h({ "x-hisaabo-client": "webmcp" }))).toBeNull();
    expect(auditSourceFromHeaders(h({ "x-hisaabo-client": "mcp" }))).toBeNull();
  });

  it("only accepts known values, so the column cannot be filled with arbitrary text", () => {
    expect(auditSourceFromHeaders(h({ "x-hisaabo-agent": "<script>" }))).toBeNull();
    expect(auditSourceFromHeaders(h({ "x-hisaabo-agent": "mcp" }))).toBeNull();
    expect(auditSourceFromHeaders(h({ "x-client-type": "webmcp" }))).toBeNull();
  });

  it("prefers the browser agent when both headers are present", () => {
    expect(auditSourceFromHeaders(h({ "x-hisaabo-agent": "webmcp", "x-client-type": "mcp" }))).toBe("webmcp");
  });

  it("isAgentRequest is true only for the browser agent header", () => {
    expect(isAgentRequest(h({ "x-hisaabo-agent": "webmcp" }))).toBe(true);
    expect(isAgentRequest(h({ "x-client-type": "mcp" }))).toBe(false);
    expect(isAgentRequest(h({}))).toBe(false);
  });
});

describe("every audit write carries the source", () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const srcRoot = path.resolve(here, "../..");

  function sourceFiles(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) return e.name === "__tests__" ? [] : sourceFiles(full);
      return e.name.endsWith(".ts") ? [full] : [];
    });
  }

  it("passes `source: ctx.source` at every logAudit(<db>, { ... }) and logAuditInTransaction(<tx>, { ... }) call site", () => {
    const offenders: string[] = [];
    const unmatched: string[] = [];
    let callSites = 0;
    for (const file of sourceFiles(srcRoot)) {
      // lib/audit.ts defines the two functions; it is not a call site.
      if (path.relative(srcRoot, file) === path.join("lib", "audit.ts")) continue;
      const text = fs.readFileSync(file, "utf8");
      // Any first argument (ctx.db, tx, db, a local handle), then an object literal.
      const needle = /\blog(?:Audit|AuditInTransaction)\(\s*[\w.]+,\s*\{/g;
      const lineOf = (index: number) => text.slice(0, index).split("\n").length;
      const matches = [...text.matchAll(needle)];
      // Every call, whatever its shape: a call the pattern above cannot parse (a params
      // variable, a cast, an unusual first argument) must fail here, not slip through.
      const readable = new Set(matches.map((m) => m.index));
      for (const m of text.matchAll(/\blog(?:Audit|AuditInTransaction)\(/g)) {
        if (!readable.has(m.index)) unmatched.push(`${path.relative(srcRoot, file)}:${lineOf(m.index!)}`);
      }
      for (const m of matches) {
        callSites++;
        const open = m.index + m[0].length - 1;
        let depth = 0;
        let end = open;
        for (; end < text.length; end++) {
          if (text[end] === "{") depth++;
          else if (text[end] === "}" && --depth === 0) break;
        }
        if (!/\bsource:\s*ctx\.source\b/.test(text.slice(open, end + 1))) {
          offenders.push(`${path.relative(srcRoot, file)}:${lineOf(m.index!)}`);
        }
      }
    }
    expect(callSites).toBeGreaterThan(50);
    expect(unmatched, `logAudit calls the guard cannot read (use logAudit(<db>, { ... }))`).toEqual([]);
    expect(offenders, `logAudit calls without source: ctx.source`).toEqual([]);
  });

  it("lets nothing but logAudit write the audit table", () => {
    const writers = sourceFiles(srcRoot).filter((f) => /insert\(auditLog\)/.test(fs.readFileSync(f, "utf8")));
    expect(writers.map((f) => path.relative(srcRoot, f))).toEqual(["lib/audit.ts"]);
  });
});

describe("audit_log.source end to end", () => {
  let world: TestWorld;

  beforeAll(async () => {
    world = await createTestWorld();
  });

  afterAll(async () => {
    await truncateAllTables();
    await closeTestDb();
  });

  function caller(headers?: Record<string, string>) {
    return createTestCaller({
      userId: world.ramesh.id,
      email: world.ramesh.email,
      name: world.ramesh.name,
      tenantId: world.tenant1.id,
      businessId: world.business1.id,
      headers,
    });
  }

  /** logAudit is fire-and-forget in several routers, so wait for the row. */
  async function auditRowFor(entityId: string) {
    const db = getTenantTestDb();
    for (let attempt = 0; attempt < 40; attempt++) {
      const [row] = await db
        .select()
        .from(auditLog)
        .where(eq(auditLog.entityId, entityId))
        .orderBy(desc(auditLog.createdAt))
        .limit(1);
      if (row) return row;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error(`no audit row for ${entityId}`);
  }

  async function createParty(headers?: Record<string, string>) {
    const party = await caller(headers).party.create({ type: "customer", name: `Source test ${Math.random()}` });
    return party!.id as string;
  }

  it("records webmcp for a call carrying x-hisaabo-agent: webmcp", async () => {
    const id = await createParty({ "x-hisaabo-agent": "webmcp" });
    expect((await auditRowFor(id)).source).toBe("webmcp");
  });

  it("records mcp for a call from the MCP server", async () => {
    const id = await createParty({ "x-client-type": "mcp" });
    expect((await auditRowFor(id)).source).toBe("mcp");
  });

  it("leaves source null for an ordinary client", async () => {
    const id = await createParty();
    expect((await auditRowFor(id)).source).toBeNull();
  });

  it("ignores x-hisaabo-client for attribution", async () => {
    const id = await createParty({ "x-hisaabo-client": "desktop" });
    expect((await auditRowFor(id)).source).toBeNull();
  });

  it("is attribution only: an agent header neither grants nor removes access", async () => {
    // A seller cannot see the audit trail with or without claiming to be an agent...
    const seller = (headers?: Record<string, string>) =>
      createTestCaller({
        userId: world.suresh.id,
        email: world.suresh.email,
        name: world.suresh.name,
        tenantId: world.tenant1.id,
        businessId: world.business1.id,
        headers,
      });
    await expect(seller().business.auditTrail({ page: 1, limit: 10 })).rejects.toThrow(/Cannot read Report|owners and admins/);
    await expect(seller({ "x-hisaabo-agent": "webmcp" }).business.auditTrail({ page: 1, limit: 10 })).rejects.toThrow(
      /Cannot read Report|owners and admins/,
    );
    // ...and an owner can still read it when the header is present.
    const trail = await caller({ "x-hisaabo-agent": "webmcp" }).business.auditTrail({ page: 1, limit: 10 });
    expect(trail.total).toBeGreaterThan(0);
  });

  it("exposes source on the audit trail so the activity log can label agent actions", async () => {
    const id = await createParty({ "x-hisaabo-agent": "webmcp" });
    await auditRowFor(id);
    const trail = await caller().business.auditTrail({ page: 1, limit: 100 });
    const entry = trail.data.find((e) => e.entityId === id);
    expect(entry?.source).toBe("webmcp");
  });
});
