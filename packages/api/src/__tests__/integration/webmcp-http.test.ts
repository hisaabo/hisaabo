/**
 * webmcp-http.test.ts — the operator kill switch at the HTTP level.
 *
 * server.ts starts listening on import, so it cannot be loaded in a test. This file
 * mounts the very middleware factory server.ts uses (agentKillSwitch) in front of the
 * real tRPC fetch handler, the real router and the real createContext, on a
 * throwaway Hono app, and sends real HTTP requests carrying a real session cookie.
 *
 * What is pinned: with WEBMCP_DISABLED set, a browser-agent-marked MUTATION is
 * answered 403 and writes nothing; unmarked requests are unaffected; and the switch
 * is read per request, not captured at startup.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { Hono } from "hono";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { createTestWorld, type TestWorld } from "../helpers/fixtures.js";
import { getTenantTestDb, truncateAllTables, closeTestDb } from "../helpers/test-db.js";
import { auditLog, parties } from "@hisaabo/db";
import { and, eq } from "drizzle-orm";
import { createContext } from "../../context.js";
import { appRouter } from "../../router.js";
import { agentKillSwitch, WEBMCP_DISABLED_MESSAGE } from "../../lib/webmcp-policy.js";

let world: TestWorld;

function buildApp() {
  const app = new Hono();
  app.use("/api/trpc/*", agentKillSwitch());
  app.use("/api/trpc/*", (c) =>
    fetchRequestHandler({ endpoint: "/api/trpc", req: c.req.raw, router: appRouter, createContext }),
  );
  return app;
}

beforeAll(async () => {
  world = await createTestWorld();
});

afterEach(() => {
  delete process.env.WEBMCP_DISABLED;
});

afterAll(async () => {
  await truncateAllTables();
  await closeTestDb();
});

function createParty(name: string, extraHeaders: Record<string, string> = {}) {
  return buildApp().request("/api/trpc/party.create", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-requested-with": "hisaabo",
      "x-business-id": world.business1.id,
      cookie: `session_id=${world.rameshSession.id}`,
      ...extraHeaders,
    },
    body: JSON.stringify({ json: { type: "customer", name } }),
  });
}

async function partiesNamed(name: string) {
  return getTenantTestDb()
    .select({ id: parties.id })
    .from(parties)
    .where(and(eq(parties.businessId, world.business1.id), eq(parties.name, name)));
}

const AGENT = { "x-hisaabo-agent": "webmcp" };

describe("WEBMCP_DISABLED at the HTTP level", () => {
  it("answers a marked mutation 403 and writes nothing", async () => {
    process.env.WEBMCP_DISABLED = "true";
    const name = `Kill switch party ${Date.now()}`;

    const res = await createParty(name, AGENT);

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: WEBMCP_DISABLED_MESSAGE });
    expect(await partiesNamed(name)).toHaveLength(0);
    // No audit row either: the request never reached tRPC.
    const audit = await getTenantTestDb().select().from(auditLog).where(eq(auditLog.action, "party.create"));
    expect(audit.some((a) => a.metadata?.includes(name))).toBe(false);
  });

  it("refuses the other spellings of on", async () => {
    for (const value of ["1", "yes", "ON", " true "]) {
      process.env.WEBMCP_DISABLED = value;
      const name = `Kill switch spelling ${value.trim()} ${Date.now()}`;
      expect((await createParty(name, AGENT)).status, value).toBe(403);
      expect(await partiesNamed(name), value).toHaveLength(0);
    }
  });

  it("leaves an unmarked request alone: the same user, the same cookie, the same mutation", async () => {
    process.env.WEBMCP_DISABLED = "true";
    const name = `Human during kill switch ${Date.now()}`;

    const res = await createParty(name);

    expect(res.status).toBe(200);
    expect(await partiesNamed(name)).toHaveLength(1);
  });

  it("does not mistake the MCP server's header for a browser agent", async () => {
    process.env.WEBMCP_DISABLED = "true";
    const name = `MCP during kill switch ${Date.now()}`;
    const res = await createParty(name, { "x-client-type": "mcp" });
    expect(res.status).toBe(200);
    expect(await partiesNamed(name)).toHaveLength(1);
  });

  it("lets a marked mutation through when the switch is off, attributed to the browser agent", async () => {
    const name = `Agent allowed ${Date.now()}`;

    const res = await createParty(name, AGENT);

    expect(res.status).toBe(200);
    const [row] = await partiesNamed(name);
    expect(row).toBeDefined();
    await expect
      .poll(async () => {
        const audit = await getTenantTestDb().select().from(auditLog).where(eq(auditLog.entityId, row.id));
        return audit[0]?.source;
      })
      .toBe("webmcp");
  });

  it("is read per request: flipping the variable takes effect without rebuilding the app", async () => {
    const app = buildApp();
    const send = (name: string) =>
      app.request("/api/trpc/party.create", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-requested-with": "hisaabo",
          "x-business-id": world.business1.id,
          cookie: `session_id=${world.rameshSession.id}`,
          ...AGENT,
        },
        body: JSON.stringify({ json: { type: "customer", name } }),
      });

    expect((await send(`Before ${Date.now()}`)).status).toBe(200);
    process.env.WEBMCP_DISABLED = "true";
    expect((await send(`During ${Date.now()}`)).status).toBe(403);
    delete process.env.WEBMCP_DISABLED;
    expect((await send(`After ${Date.now()}`)).status).toBe(200);
  });

  it("refuses marked queries too (reads are not offered to a disabled server's agents)", async () => {
    process.env.WEBMCP_DISABLED = "true";
    const res = await buildApp().request("/api/trpc/party.list?input=" + encodeURIComponent(JSON.stringify({ json: { page: 1, limit: 5 } })), {
      headers: {
        "x-requested-with": "hisaabo",
        "x-business-id": world.business1.id,
        cookie: `session_id=${world.rameshSession.id}`,
        ...AGENT,
      },
    });
    expect(res.status).toBe(403);
  });
});
