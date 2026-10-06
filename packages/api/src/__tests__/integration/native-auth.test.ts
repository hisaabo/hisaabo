/**
 * native-auth.test.ts — system-browser handoff + PKCE (auth.nativeStart /
 * nativeRequestInfo / nativeAuthorize / nativeExchange).
 */
import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { createHash, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { nativeAuthRequests, sessions } from "@hisaabo/db";
import { createUser, createTenant, addMember } from "../helpers/fixtures.js";
import { getControlDb, truncateAllTables, closeTestDb } from "../helpers/test-db.js";
import { createTestContext } from "../helpers/test-context.js";
import { createCallerFactory } from "../../trpc.js";
import { appRouter } from "../../router.js";

const factory = createCallerFactory(appRouter);

type Client = "desktop" | "mobile" | "cli";

function publicCaller(client?: string) {
  return factory(createTestContext(client ? { headers: { "x-hisaabo-client": client } } : {}));
}

function authedCaller(
  user: { id: string; email: string; name: string | null },
  kind: "cookie" | "refresh" | "access" | null,
) {
  return factory(
    createTestContext({
      user,
      authTokenKind: kind,
      headers: { cookie: "session_id=x".padEnd(50, "x"), "x-requested-with": "hisaabo" },
    }),
  );
}

function pkce() {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

const state = () => randomBytes(24).toString("base64url");
const loopback = (port = 53124) => `http://127.0.0.1:${port}/callback`;

async function start(client: Client = "desktop", p = pkce()) {
  const redirectUri = client === "mobile"
    ? `${process.env.APP_URL || "http://localhost:5173"}/auth/native/callback`
    : loopback();
  const st = state();
  const res = await publicCaller().auth.nativeStart({
    client,
    redirectUri,
    codeChallenge: p.challenge,
    codeChallengeMethod: "S256",
    state: st,
  });
  return { ...res, ...p, state: st, redirectUri };
}

function parseRedirect(redirectUrl: string) {
  const u = new URL(redirectUrl);
  return { code: u.searchParams.get("code")!, state: u.searchParams.get("state")!, base: `${u.origin}${u.pathname}` };
}

let user: Awaited<ReturnType<typeof createUser>>;
let tenant: Awaited<ReturnType<typeof createTenant>>;
const db = getControlDb();

beforeAll(async () => {
  user = await createUser({ email: "native@vyapar.in", name: "Native User" });
  tenant = await createTenant({ name: "Native Org" });
  await addMember(tenant.id, user.id, "owner");
});

afterAll(async () => {
  await truncateAllTables();
  await closeTestDb();
});

describe("auth.nativeStart", () => {
  it("creates a request with a 10 minute TTL", async () => {
    const r = await start("desktop");
    expect(r.requestId).toMatch(/^[0-9a-f-]{36}$/);
    const ttl = r.expiresAt.getTime() - Date.now();
    expect(ttl).toBeGreaterThan(9 * 60_000);
    expect(ttl).toBeLessThanOrEqual(10 * 60_000);
  });

  it("accepts desktop/cli loopback and the mobile app link, rejects other redirect URIs", async () => {
    const p = pkce();
    const base = { codeChallenge: p.challenge, codeChallengeMethod: "S256" as const, state: state() };
    await expect(publicCaller().auth.nativeStart({ ...base, client: "cli", redirectUri: loopback(40000) })).resolves.toBeDefined();
    await start("mobile");

    const bad: Array<[Client, string]> = [
      ["desktop", "http://localhost:53124/callback"],
      ["desktop", "http://127.0.0.1:80/callback"],
      ["desktop", "https://evil.example/callback"],
      ["cli", "http://127.0.0.1:53124/steal"],
      ["mobile", loopback()],
      ["mobile", "https://evil.example/auth/native/callback"],
      ["mobile", "hisaabo://native"],
    ];
    for (const [client, redirectUri] of bad) {
      await expect(
        publicCaller().auth.nativeStart({ ...base, client, redirectUri }),
        `${client} ${redirectUri}`,
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    }
  });

  it("validates challenge, method and state shape", async () => {
    const good = { client: "desktop" as const, redirectUri: loopback(), codeChallenge: pkce().challenge, codeChallengeMethod: "S256" as const, state: state() };
    await expect(publicCaller().auth.nativeStart({ ...good, codeChallenge: "short" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(publicCaller().auth.nativeStart({ ...good, state: "tooshort" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      publicCaller().auth.nativeStart({ ...good, codeChallengeMethod: "plain" as unknown as "S256" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("deletes expired requests opportunistically", async () => {
    const old = await start("desktop");
    await db.update(nativeAuthRequests).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(nativeAuthRequests.id, old.requestId));
    await start("desktop");
    const rows = await db.select().from(nativeAuthRequests).where(eq(nativeAuthRequests.id, old.requestId));
    expect(rows).toHaveLength(0);
  });
});

describe("auth.nativeRequestInfo", () => {
  it("returns client and expiry for a live request", async () => {
    const r = await start("mobile");
    const info = await publicCaller().auth.nativeRequestInfo({ requestId: r.requestId });
    expect(info.client).toBe("mobile");
    expect(info.expiresAt).toBeInstanceOf(Date);
  });

  it("is NOT_FOUND for unknown, expired and consumed requests", async () => {
    await expect(
      publicCaller().auth.nativeRequestInfo({ requestId: "00000000-0000-4000-8000-000000000000" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    const expired = await start("desktop");
    await db.update(nativeAuthRequests).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(nativeAuthRequests.id, expired.requestId));
    await expect(publicCaller().auth.nativeRequestInfo({ requestId: expired.requestId })).rejects.toMatchObject({ code: "NOT_FOUND" });

    const consumed = await start("desktop");
    await db.update(nativeAuthRequests).set({ consumedAt: new Date() }).where(eq(nativeAuthRequests.id, consumed.requestId));
    await expect(publicCaller().auth.nativeRequestInfo({ requestId: consumed.requestId })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("auth.nativeAuthorize", () => {
  it("issues a one-time code redirect for a cookie web session and shortens the TTL to 2 minutes", async () => {
    const r = await start("desktop");
    const { redirectUrl } = await authedCaller(user, "cookie").auth.nativeAuthorize({ requestId: r.requestId });
    const parsed = parseRedirect(redirectUrl);
    // the redirect goes to exactly the redirect URI registered at nativeStart (no rewriting)
    expect(parsed.base).toBe(r.redirectUri);
    expect(parsed.state).toBe(r.state);
    expect(parsed.code).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const [row] = await db.select().from(nativeAuthRequests).where(eq(nativeAuthRequests.id, r.requestId));
    expect(row!.userId).toBe(user.id);
    expect(row!.authorizedAt).toBeInstanceOf(Date);
    // only the hash is stored
    expect(row!.codeHash).toBe(createHash("sha256").update(parsed.code).digest("hex"));
    expect(row!.codeHash).not.toBe(parsed.code);
    const ttl = row!.expiresAt.getTime() - Date.now();
    expect(ttl).toBeLessThanOrEqual(2 * 60_000);
    expect(ttl).toBeGreaterThan(60_000);
  });

  it("rejects bearer sessions, access tokens and API keys (non-cookie auth)", async () => {
    const r = await start("desktop");
    for (const kind of ["refresh", "access", null] as const) {
      await expect(
        authedCaller(user, kind).auth.nativeAuthorize({ requestId: r.requestId }),
        String(kind),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    const [row] = await db.select().from(nativeAuthRequests).where(eq(nativeAuthRequests.id, r.requestId));
    expect(row!.codeHash).toBeNull();
  });

  it("requires authentication", async () => {
    const r = await start("desktop");
    await expect(publicCaller().auth.nativeAuthorize({ requestId: r.requestId })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("re-authorizing an authorized or consumed request is NOT_FOUND; unknown and expired too", async () => {
    const r = await start("desktop");
    const caller = authedCaller(user, "cookie");
    await caller.auth.nativeAuthorize({ requestId: r.requestId });
    await expect(caller.auth.nativeAuthorize({ requestId: r.requestId })).rejects.toMatchObject({ code: "NOT_FOUND" });

    await expect(caller.auth.nativeAuthorize({ requestId: "00000000-0000-4000-8000-000000000000" })).rejects.toMatchObject({ code: "NOT_FOUND" });

    const e = await start("desktop");
    await db.update(nativeAuthRequests).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(nativeAuthRequests.id, e.requestId));
    await expect(caller.auth.nativeAuthorize({ requestId: e.requestId })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("auth.nativeExchange", () => {
  async function authorized(client: Client = "desktop") {
    const r = await start(client);
    const { redirectUrl } = await authedCaller(user, "cookie").auth.nativeAuthorize({ requestId: r.requestId });
    return { ...r, code: parseRedirect(redirectUrl).code };
  }
  const GENERIC = { code: "BAD_REQUEST", message: "Invalid or expired sign-in request" };

  it.each(["desktop", "mobile", "cli"] as const)("PKCE success for %s — returns user and a bearer session", async (client) => {
    const r = await authorized(client);
    const res = await publicCaller(client).auth.nativeExchange({ requestId: r.requestId, code: r.code, codeVerifier: r.verifier });
    expect(res.user).toEqual({ id: user.id, email: user.email, name: user.name });
    expect(res.sessionToken.length).toBeGreaterThan(30);

    const [session] = await db.select().from(sessions).where(eq(sessions.id, res.sessionToken));
    expect(session!.authMethod).toBe("bearer");
    expect(session!.userId).toBe(user.id);
    expect(session!.tenantId).toBe(tenant.id);
    expect(session!.maxExpiresAt).not.toBeNull();
  });

  it("wrong verifier fails generically", async () => {
    const r = await authorized();
    await expect(
      publicCaller("desktop").auth.nativeExchange({ requestId: r.requestId, code: r.code, codeVerifier: pkce().verifier }),
    ).rejects.toMatchObject(GENERIC);
  });

  it("wrong code fails generically", async () => {
    const r = await authorized();
    await expect(
      publicCaller("desktop").auth.nativeExchange({ requestId: r.requestId, code: generateWrongCode(), codeVerifier: r.verifier }),
    ).rejects.toMatchObject(GENERIC);
  });

  it("a replayed code fails after the first exchange", async () => {
    const r = await authorized();
    const input = { requestId: r.requestId, code: r.code, codeVerifier: r.verifier };
    await publicCaller("desktop").auth.nativeExchange(input);
    await expect(publicCaller("desktop").auth.nativeExchange(input)).rejects.toMatchObject(GENERIC);
  });

  it("concurrent exchanges produce exactly one session", async () => {
    const r = await authorized();
    const input = { requestId: r.requestId, code: r.code, codeVerifier: r.verifier };
    const results = await Promise.allSettled([
      publicCaller("desktop").auth.nativeExchange(input),
      publicCaller("desktop").auth.nativeExchange(input),
      publicCaller("desktop").auth.nativeExchange(input),
    ]);
    expect(results.filter((x) => x.status === "fulfilled")).toHaveLength(1);
  });

  it("an expired code fails", async () => {
    const r = await authorized();
    await db.update(nativeAuthRequests).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(nativeAuthRequests.id, r.requestId));
    await expect(
      publicCaller("desktop").auth.nativeExchange({ requestId: r.requestId, code: r.code, codeVerifier: r.verifier }),
    ).rejects.toMatchObject(GENERIC);
  });

  it("an unauthorized request cannot be exchanged", async () => {
    const r = await start("desktop");
    await expect(
      publicCaller("desktop").auth.nativeExchange({ requestId: r.requestId, code: generateWrongCode(), codeVerifier: r.verifier }),
    ).rejects.toMatchObject(GENERIC);
  });

  it("the x-hisaabo-client header must match the request's client", async () => {
    const r = await authorized("desktop");
    const input = { requestId: r.requestId, code: r.code, codeVerifier: r.verifier };
    await expect(publicCaller().auth.nativeExchange(input)).rejects.toMatchObject(GENERIC);
    await expect(publicCaller("mobile").auth.nativeExchange(input)).rejects.toMatchObject(GENERIC);
    await expect(publicCaller("cli").auth.nativeExchange(input)).rejects.toMatchObject(GENERIC);
    // a mismatched attempt does not burn the code
    await expect(publicCaller("desktop").auth.nativeExchange(input)).resolves.toBeDefined();
  });

  it("rejects malformed verifiers via validation", async () => {
    const r = await authorized();
    await expect(
      publicCaller("desktop").auth.nativeExchange({ requestId: r.requestId, code: r.code, codeVerifier: "short" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("gives a user with no organization a bearer session with no tenant selected", async () => {
    const lone = await createUser({ email: "lone-native@vyapar.in", name: "Lone" });
    const r = await start("cli");
    const { redirectUrl } = await authedCaller(lone, "cookie").auth.nativeAuthorize({ requestId: r.requestId });
    const res = await publicCaller("cli").auth.nativeExchange({
      requestId: r.requestId,
      code: parseRedirect(redirectUrl).code,
      codeVerifier: r.verifier,
    });
    const [session] = await db.select().from(sessions).where(eq(sessions.id, res.sessionToken));
    expect(session!.tenantId).toBeNull();
  });
});

function generateWrongCode() {
  return randomBytes(32).toString("base64url");
}
