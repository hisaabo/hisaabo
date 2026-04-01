/**
 * create-test-caller.ts — tRPC caller factory for integration tests.
 *
 * WHY THIS FILE EXISTS:
 * `createCallerFactory` from @trpc/server lets us invoke tRPC procedures
 * directly (no HTTP round-trip) while still exercising the full middleware
 * chain: input validation → isAuthenticated → hasTenantAccess →
 * hasBusinessAccess → withPermissions → business logic → DB.
 *
 * The caller is built by constructing a synthetic Context that mirrors what
 * `createContext` (context.ts) would produce from a real HTTP request.
 *
 * In self-hosted mode (MULTI_TENANT=false) the tRPC middleware's
 * hasTenantAccess calls getTenantDb(tenantId) which returns the single
 * shared DB pointed at TEST_DATABASE_URL — no extra plumbing needed.
 *
 * Usage:
 *   const caller = createTestCaller({
 *     userId: ramesh.id,
 *     email: ramesh.email,
 *     name: ramesh.name ?? null,
 *     tenantId: tenant1.id,
 *     businessId: business1.id,
 *   });
 *   const result = await caller.party.list({ page: 1, limit: 20 });
 */

import { createCallerFactory } from "../../trpc.js";
import { appRouter } from "../../router.js";
import { createTestContext } from "./test-context.js";

// ── Caller factory ─────────────────────────────────────────────────────────────

const _callerFactory = createCallerFactory(appRouter);

// Infer the caller type from the factory instance to avoid fighting complex
// tRPC generic constraints.
type TestCaller = ReturnType<typeof _callerFactory>;

export interface CreateTestCallerOptions {
  /** The authenticated user ID. Corresponds to a real row in the users table. */
  userId: string;
  /** The user's email — surfaced in error messages and audit logs. */
  email: string;
  /** The user's display name (nullable in the DB). */
  name: string | null;
  /** The active tenant ID. The middleware will call getTenantDb(tenantId). */
  tenantId: string;
  /** The active business ID. The middleware will verify it exists in the tenant DB. */
  businessId: string;
}

/**
 * Returns a fully-typed tRPC caller that exercises the complete middleware
 * chain against a real (test) database.
 *
 * The returned caller is stateless — create a new one per test or per suite
 * as appropriate.
 */
export function createTestCaller(opts: CreateTestCallerOptions): TestCaller {
  const ctx = createTestContext({
    user: { id: opts.userId, email: opts.email, name: opts.name },
    tenantId: opts.tenantId,
    businessId: opts.businessId,
  });

  return _callerFactory(ctx);
}

/**
 * Creates a caller with no authenticated user. Useful for testing that
 * protected procedures correctly reject unauthenticated requests.
 */
export function createUnauthenticatedCaller(): TestCaller {
  const ctx = createTestContext({});
  return _callerFactory(ctx);
}
