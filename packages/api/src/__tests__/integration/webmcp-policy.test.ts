/**
 * webmcp-policy.test.ts — who can switch browser AI agents (WebMCP) off.
 *
 *   operator  WEBMCP_DISABLED=true  -> system.config.webmcpDisabled (public), and agent-marked
 *                                      requests are refused by the HTTP layer
 *   owner     tenant.setWebMcpDisabled -> auth.me.webmcpDisabled for everyone in the organization
 *
 * The web app reads both before it registers any tool. Enforcement is client side
 * by design (WebMCP lives in the browser); these tests pin the data it relies on:
 * the owner-only gate, per-organization scope, and that nothing else changes.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { tenants } from "@hisaabo/db";
import { createTestWorld, createUser, addMember, type TestWorld } from "../helpers/fixtures.js";
import { createTestCaller, createUnauthenticatedCaller } from "../helpers/create-test-caller.js";
import { getControlDb, truncateAllTables, closeTestDb } from "../helpers/test-db.js";
import { isWebMcpDisabledByOperator, shouldRefuseAgentRequest, WEBMCP_DISABLED_MESSAGE } from "../../lib/webmcp-policy.js";

let world: TestWorld;

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

function as(user: { id: string; email: string; name: string | null }, tenantId: string, businessId: string) {
  return createTestCaller({ userId: user.id, email: user.email, name: user.name, tenantId, businessId });
}

const owner = () => as(world.ramesh, world.tenant1.id, world.business1.id);

describe("isWebMcpDisabledByOperator", () => {
  it("is off unless WEBMCP_DISABLED says on", () => {
    expect(isWebMcpDisabledByOperator({})).toBe(false);
    expect(isWebMcpDisabledByOperator({ WEBMCP_DISABLED: "" })).toBe(false);
    expect(isWebMcpDisabledByOperator({ WEBMCP_DISABLED: "false" })).toBe(false);
    expect(isWebMcpDisabledByOperator({ WEBMCP_DISABLED: "0" })).toBe(false);
    expect(isWebMcpDisabledByOperator({ WEBMCP_DISABLED: "maybe" })).toBe(false);
  });

  it("accepts the usual spellings of on, case-insensitively", () => {
    for (const value of ["true", "TRUE", "1", "yes", "on", " true "]) {
      expect(isWebMcpDisabledByOperator({ WEBMCP_DISABLED: value }), value).toBe(true);
    }
  });

  it("has a message the agent and the user can read", () => {
    expect(WEBMCP_DISABLED_MESSAGE).toMatch(/disabled on this server/);
  });
});

describe("shouldRefuseAgentRequest (the HTTP layer's second line of defence)", () => {
  const agent = new Headers({ "x-hisaabo-agent": "webmcp" });
  const mcp = new Headers({ "x-client-type": "mcp" });
  const plain = new Headers({ "x-requested-with": "hisaabo" });
  const on = { WEBMCP_DISABLED: "true" };

  it("refuses a browser-agent call when the operator switched agents off", () => {
    expect(shouldRefuseAgentRequest(agent, on)).toBe(true);
  });

  it("lets everything through when the kill switch is off", () => {
    expect(shouldRefuseAgentRequest(agent, {})).toBe(false);
    expect(shouldRefuseAgentRequest(agent, { WEBMCP_DISABLED: "false" })).toBe(false);
  });

  it("never touches requests that do not carry the browser-agent marker", () => {
    expect(shouldRefuseAgentRequest(plain, on)).toBe(false);
    // The MCP server is a different, deliberately installed integration: not covered by this switch.
    expect(shouldRefuseAgentRequest(mcp, on)).toBe(false);
    expect(shouldRefuseAgentRequest(new Headers({ "x-hisaabo-client": "desktop" }), on)).toBe(false);
  });
});

describe("system.config (the operator kill switch, public)", () => {
  it("reports webmcpDisabled=false by default", async () => {
    const config = await createUnauthenticatedCaller().system.config();
    expect(config.webmcpDisabled).toBe(false);
  });

  it("reports webmcpDisabled=true when WEBMCP_DISABLED=true, without needing a session", async () => {
    process.env.WEBMCP_DISABLED = "true";
    const config = await createUnauthenticatedCaller().system.config();
    expect(config.webmcpDisabled).toBe(true);
    // The existing fields are untouched.
    expect(typeof config.multiTenant).toBe("boolean");
    expect(typeof config.signupOpen).toBe("boolean");
  });
});

describe("tenant.setWebMcpDisabled (the owner's organization-wide switch)", () => {
  it("defaults to enabled", async () => {
    const me = await owner().auth.me();
    expect(me.webmcpDisabled).toBe(false);
  });

  it("lets the owner turn agents off for the organization, and back on", async () => {
    await expect(owner().tenant.setWebMcpDisabled({ disabled: true })).resolves.toEqual({
      success: true,
      webmcpDisabled: true,
    });
    expect((await owner().auth.me()).webmcpDisabled).toBe(true);

    await owner().tenant.setWebMcpDisabled({ disabled: false });
    expect((await owner().auth.me()).webmcpDisabled).toBe(false);
  });

  it("applies to every member of the organization", async () => {
    await owner().tenant.setWebMcpDisabled({ disabled: true });
    try {
      const seller = as(world.suresh, world.tenant1.id, world.business1.id);
      expect((await seller.auth.me()).webmcpDisabled).toBe(true);
    } finally {
      await owner().tenant.setWebMcpDisabled({ disabled: false });
    }
  });

  it("refuses an admin: only the owner may change it", async () => {
    const admin = await createUser({ email: `webmcp-admin-${Date.now()}@example.in`, name: "Admin" });
    await addMember(world.tenant1.id, admin.id, "admin");
    await expect(
      as(admin, world.tenant1.id, world.business1.id).tenant.setWebMcpDisabled({ disabled: true }),
    ).rejects.toMatchObject({ code: "FORBIDDEN", message: expect.stringMatching(/Only the organization owner/) });
    expect((await owner().auth.me()).webmcpDisabled).toBe(false);
  });

  it("refuses a seller", async () => {
    await expect(
      as(world.suresh, world.tenant1.id, world.business1.id).tenant.setWebMcpDisabled({ disabled: true }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("refuses a caller who is not signed in", async () => {
    await expect(createUnauthenticatedCaller().tenant.setWebMcpDisabled({ disabled: true })).rejects.toBeDefined();
  });

  it("is per organization: another organization is unaffected", async () => {
    await owner().tenant.setWebMcpDisabled({ disabled: true });
    try {
      const other = as(world.kiran, world.tenant2.id, world.business2.id);
      expect((await other.auth.me()).webmcpDisabled).toBe(false);
      const [row] = await getControlDb().select({ d: tenants.webmcpDisabled }).from(tenants).where(eq(tenants.id, world.tenant2.id));
      expect(row.d).toBe(false);
    } finally {
      await owner().tenant.setWebMcpDisabled({ disabled: false });
    }
  });

  it("rejects a non-boolean value", async () => {
    await expect(
      // @ts-expect-error: deliberately wrong type
      owner().tenant.setWebMcpDisabled({ disabled: "yes" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("a signed-out auth.me reports false rather than leaking a tenant's setting", async () => {
    const me = await createUnauthenticatedCaller().auth.me();
    expect(me.webmcpDisabled).toBe(false);
    expect(me.user).toBeNull();
  });
});
