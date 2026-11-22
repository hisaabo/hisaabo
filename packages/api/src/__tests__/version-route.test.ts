/**
 * version-route.test.ts — GET /api/version, the public endpoint that
 * release.yml's `wait-for-api` job polls before it lets the web/store deploy
 * go to production.
 *
 * server.ts starts listening on import, so (as in store-public-cors.test.ts)
 * the real route factory is mounted on a throwaway Hono app. No database.
 */
import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { registerVersionRoute } from "../http/version.js";
import { buildInfo } from "../lib/build-info.js";

function app(info?: { version: string }) {
  const a = new Hono();
  registerVersionRoute(a, info);
  return a;
}

describe("GET /api/version", () => {
  it("returns exactly { version } with no leading v, and nothing else", async () => {
    const res = await app({ version: "0.10.1" }).request("/api/version");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/application\/json/);
    expect(await res.json()).toEqual({ version: "0.10.1" });
  });

  it("reports the running build by default (the string release.yml compares to the tag)", async () => {
    const res = await app().request("/api/version");
    const body = (await res.json()) as { version: string };
    expect(body).toEqual({ version: buildInfo.version });
    expect(body.version).not.toMatch(/^v/);
  });

  it("keeps a pre-release suffix so v0.10.1-rc.1 can be matched exactly", async () => {
    const res = await app({ version: "0.10.1-rc.1" }).request("/api/version");
    expect(await res.json()).toEqual({ version: "0.10.1-rc.1" });
  });

  it("is never cacheable: a stale answer would open or hold the deploy gate wrongly", async () => {
    const res = await app({ version: "0.10.1" }).request("/api/version");
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("is read-only: other methods are not routed", async () => {
    const res = await app({ version: "0.10.1" }).request("/api/version", { method: "POST" });
    expect(res.status).toBe(404);
  });
});
