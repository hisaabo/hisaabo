/**
 * global-setup.ts — Authenticate once per worker stack, persist each session.
 *
 * Every Playwright worker has its own database, API and web server (see
 * harness/topology.cjs). For each of them this registers a test user via the
 * auth.register API (no password UI exists), creates a business via tRPC, seeds
 * one party and one item, then saves the browser storage state (session cookie)
 * so all tests on that worker reuse the session without logging in. The seeded
 * state is the same on every worker — and the same as the single shared state
 * this suite used before workers were isolated (helpers/standard-seed.ts); the
 * guard steps at the end fail if either ever stops being true.
 */
import { test as setup, expect, type APIRequestContext, type Browser } from "@playwright/test";
import fs from "fs";
import { registerUser, sessionStorageState, type GlobalSeed } from "./helpers/seed";
import { stubThirdParty } from "./helpers/fixtures";
import { apiUrl, authDir, baseUrl, ownerStorageStatePath } from "./helpers/worker";
import {
  STANDARD_BUSINESS,
  STANDARD_ITEM,
  STANDARD_PARTY,
  STANDARD_PASSWORD,
  STANDARD_USER_NAME,
} from "./helpers/standard-seed";
import { resolveWorkers } from "./harness/topology.cjs";

interface WorkerState {
  k: number;
  email: string;
  seed: GlobalSeed;
}

async function trpcMutation<T>(
  request: APIRequestContext,
  k: number,
  cookie: string,
  procedure: string,
  input: unknown,
  businessId?: string,
): Promise<T> {
  const res = await request.post(`${apiUrl(k)}/api/trpc/${procedure}`, {
    headers: {
      "Content-Type": "application/json",
      "X-Requested-With": "hisaabo",
      Cookie: cookie,
      ...(businessId ? { "x-business-id": businessId } : {}),
    },
    data: { json: input },
  });
  expect(res.ok(), `${procedure} failed: ${await res.text()}`).toBeTruthy();
  const body = await res.json();
  return (body.result?.data?.json ?? body.result?.data) as T;
}

async function trpcQuery<T>(
  request: APIRequestContext,
  k: number,
  cookie: string,
  procedure: string,
  input?: unknown,
  businessId?: string,
): Promise<T> {
  const query = input === undefined ? "" : `?input=${encodeURIComponent(JSON.stringify({ json: input }))}`;
  const res = await request.get(`${apiUrl(k)}/api/trpc/${procedure}${query}`, {
    headers: {
      "X-Requested-With": "hisaabo",
      Cookie: cookie,
      ...(businessId ? { "x-business-id": businessId } : {}),
    },
  });
  expect(res.ok(), `${procedure} failed: ${await res.text()}`).toBeTruthy();
  const body = await res.json();
  return (body.result?.data?.json ?? body.result?.data) as T;
}

/** Seed worker `k`'s stack. Mirrors, step for step, what the single shared setup used to do. */
async function seedWorker(k: number, request: APIRequestContext, browser: Browser): Promise<WorkerState> {
  fs.mkdirSync(authDir(k), { recursive: true });

  const email = `e2e-${Date.now()}@test.hisaabo.in`;

  // ── Step 1: Create the user + session via the API ─────────────
  // The UI has no password sign-in any more and magic links need an inbox, so
  // we register through auth.register (still supported server-side) and reuse
  // its session. The first user on a FRESH self-hosted DB becomes the owner
  // without an invitation; every worker's database is a fresh clone.
  const { sessionToken } = await registerUser(apiUrl(k), {
    email,
    password: STANDARD_PASSWORD,
    name: STANDARD_USER_NAME,
  });
  const cookie = `session_id=${sessionToken}`;

  // ── Step 2: Create business via API ───────────────────────────
  const business = await trpcMutation<{ id: string }>(request, k, cookie, "business.create", {
    ...STANDARD_BUSINESS,
    email,
  });
  const businessId = business.id;

  // ── Step 3: Seed a standard party + item ──────────────────────
  const party = await trpcMutation<{ id: string }>(request, k, cookie, "party.create", STANDARD_PARTY, businessId);
  const item = await trpcMutation<{ id: string }>(request, k, cookie, "item.create", STANDARD_ITEM, businessId);

  // Write seed IDs for tests to read
  const seed: GlobalSeed = {
    businessId,
    partyId: party.id,
    itemId: item.id,
    partyName: STANDARD_PARTY.name,
    itemName: STANDARD_ITEM.name,
  };
  fs.writeFileSync(`${authDir(k)}/seed.json`, JSON.stringify(seed, null, 2));

  // ── Step 4: Verify we're in the main app ──────────────────────
  // Load the app on this worker's origin and save the state from there, so it
  // carries what the app itself stores for that origin, as before.
  const context = await browser.newContext({
    baseURL: baseUrl(k),
    storageState: sessionStorageState(sessionToken),
  });
  try {
    await stubThirdParty(context);
    const page = await context.newPage();
    await page.goto("/invoices");
    await expect(page.locator("h1").first()).toContainText("Invoices", { timeout: 10_000 });
    await context.storageState({ path: ownerStorageStatePath(k) });
  } finally {
    await context.close();
  }

  return { k, email, seed };
}

setup("authenticate and seed every worker stack", async ({ request, browser }) => {
  const workers = resolveWorkers();
  const states: WorkerState[] = [];
  for (let k = 0; k < workers; k++) {
    await setup.step(`seed worker ${k}`, async () => {
      states.push(await seedWorker(k, request, browser));
    });
  }

  // ── Guard: every worker holds exactly the standard state ──────
  // A fresh stack has one owner and one business, plus the standard party and item with the
  // standard fields — what a run of the old shared setup left behind. Read back
  // through the API (not from what was just sent), identically for every worker.
  for (const { k, email, seed } of states) {
    await setup.step(`verify worker ${k} seeded state`, async () => {
      const state = JSON.parse(fs.readFileSync(ownerStorageStatePath(k), "utf-8"));
      const cookie = state.cookies.map((c: { name: string; value: string }) => `${c.name}=${c.value}`).join("; ");

      const me = await trpcQuery<{ user: { email: string; name: string }; role: string }>(request, k, cookie, "auth.me");
      expect({ email: me.user.email, name: me.user.name, role: me.role }).toEqual({
        email,
        name: STANDARD_USER_NAME,
        role: "owner",
      });

      const businesses = await trpcQuery<Array<Record<string, unknown>>>(request, k, cookie, "business.list");
      expect(businesses).toHaveLength(1);
      expect(businesses[0]).toMatchObject({ id: seed.businessId, ...STANDARD_BUSINESS, email });

      const parties = await trpcQuery<{ data: Array<Record<string, unknown>> }>(
        request, k, cookie, "party.list", { page: 1, limit: 100 }, seed.businessId,
      );
      // business.create itself adds the "Walk-in Customer" party; that default plus
      // the standard one is all a fresh worker has.
      expect(parties.data.map((p) => p.name).sort()).toEqual([STANDARD_PARTY.name, "Walk-in Customer"]);
      expect(parties.data.find((p) => p.id === seed.partyId)).toMatchObject(STANDARD_PARTY);

      const items = await trpcQuery<{ data: Array<Record<string, unknown>> }>(
        request, k, cookie, "item.list", { page: 1, limit: 100 }, seed.businessId,
      );
      expect(items.data.map((i) => i.name)).toEqual([STANDARD_ITEM.name]);
      expect(items.data[0]).toMatchObject({ id: seed.itemId, ...STANDARD_ITEM });

      expect(seed.partyName).toBe("E2E Standard Customer");
      expect(seed.itemName).toBe("E2E Standard Product");
    });
  }
});
