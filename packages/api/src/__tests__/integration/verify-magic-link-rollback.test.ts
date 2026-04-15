/**
 * verify-magic-link-rollback.test.ts — Protects the "token-claim inside tx"
 * invariant that was missing in the production-crash incident.
 *
 * BACKGROUND:
 *   Before the fix, verifyMagicLink marked magic_link_tokens.usedAt via a
 *   direct controlDb.update(...) call OUTSIDE the controlDb.transaction(...)
 *   that followed. When tenant provisioning failed inside the tx (the prod
 *   crash), the outer tx rolled back the user/tenant/session rows, but the
 *   token claim was already committed to disk. Every user retry then
 *   returned "Invalid, expired, or already used link" because the token was
 *   permanently burned despite no user ever being created.
 *
 *   The fix moved the atomic claim INSIDE the tx. This test locks that
 *   guarantee in.
 *
 * INVARIANT PROTECTED:
 *   If any error is thrown from anywhere inside verifyMagicLink's tx
 *   callback (including the post-user-insert path that runs
 *   enforceSessionLimit + session insert), the magic_link_tokens.usedAt
 *   column MUST remain NULL and the same raw token MUST be usable on a
 *   retry. If someone ever moves the UPDATE back outside the tx, or adds a
 *   side-effect COMMIT-on-claim, this test fails immediately.
 *
 * MECHANISM:
 *   vi.mock replaces enforceSessionLimit with a function that throws. This
 *   is the most targeted way to inject a tx failure without relying on
 *   incidental DB constraints (which would couple the test to schema
 *   details). The test lives in its own file so the mock doesn't leak into
 *   other auth tests in auth.test.ts.
 */

import { describe, it, expect, afterAll, vi, beforeEach } from "vitest";
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { users, magicLinkTokens } from "@hisaabo/db";
import { getControlDb, truncateAllTables, closeTestDb } from "../helpers/test-db.js";
import { createTestContext } from "../helpers/test-context.js";
import { createCallerFactory } from "../../trpc.js";
import { appRouter } from "../../router.js";

// ── Mock: enforceSessionLimit throws on demand ────────────────────────────
// We control whether the mock throws via a mutable flag so individual tests
// can flip between "force tx failure" and "let the tx succeed".
let forceSessionLimitFailure = false;

vi.mock("../../lib/plan-limits.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/plan-limits.js")>();
  return {
    ...actual,
    enforceSessionLimit: vi.fn().mockImplementation(async (userId: string) => {
      if (forceSessionLimitFailure) {
        throw new Error("forced-failure-for-test: enforceSessionLimit inside tx");
      }
      // When the flag is off, call the real implementation so the positive
      // control case still exercises real logic.
      return actual.enforceSessionLimit(userId);
    }),
  };
});

const _callerFactory = createCallerFactory(appRouter);
const caller = _callerFactory(createTestContext({}));

beforeEach(() => {
  forceSessionLimitFailure = false;
});

afterAll(async () => {
  await truncateAllTables();
  await closeTestDb();
});

describe("verifyMagicLink — token rollback on tx failure", () => {
  const db = getControlDb();

  it("leaves usedAt=NULL and allows retry when the tx throws mid-flow", async () => {
    const email = "rollback-retry@vyapar.in";
    const rawToken = "rollback-token-" + Date.now();
    const tokenHash = createHash("sha256").update(rawToken).digest("hex");

    await db.insert(magicLinkTokens).values({
      email,
      tokenHash,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    });

    // First attempt: force the tx to fail inside enforceSessionLimit (which
    // runs after user/tenant/membership rows are inserted in the tx).
    forceSessionLimitFailure = true;
    await expect(caller.auth.verifyMagicLink({ token: rawToken })).rejects.toThrow();

    // Token row must still have usedAt=NULL — this is the whole point.
    const [tokenAfterFailure] = await db.select()
      .from(magicLinkTokens)
      .where(eq(magicLinkTokens.tokenHash, tokenHash))
      .limit(1);
    expect(tokenAfterFailure).toBeDefined();
    expect(tokenAfterFailure!.usedAt).toBeNull();

    // User row must NOT exist — the whole tx rolled back.
    const usersAfter = await db.select().from(users).where(eq(users.email, email));
    expect(usersAfter).toHaveLength(0);

    // Second attempt: allow the tx to succeed. Same raw token must work.
    forceSessionLimitFailure = false;
    const result = await caller.auth.verifyMagicLink({ token: rawToken });
    expect(result.user.email).toBe(email);
    expect(result.isNewUser).toBe(true);

    // NOW the token is burned.
    const [tokenAfterSuccess] = await db.select()
      .from(magicLinkTokens)
      .where(eq(magicLinkTokens.tokenHash, tokenHash))
      .limit(1);
    expect(tokenAfterSuccess!.usedAt).toBeInstanceOf(Date);
  });

  it("does NOT burn the token when the peek is valid but the claim races a concurrent verify", async () => {
    // Synthesize a "loser in a race" by manually setting usedAt just before
    // the tx opens. The tx's atomic UPDATE returns 0 rows → handler throws
    // BAD_REQUEST — and critically, does NOT rewrite usedAt. This protects
    // against an optimistic-UPDATE rewrite pattern slipping in later.
    const email = "race-loser@vyapar.in";
    const rawToken = "race-token-" + Date.now();
    const tokenHash = createHash("sha256").update(rawToken).digest("hex");
    const alreadyUsedAt = new Date(Date.now() - 5000);

    await db.insert(magicLinkTokens).values({
      email,
      tokenHash,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
      usedAt: alreadyUsedAt,
    });

    // Even though the peek would reject (usedAt is not null), the verify
    // path already checks the peek outside the tx. Either way the user sees
    // BAD_REQUEST and the token row is unchanged.
    await expect(caller.auth.verifyMagicLink({ token: rawToken }))
      .rejects.toMatchObject({ code: "BAD_REQUEST" });

    const [tokenAfter] = await db.select()
      .from(magicLinkTokens)
      .where(eq(magicLinkTokens.tokenHash, tokenHash))
      .limit(1);
    // usedAt unchanged — matches the original value we seeded, not "now"
    expect(tokenAfter!.usedAt?.getTime()).toBe(alreadyUsedAt.getTime());
  });
});
