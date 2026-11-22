/**
 * cors-agent-header.test.ts — the credentialed CORS policy lets a cross-origin
 * web build send the WebMCP attribution header, and nothing else changed.
 */
import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { createApiCors } from "../lib/cors.js";

const APP_ORIGIN = "https://app.example.com";

function buildApp() {
  const app = new Hono();
  app.use("*", createApiCors([APP_ORIGIN]));
  app.all("/api/trpc/*", (c) => c.json({ ok: true }));
  return app;
}

async function preflight(requestHeaders: string) {
  const res = await buildApp().request("/api/trpc/party.create", {
    method: "OPTIONS",
    headers: {
      Origin: APP_ORIGIN,
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": requestHeaders,
    },
  });
  const allowed = (res.headers.get("access-control-allow-headers") ?? "").toLowerCase().split(/\s*,\s*/);
  return { res, allowed };
}

describe("credentialed CORS and the agent header", () => {
  it("allows X-Hisaabo-Agent on a preflighted tRPC request", async () => {
    const { res, allowed } = await preflight("content-type,x-business-id,x-hisaabo-agent,x-requested-with");
    expect(res.status).toBe(204);
    expect(allowed).toContain("x-hisaabo-agent");
    expect(res.headers.get("access-control-allow-credentials")).toBe("true");
    expect(res.headers.get("access-control-allow-origin")).toBe(APP_ORIGIN);
  });

  it("keeps the headers it already allowed, including x-hisaabo-client", async () => {
    const { allowed } = await preflight("x-hisaabo-client");
    for (const header of ["content-type", "x-business-id", "authorization", "x-requested-with", "x-hisaabo-client"]) {
      expect(allowed).toContain(header);
    }
  });

  it("does not allow an arbitrary custom header", async () => {
    const { allowed } = await preflight("x-hisaabo-anything-else");
    expect(allowed).not.toContain("x-hisaabo-anything-else");
  });
});
