/**
 * admin-login-link.test.ts — the `admin login-link <email>` break-glass command
 * and the shared magic-link helper it reuses. DB-free: the store is injected.
 */

import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import {
  parseLoginLinkArgs,
  createLoginLink,
  resolveLoginLinkBaseUrl,
  deriveOnceDatabaseUrl,
  runLoginLink,
  ADMIN_LOGIN_LINK_MARKER,
  DEFAULT_TTL_MINUTES,
  MAX_TTL_MINUTES,
  LoginLinkError,
  type LoginLinkStore,
} from "../lib/admin/login-link";
import {
  generateMagicLinkToken,
  hashMagicLinkToken,
  buildMagicLinkUrl,
  MAGIC_LINK_TTL_MS,
} from "../lib/magic-link";

function fakeStore(users: Array<{ id: string; email: string }>) {
  const inserted: Array<{ email: string; tokenHash: string; userId: string; expiresAt: Date; ipAddress: string }> = [];
  const store: LoginLinkStore = {
    async findUserByEmail(email) {
      return users.find((u) => u.email.toLowerCase() === email) ?? null;
    },
    async insertToken(row) {
      inserted.push(row);
    },
  };
  return { store, inserted };
}

describe("magic-link helper (shared by sendMagicLink and login-link)", () => {
  it("generates unguessable, unique tokens whose stored hash is sha256 of the raw token", () => {
    const a = generateMagicLinkToken();
    const b = generateMagicLinkToken();
    expect(a.rawToken).not.toBe(b.rawToken);
    expect(a.rawToken.length).toBeGreaterThan(60);
    // verifyMagicLink hashes the presented token with sha256 hex — must match.
    expect(a.tokenHash).toBe(createHash("sha256").update(a.rawToken).digest("hex"));
    expect(hashMagicLinkToken(a.rawToken)).toBe(a.tokenHash);
  });

  it("keeps the emailed-link lifetime at 15 minutes", () => {
    expect(MAGIC_LINK_TTL_MS).toBe(15 * 60 * 1000);
  });

  it("builds the /auth/verify URL exactly as sendMagicLink always did", () => {
    expect(buildMagicLinkUrl("https://app.example.com", "a b")).toBe("https://app.example.com/auth/verify?token=a%20b");
    expect(buildMagicLinkUrl("https://app.example.com/", "t", "mobile")).toBe(
      "https://app.example.com/auth/verify?token=t&source=mobile",
    );
    expect(buildMagicLinkUrl("https://app.example.com", "t", "desktop")).toBe(
      "https://app.example.com/auth/verify?token=t&source=desktop",
    );
    expect(buildMagicLinkUrl("https://app.example.com", "t", "web")).toBe("https://app.example.com/auth/verify?token=t");
  });
});

describe("parseLoginLinkArgs", () => {
  it("parses an email with defaults", () => {
    expect(parseLoginLinkArgs(["owner@example.com"])).toEqual({
      email: "owner@example.com",
      ttlMinutes: DEFAULT_TTL_MINUTES,
      baseUrl: null,
      help: false,
    });
    expect(DEFAULT_TTL_MINUTES).toBe(15);
  });

  it("parses --ttl-minutes and --base-url in any order", () => {
    const a = parseLoginLinkArgs(["--ttl-minutes", "5", "a@b.in", "--base-url", "https://app.x.in"]);
    expect(a).toMatchObject({ email: "a@b.in", ttlMinutes: 5, baseUrl: "https://app.x.in" });
  });

  it("rejects out-of-range ttl, unknown flags and extra positionals", () => {
    expect(() => parseLoginLinkArgs(["a@b.in", "--ttl-minutes", "0"])).toThrow(/between 1 and/);
    expect(() => parseLoginLinkArgs(["a@b.in", "--ttl-minutes", String(MAX_TTL_MINUTES + 1)])).toThrow(/between 1 and/);
    expect(() => parseLoginLinkArgs(["a@b.in", "--ttl-minutes", "abc"])).toThrow();
    expect(() => parseLoginLinkArgs(["a@b.in", "--nope"])).toThrow(/unknown option/);
    expect(() => parseLoginLinkArgs(["a@b.in", "c@d.in"])).toThrow(/exactly one/);
    expect(() => parseLoginLinkArgs(["a@b.in", "--ttl-minutes"])).toThrow(/needs a value/);
  });

  it("recognises --help", () => {
    expect(parseLoginLinkArgs(["--help"]).help).toBe(true);
  });
});

describe("resolveLoginLinkBaseUrl", () => {
  it("uses --base-url over APP_URL and strips trailing slashes", () => {
    expect(resolveLoginLinkBaseUrl("https://a.example.com/", { APP_URL: "https://b.example.com" })).toBe("https://a.example.com");
    expect(resolveLoginLinkBaseUrl(null, { APP_URL: "https://b.example.com/" })).toBe("https://b.example.com");
  });

  it("fails clearly when neither is set or the value is not http(s)", () => {
    expect(() => resolveLoginLinkBaseUrl(null, {})).toThrow(/APP_URL is not set/);
    expect(() => resolveLoginLinkBaseUrl("ftp://x", {})).toThrow(/valid http/);
    expect(() => resolveLoginLinkBaseUrl(null, { APP_URL: "nope" })).toThrow(/APP_URL must be a valid http/);
  });
});

describe("createLoginLink", () => {
  const now = new Date("2026-01-01T00:00:00.000Z");

  it("creates a single-use token row for an existing user and returns the /auth/verify URL", async () => {
    const { store, inserted } = fakeStore([{ id: "u1", email: "Owner@Example.com" }]);
    const link = await createLoginLink(store, { email: " owner@example.COM ", ttlMinutes: 15, baseUrl: "https://app.example.com", now });

    expect(inserted).toHaveLength(1);
    const row = inserted[0];
    expect(row.email).toBe("owner@example.com");
    expect(row.ipAddress).toBe(ADMIN_LOGIN_LINK_MARKER);
    // Bound to the account it signs into: verifyMagicLink's operator-issued marker.
    expect(row.userId).toBe("u1");
    expect(row.expiresAt.toISOString()).toBe("2026-01-01T00:15:00.000Z");

    // The printed token hashes to the stored hash (what verifyMagicLink looks up).
    const url = new URL(link.url);
    expect(url.origin + url.pathname).toBe("https://app.example.com/auth/verify");
    const raw = url.searchParams.get("token")!;
    expect(hashMagicLinkToken(raw)).toBe(row.tokenHash);
    // The raw token is never stored.
    expect(JSON.stringify(row)).not.toContain(raw);

    expect(link).toMatchObject({ email: "owner@example.com", userId: "u1" });
    expect(link.expiresAt).toEqual(row.expiresAt);
  });

  it("honours a custom ttl", async () => {
    const { store, inserted } = fakeStore([{ id: "u1", email: "a@b.in" }]);
    await createLoginLink(store, { email: "a@b.in", ttlMinutes: 5, baseUrl: "https://x.in", now });
    expect(inserted[0].expiresAt.toISOString()).toBe("2026-01-01T00:05:00.000Z");
  });

  it("refuses unknown emails and never writes (it must not create accounts)", async () => {
    const { store, inserted } = fakeStore([{ id: "u1", email: "a@b.in" }]);
    await expect(createLoginLink(store, { email: "ghost@b.in", ttlMinutes: 15, baseUrl: "https://x.in" })).rejects.toBeInstanceOf(LoginLinkError);
    expect(inserted).toHaveLength(0);
  });

  it("issues a different token each time", async () => {
    const { store, inserted } = fakeStore([{ id: "u1", email: "a@b.in" }]);
    const l1 = await createLoginLink(store, { email: "a@b.in", ttlMinutes: 15, baseUrl: "https://x.in" });
    const l2 = await createLoginLink(store, { email: "a@b.in", ttlMinutes: 15, baseUrl: "https://x.in" });
    expect(l1.url).not.toBe(l2.url);
    expect(inserted[0].tokenHash).not.toBe(inserted[1].tokenHash);
  });
});

describe("deriveOnceDatabaseUrl (ONCE all-in-one image)", () => {
  const exists = () => true;

  it("builds the same unix-socket URL the s6 API run script uses", () => {
    expect(deriveOnceDatabaseUrl({}, exists, () => "s3cret\n")).toBe("postgresql://postgres:s3cret@/hisaabo?host=/storage/run");
  });

  it("does nothing when a database URL is already configured or the secret is absent", () => {
    expect(deriveOnceDatabaseUrl({ DATABASE_URL: "postgres://x" }, exists, () => "pw")).toBeNull();
    expect(deriveOnceDatabaseUrl({ CONTROL_DATABASE_URL: "postgres://x" }, exists, () => "pw")).toBeNull();
    expect(deriveOnceDatabaseUrl({}, () => false, () => "pw")).toBeNull();
    expect(deriveOnceDatabaseUrl({}, exists, () => "  \n")).toBeNull();
  });
});

describe("runLoginLink (argument / environment errors, no database)", () => {
  function io() {
    const out: string[] = [];
    const err: string[] = [];
    return { out: (s: string) => out.push(s), err: (s: string) => err.push(s), outText: () => out.join(""), errText: () => err.join("") };
  }

  it("prints help and exits 0", async () => {
    const i = io();
    expect(await runLoginLink(["--help"], i)).toBe(0);
    expect(i.outText()).toContain("login-link <email>");
  });

  it("exits 2 without an email or with bad flags", async () => {
    const i = io();
    expect(await runLoginLink([], i)).toBe(2);
    expect(i.errText()).toContain("needs an email");
    expect(await runLoginLink(["a@b.in", "--bogus"], io())).toBe(2);
  });

  it("exits 1 with a clear message when APP_URL is missing", async () => {
    const saved = process.env.APP_URL;
    delete process.env.APP_URL;
    try {
      const i = io();
      expect(await runLoginLink(["a@b.in"], i)).toBe(1);
      expect(i.errText()).toContain("APP_URL is not set");
    } finally {
      if (saved !== undefined) process.env.APP_URL = saved;
    }
  });
});
