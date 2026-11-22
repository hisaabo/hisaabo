/**
 * server-version.test.ts — GET /api/version on the REAL server (src/server.ts),
 * not a throwaway Hono app: it covers where the route is mounted among the
 * security-header, CORS, CSRF and not-found middleware, and that the route is
 * reachable the way release.yml's `wait-for-api` reaches it (no cookie, no
 * header, no database).
 *
 * server.ts listens on import, so it is booted as a child process on a free
 * port, with a database URL that nothing listens on: the routes under test
 * never touch the database, and booting without one is the point (the endpoint
 * must answer while the database is down). version-route.test.ts keeps the
 * fast, in-process checks of the route factory itself.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { resolve } from "node:path";

const API_DIR = resolve(__dirname, "../..");
const BAKED_VERSION = "9.8.7";

async function freePort(): Promise<number> {
  return new Promise((ok, fail) => {
    const s = createServer();
    s.once("error", fail);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address() as { port: number };
      s.close(() => ok(port));
    });
  });
}

interface Booted {
  base: string;
  stop: () => void;
}

async function boot(extraEnv: Record<string, string> = {}): Promise<Booted> {
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  let log = "";
  let child: ChildProcess | undefined = spawn(process.execPath, ["--import", "tsx", "src/server.ts"], {
    cwd: API_DIR,
    // Explicit env: nothing from the test run (its databases, its VITEST flag) leaks in.
    env: {
      PATH: process.env.PATH ?? "",
      HOME: process.env.HOME ?? "",
      NODE_ENV: "test",
      LOG_LEVEL: "error",
      PORT: String(port),
      DATABASE_URL: "postgres://nobody:nothing@127.0.0.1:1/none",
      CORS_ORIGINS: "http://localhost:5173",
      HISAABO_VERSION: BAKED_VERSION,
      ...extraEnv,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.on("data", (d) => (log += d));
  child.stderr?.on("data", (d) => (log += d));
  let exited = false;
  child.once("exit", () => (exited = true));

  const stop = () => {
    if (child && !exited) child.kill("SIGKILL");
    child = undefined;
  };

  const deadline = Date.now() + 40_000;
  for (;;) {
    if (exited) throw new Error(`server exited during boot:\n${log}`);
    try {
      if ((await fetch(`${base}/health`)).status === 200) return { base, stop };
    } catch {
      // not listening yet
    }
    if (Date.now() > deadline) {
      stop();
      throw new Error(`server did not start in time:\n${log}`);
    }
    await new Promise((r) => setTimeout(r, 200));
  }
}

describe("GET /api/version on the real server", () => {
  let server: Booted;
  beforeAll(async () => {
    server = await boot();
  }, 60_000);
  afterAll(() => server?.stop());

  it("answers { version } (the baked release version) to a bare request: no cookie, no CSRF header, no database", async () => {
    const res = await fetch(`${server.base}/api/version`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/application\/json/);
    expect(await res.json()).toEqual({ version: BAKED_VERSION });
  });

  it("is uncacheable, sets no cookie, and still carries the server's security headers", async () => {
    const res = await fetch(`${server.base}/api/version`);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("x-request-id")).toBeTruthy();
  });

  it("leaves /health version-free (the documented invariant) and unknown /api paths a JSON 404", async () => {
    const health = await fetch(`${server.base}/health`);
    expect(await health.text()).not.toContain(BAKED_VERSION);
    const unknown = await fetch(`${server.base}/api/definitely-not-a-route`);
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toEqual({ error: "Not found" });
  });
});

describe("EXPOSE_VERSION=false on the real server", () => {
  let server: Booted;
  beforeAll(async () => {
    server = await boot({ EXPOSE_VERSION: "false" });
  }, 60_000);
  afterAll(() => server?.stop());

  it("answers the server's own JSON 404 and never mentions the version", async () => {
    const res = await fetch(`${server.base}/api/version`);
    expect(res.status).toBe(404);
    const body = await res.text();
    expect(JSON.parse(body)).toEqual({ error: "Not found" });
    expect(body).not.toContain(BAKED_VERSION);
  });
});
