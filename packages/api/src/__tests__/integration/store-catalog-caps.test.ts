/**
 * store-catalog-caps.test.ts — GET /store/:slug/catalog.json bounds its
 * `search` and `category` query params (100 chars each) by silently truncating,
 * never by rejecting, so older storefronts and bookmarked URLs keep working.
 *
 * server.ts starts listening on import and does not export the Hono app, so this
 * boots the real server in a child process against the test database and talks
 * to it over HTTP.
 *
 * Discriminating design: the item name is 100 "a" followed by a suffix. A search
 * of 100 "a" + 100 "b" can only match it if the server truncated the search to
 * its first 100 characters; an un-truncated pattern would match nothing.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import { businesses } from "@hisaabo/db";
import { createTestWorld, createItem, type TestWorld } from "../helpers/fixtures.js";
import { truncateAllTables, closeTestDb, getTenantTestDb } from "../helpers/test-db.js";

const apiDir = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const SLUG = "catalog-caps-shop";
const A100 = "a".repeat(100);
const C100 = "c".repeat(100);

let world: TestWorld;
let child: ChildProcess | undefined;
let base = "";
let log = "";

function freePort(): Promise<number> {
  return new Promise((ok, fail) => {
    const s = createServer();
    s.once("error", fail);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address() as { port: number };
      s.close(() => ok(port));
    });
  });
}

async function waitUntilUp(port: number, deadline: number): Promise<void> {
  while (Date.now() < deadline) {
    if (child?.exitCode !== null && child?.exitCode !== undefined) {
      throw new Error(`API server exited early (code ${child.exitCode}):\n${log.slice(-1500)}`);
    }
    try {
      const r = await fetch(`http://127.0.0.1:${port}/health`);
      if (r.status < 500) return;
    } catch {
      /* not listening yet */
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`API server did not start in time:\n${log.slice(-1500)}`);
}

async function catalog(query: Record<string, string>) {
  const qs = new URLSearchParams(query).toString();
  const res = await fetch(`${base}/store/${SLUG}/catalog.json?${qs}`);
  const body = (await res.json()) as { items?: Array<{ name: string; category: string | null }>; total?: number; error?: string };
  return { status: res.status, body };
}

beforeAll(async () => {
  world = await createTestWorld();
  const db = getTenantTestDb();
  await db.update(businesses)
    .set({ storeSlug: SLUG, storeEnabled: true })
    .where(eq(businesses.id, world.business1.id));
  await createItem(db, world.business1.id, {
    name: `${A100}-widget`, category: C100, storeEnabled: true, salePrice: "10.00",
  });
  await createItem(db, world.business1.id, {
    name: "Other thing", category: "misc", storeEnabled: true, salePrice: "5.00",
  });

  const port = await freePort();
  base = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, ["--import", "tsx", "src/server.ts"], {
    cwd: apiDir,
    env: {
      ...process.env,
      PORT: String(port),
      CORS_ORIGINS: "http://localhost:5173",
      MULTI_TENANT: "false",
      NODE_ENV: "test",
      NOTIFICATIONS_WORKER: "false",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.on("data", (d) => { log += String(d); });
  child.stderr?.on("data", (d) => { log += String(d); });
  await waitUntilUp(port, Date.now() + 40_000);
}, 60_000);

afterAll(async () => {
  child?.kill("SIGKILL");
  await truncateAllTables();
  await closeTestDb();
});

describe("catalog.json search/category caps", () => {
  it("baseline: a search within the cap matches and the others are filtered out", async () => {
    const r = await catalog({ search: A100 });
    expect(r.status).toBe(200);
    expect(r.body.items?.map((i) => i.name)).toEqual([`${A100}-widget`]);
  });

  it("a search longer than 100 chars is truncated, not rejected: 200 and matches the first 100 chars", async () => {
    const r = await catalog({ search: A100 + "b".repeat(100) });
    expect(r.status).toBe(200);
    expect(r.body.items?.map((i) => i.name)).toEqual([`${A100}-widget`]);
  });

  it("a search of exactly 100 chars that does not match still returns an empty 200 (no truncation effect)", async () => {
    const r = await catalog({ search: "a".repeat(99) + "b" });
    expect(r.status).toBe(200);
    expect(r.body.items).toEqual([]);
  });

  it("a very long search (5000 chars) is a 200, not an error", async () => {
    const r = await catalog({ search: "z".repeat(5000) });
    expect(r.status).toBe(200);
    expect(r.body.items).toEqual([]);
  });

  it("a category longer than 100 chars is truncated, not rejected", async () => {
    const r = await catalog({ category: C100 + "x".repeat(150) });
    expect(r.status).toBe(200);
    expect(r.body.items?.map((i) => i.category)).toEqual([C100]);
  });

  it("a category within the cap still filters exactly", async () => {
    const r = await catalog({ category: "misc" });
    expect(r.status).toBe(200);
    expect(r.body.items?.map((i) => i.name)).toEqual(["Other thing"]);
  });

  it("no search or category returns the whole catalog", async () => {
    const r = await catalog({});
    expect(r.status).toBe(200);
    expect(r.body.total).toBe(2);
  });
});
