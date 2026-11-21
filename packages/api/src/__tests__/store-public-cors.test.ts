/**
 * store-public-cors.test.ts — the public, credential-less CORS policy for the
 * read-only storefront endpoints, and proof that it does not widen the
 * credentialed policy anywhere else.
 *
 * server.ts starts listening on import, so it cannot be imported in tests. The
 * policy lives in lib/cors.ts; this file mounts the very same middleware
 * factories server.ts uses (`createApiSecureHeaders`, `createApiCors`) on a
 * throwaway Hono app, in the same order (secure headers first, CORS next), with
 * stub handlers that return raw `Response`s like the real logo/image handlers.
 * NO database, NO tRPC.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import { createApiCors, createApiSecureHeaders, isPublicStoreReadRequest } from "../lib/cors.js";
import { LOGO_SAFE_HEADERS, PUBLIC_IMAGE_SAFE_HEADERS } from "../lib/logo-response.js";

// Mirrors server.ts: CORS_ORIGINS plus the first-party Tauri webview origins.
const APP_ORIGIN = "https://app.example.com";
const TAURI_ORIGIN = "http://tauri.localhost";
const ALLOWED = [APP_ORIGIN, "http://localhost:5173", TAURI_ORIGIN];
const EVIL = "https://evil.example.org";

function buildApp() {
  const app = new Hono();
  app.use("*", createApiSecureHeaders());
  app.use("*", createApiCors(ALLOWED));

  // A handler error on a public path (rate limit / unknown slug) must be readable too.
  // Registered first so these specific slugs win over the generic routes below.
  app.get("/store/limited/catalog.json", (c) => c.json({ error: "Too many requests" }, 429));
  app.get("/store/missing/meta.json", (c) => c.json({ error: "Store not found" }, 404));

  // Public store reads.
  app.get("/store/:slug/catalog.json", (c) => c.json({ items: [] }));
  app.get("/store/:slug/meta.json", (c) => c.json({ name: "Shop" }));
  app.get("/store/:slug/logo", () =>
    new Response(new Uint8Array([1]), { headers: { ...PUBLIC_IMAGE_SAFE_HEADERS, "Content-Type": "image/png" } }));
  app.get("/store/:slug/items/:itemId/images/:imageId", () =>
    new Response(new Uint8Array([1]), { headers: { ...PUBLIC_IMAGE_SAFE_HEADERS, "Content-Type": "image/png" } }));
  app.get("/store/:slug/og.png", () => new Response(new Uint8Array([1]), { headers: { "Content-Type": "image/png" } }));

  // Everything else stays credentialed.
  app.get("/store/:slug", (c) => c.html("<html></html>"));
  app.post("/store/:slug/identify", (c) => c.json({ ok: true }));
  app.post("/store/:slug/otp/send", (c) => c.json({ ok: true }));
  app.post("/store/:slug/otp/verify", (c) => c.json({ ok: true }));
  app.post("/store/:slug/order", (c) => c.json({ ok: true }));
  app.all("/api/trpc/*", (c) => c.json({ ok: true }));
  app.get("/api/invoices/:id/pdf", (c) => c.json({ ok: true }));
  // The authenticated logo keeps the shared default (LOGO_SAFE_HEADERS).
  app.get("/api/businesses/:id/logo", () =>
    new Response(new Uint8Array([1]), { headers: { ...LOGO_SAFE_HEADERS, "Content-Type": "image/png" } }));
  return app;
}

const PUBLIC_PATHS = [
  "/store/acme/catalog.json",
  "/store/acme/catalog.json?page=2&search=tea",
  "/store/acme/meta.json",
  "/store/acme/logo",
  "/store/acme/logo?v=123",
  "/store/acme/og.png",
  "/store/acme/items/item-1/images/img-1",
  "/store/acme/items/item-1/images/img-1?v=99",
];

const req = (app: Hono, method: string, path: string, origin?: string, extra: Record<string, string> = {}) =>
  app.request(path, { method, headers: { ...(origin ? { Origin: origin } : {}), ...extra } });

/** Header names of every Access-Control-* header on the response. */
const corsHeaderNames = (res: Response) =>
  [...res.headers.keys()].filter((h) => h.startsWith("access-control-")).sort();

const varyTokens = (res: Response) =>
  (res.headers.get("vary") ?? "").split(",").map((t) => t.trim().toLowerCase()).filter(Boolean);

describe("public store reads: Access-Control-Allow-Origin * and no credentials", () => {
  const origins: Array<[string, string | undefined]> = [
    ["an arbitrary third-party origin", EVIL],
    ["an origin that is in CORS_ORIGINS", APP_ORIGIN],
    ["a Tauri desktop origin", TAURI_ORIGIN],
    ["no Origin header (an <img> no-cors load, curl)", undefined],
  ];

  for (const path of PUBLIC_PATHS) {
    for (const [label, origin] of origins) {
      it(`GET ${path} from ${label}`, async () => {
        const res = await req(buildApp(), "GET", path, origin);
        expect(res.status).toBe(200);
        expect(res.headers.get("access-control-allow-origin")).toBe("*");
        expect(res.headers.get("access-control-allow-credentials")).toBeNull();
        // The response is identical for every Origin, so it must not vary by it.
        expect(varyTokens(res)).not.toContain("origin");
        expect(corsHeaderNames(res)).toEqual(["access-control-allow-origin"]);
      });
    }
  }

  it("HEAD gets the same headers", async () => {
    const res = await req(buildApp(), "HEAD", "/store/acme/catalog.json", EVIL);
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("access-control-allow-credentials")).toBeNull();
  });

  it("error responses on a public path (429, 404) carry the wildcard too, so a site can read the status", async () => {
    const app = buildApp();
    for (const path of ["/store/limited/catalog.json", "/store/missing/meta.json"]) {
      const res = await req(app, "GET", path, EVIL);
      expect([429, 404]).toContain(res.status);
      expect(res.headers.get("access-control-allow-origin")).toBe("*");
      expect(res.headers.get("access-control-allow-credentials")).toBeNull();
    }
  });

  it("preflight (OPTIONS) is answered with the wildcard, GET/HEAD only, and no credentials", async () => {
    const res = await req(buildApp(), "OPTIONS", "/store/acme/catalog.json", EVIL, {
      "Access-Control-Request-Method": "GET",
      "Access-Control-Request-Headers": "if-none-match",
    });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("access-control-allow-credentials")).toBeNull();
    expect(res.headers.get("access-control-allow-methods")).toBe("GET,HEAD,OPTIONS");
    expect(res.headers.get("access-control-allow-methods")).not.toMatch(/POST/);
    expect(res.headers.get("access-control-allow-headers")).toBe("Content-Type,If-None-Match");
    expect(varyTokens(res)).not.toContain("origin");
  });

  it("preflight never echoes requested headers: Authorization / x-business-id are not granted", async () => {
    const res = await req(buildApp(), "OPTIONS", "/store/acme/catalog.json", EVIL, {
      "Access-Control-Request-Method": "GET",
      "Access-Control-Request-Headers": "authorization,x-business-id",
    });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    const allowed = (res.headers.get("access-control-allow-headers") ?? "").toLowerCase();
    expect(allowed).not.toContain("authorization");
    expect(allowed).not.toContain("x-business-id");
    expect(allowed).toBe("content-type,if-none-match");
    expect(res.headers.get("access-control-allow-credentials")).toBeNull();
  });

  it("a listed origin gets the wildcard here, never an echoed origin", async () => {
    const res = await req(buildApp(), "GET", "/store/acme/catalog.json", APP_ORIGIN);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("access-control-allow-origin")).not.toBe(APP_ORIGIN);
  });

  it("a non-safe method on a public path does not get the public policy", async () => {
    const res = await req(buildApp(), "POST", "/store/acme/catalog.json", EVIL);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
    expect(res.headers.get("access-control-allow-origin")).not.toBe("*");
    const listed = await req(buildApp(), "POST", "/store/acme/catalog.json", APP_ORIGIN);
    expect(listed.headers.get("access-control-allow-origin")).toBe(APP_ORIGIN);
    expect(listed.headers.get("access-control-allow-credentials")).toBe("true");
  });
});

describe("everything else keeps the credentialed policy (unchanged)", () => {
  const CREDENTIALED: Array<[string, string, string]> = [
    ["POST", "/store/acme/identify", "store identify"],
    ["POST", "/store/acme/otp/send", "store otp/send"],
    ["POST", "/store/acme/otp/verify", "store otp/verify"],
    ["POST", "/store/acme/order", "store order"],
    ["GET", "/store/acme", "store HTML shell"],
    ["POST", "/api/trpc/auth.me", "tRPC POST"],
    ["GET", "/api/trpc/invoice.list", "tRPC GET"],
    ["GET", "/api/invoices/inv-1/pdf", "REST pdf"],
    ["GET", "/api/businesses/biz-1/logo", "authenticated logo"],
  ];

  for (const [method, path, label] of CREDENTIALED) {
    it(`${label} (${method} ${path}): allowed origin is echoed with credentials`, async () => {
      for (const origin of [APP_ORIGIN, TAURI_ORIGIN]) {
        const res = await req(buildApp(), method, path, origin);
        expect(res.headers.get("access-control-allow-origin")).toBe(origin);
        expect(res.headers.get("access-control-allow-credentials")).toBe("true");
        expect(varyTokens(res)).toContain("origin");
      }
    });

    it(`${label}: a disallowed origin gets no Access-Control-Allow-Origin (the browser refuses it)`, async () => {
      const res = await req(buildApp(), method, path, EVIL);
      expect(res.headers.get("access-control-allow-origin")).toBeNull();
      // Hono's cors() has always sent Allow-Credentials: true even without a
      // matching Allow-Origin; it is inert without one and deliberately not
      // pinned here.
    });
  }

  it("preflight on a store POST route stays credentialed for an allowed origin, refused for others", async () => {
    const preflight = (origin: string) =>
      req(buildApp(), "OPTIONS", "/store/acme/order", origin, {
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type,x-requested-with",
      });
    const ok = await preflight(APP_ORIGIN);
    expect(ok.status).toBe(204);
    expect(ok.headers.get("access-control-allow-origin")).toBe(APP_ORIGIN);
    expect(ok.headers.get("access-control-allow-credentials")).toBe("true");
    expect(ok.headers.get("access-control-allow-methods")).toBe("GET,POST,OPTIONS");
    expect(ok.headers.get("access-control-allow-headers")).toContain("X-Requested-With");

    const bad = await preflight(EVIL);
    expect(bad.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("preflight on tRPC stays credentialed", async () => {
    const res = await req(buildApp(), "OPTIONS", "/api/trpc/auth.me", APP_ORIGIN, {
      "Access-Control-Request-Method": "POST",
    });
    expect(res.headers.get("access-control-allow-origin")).toBe(APP_ORIGIN);
    expect(res.headers.get("access-control-allow-credentials")).toBe("true");
  });
});

describe("Cross-Origin-Resource-Policy on the wire", () => {
  it("public store reads (logo, item image, og.png, catalog, meta) are cross-origin", async () => {
    for (const path of PUBLIC_PATHS) {
      const res = await req(buildApp(), "GET", path, EVIL);
      expect(res.headers.get("cross-origin-resource-policy"), path).toBe("cross-origin");
    }
  });

  it("the store logo and item image keep their image-safe headers", async () => {
    for (const path of ["/store/acme/logo", "/store/acme/items/i/images/j"]) {
      const res = await req(buildApp(), "GET", path, EVIL);
      expect(res.headers.get("x-content-type-options")).toBe("nosniff");
      expect(res.headers.get("content-security-policy")).toBe(LOGO_SAFE_HEADERS["Content-Security-Policy"]);
    }
  });

  it("every other route keeps Hono's same-origin CORP, including the authenticated logo", async () => {
    for (const [method, path] of [
      ["GET", "/store/acme"],
      ["POST", "/store/acme/order"],
      ["GET", "/api/trpc/invoice.list"],
      ["GET", "/api/invoices/inv-1/pdf"],
      ["GET", "/api/businesses/biz-1/logo"],
    ] as const) {
      const res = await req(buildApp(), method, path, APP_ORIGIN);
      expect(res.headers.get("cross-origin-resource-policy"), path).toBe("same-origin");
    }
  });

  it("the other secure headers still apply on public store reads", async () => {
    const res = await req(buildApp(), "GET", "/store/acme/catalog.json", EVIL);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("x-frame-options")).toBe("SAMEORIGIN");
    expect(res.headers.get("strict-transport-security")).toBeTruthy();
  });
});

describe("isPublicStoreReadRequest", () => {
  it("compares the method exactly: a lower-case method is not a public read (falls to the credentialed policy)", () => {
    // Hono's cors() tests `=== "OPTIONS"` exactly; folding case here could make
    // the two disagree. (Request normalises standard methods, so this only
    // matters for direct callers.)
    for (const m of ["get", "head", "options", "Get", "Options"]) {
      expect(isPublicStoreReadRequest(m, "/store/acme/catalog.json"), m).toBe(false);
    }
  });

  it("matches exactly the five public read endpoints, on safe methods", () => {
    for (const p of [
      "/store/acme/catalog.json",
      "/store/acme/meta.json",
      "/store/acme/logo",
      "/store/acme/og.png",
      "/store/acme/items/i1/images/m1",
    ]) {
      expect(isPublicStoreReadRequest("GET", p), p).toBe(true);
      expect(isPublicStoreReadRequest("HEAD", p), p).toBe(true);
      expect(isPublicStoreReadRequest("OPTIONS", p), p).toBe(true);
      expect(isPublicStoreReadRequest("POST", p), p).toBe(false);
      expect(isPublicStoreReadRequest("PUT", p), p).toBe(false);
      expect(isPublicStoreReadRequest("DELETE", p), p).toBe(false);
    }
  });

  it("does not match the shell, POST routes, other prefixes or near-misses", () => {
    for (const p of [
      "/store",
      "/store/",
      "/store/acme",
      "/store/acme/",
      "/store/acme/order",
      "/store/acme/identify",
      "/store/acme/otp/send",
      "/store/acme/otp/verify",
      "/store/acme/catalog.json/",
      "/store/acme/catalog.jsonx",
      "/store/acme/CATALOG.JSON",
      "/store//catalog.json",
      "/store/a/b/catalog.json",
      "/store/acme/logo/extra",
      "/store/acme/items/i1/images",
      "/store/acme/items/i1/images/m1/extra",
      "/store/acme/items//images/m1",
      "/store/acme/items/i1/other/m1",
      "/api/store/acme/catalog.json",
      "/api/trpc/store.settings",
      "/api/businesses/b1/logo",
      "/api/items/i1/images/m1",
      "/ops/store/acme/catalog.json",
      "/acme/catalog.json",
    ]) {
      expect(isPublicStoreReadRequest("GET", p), p).toBe(false);
    }
  });
});

/**
 * Route-drift guard. server.ts starts listening on import, so the route table
 * cannot be inspected at run time; instead scan its source for the routes
 * registered under /store/ and check them against the matcher. A new GET
 * endpoint under /store/ must NOT silently become (or stay out of) the public
 * cross-origin policy: this fails until the allow-list in lib/cors.ts and the
 * list below are updated together, on purpose.
 */
describe("route drift guard (static scan of server.ts)", () => {
  const source = readFileSync(fileURLToPath(new URL("../server.ts", import.meta.url)), "utf8");

  // The only GET endpoints that may be public + cross-origin readable.
  const EXPECTED_PUBLIC_GETS = [
    "/store/:slug/catalog.json",
    "/store/:slug/items/:itemId/images/:imageId",
    "/store/:slug/logo",
    "/store/:slug/meta.json",
    "/store/:slug/og.png",
  ];

  const SAMPLES: Record<string, string> = { slug: "acme", itemId: "item1", imageId: "img1" };
  const sample = (routePath: string) =>
    routePath.replace(/:([A-Za-z]\w*)/g, (_, name: string) => SAMPLES[name] ?? "x1").replace(/\*/g, "x1");

  const storeRoutes = [
    ...source.matchAll(/\bapp\.(get|post|put|patch|delete|all)\(\s*"(\/store(?:\/[^"]*)?)"/g),
  ].map((m) => ({ method: m[1]!, path: m[2]! }));

  it("the scan understands how server.ts registers routes (else this guard is blind)", () => {
    // Forms the regex cannot see: dynamic paths, app.on(), sub-apps via route()/mount().
    expect(source).not.toMatch(/\bapp\.(get|post|put|patch|delete|all)\(\s*(?!["\s])/);
    expect(source).not.toMatch(/\bapp\.(on|route|mount|basePath)\(/);
    // Sanity: it finds known routes of each kind.
    const found = storeRoutes.map((r) => `${r.method} ${r.path}`);
    expect(found).toContain("get /store/:slug");
    expect(found).toContain("post /store/:slug/order");
    for (const p of EXPECTED_PUBLIC_GETS) expect(found, p).toContain(`get ${p}`);
  });

  it("exactly the five expected GET routes under /store/ get the public policy", () => {
    const getLike = storeRoutes.filter((r) => r.method === "get" || r.method === "all");
    const isPublic = (path: string) => isPublicStoreReadRequest("GET", sample(path));
    expect(getLike.filter((r) => isPublic(r.path)).map((r) => r.path).sort()).toEqual(
      [...EXPECTED_PUBLIC_GETS].sort(),
    );
    // Every other registered GET (e.g. the /store/:slug HTML shell) is credentialed.
    for (const r of getLike.filter((r) => !EXPECTED_PUBLIC_GETS.includes(r.path))) {
      expect(isPublic(r.path), r.path).toBe(false);
    }
  });

  it("no state-changing store route is ever matched, whatever its path", () => {
    const writes = storeRoutes.filter((r) => r.method !== "get");
    expect(writes.length).toBeGreaterThan(0);
    for (const r of writes) {
      expect(isPublicStoreReadRequest(r.method.toUpperCase(), sample(r.path)), `${r.method} ${r.path}`).toBe(false);
    }
  });
});
