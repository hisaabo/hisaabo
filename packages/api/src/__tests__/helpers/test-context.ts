/**
 * Test context factory for tRPC caller-based integration tests.
 *
 * WHY THIS FILE EXISTS:
 * The tRPC `createCallerFactory` pattern lets us test the full procedure chain
 * (validation → middleware → business logic → DB) without spinning up an HTTP
 * server. This helper builds a minimal Context object that satisfies the
 * middleware chain so we can test each router in isolation.
 *
 * IMPORTANT: These tests require a real PostgreSQL database. Set TEST_DATABASE_URL
 * in the environment before running:
 *
 *   TEST_DATABASE_URL=postgresql://test:test@localhost:5433/hisaabo_test pnpm test
 *
 * The docker-compose.test.yml in the root provides a RAM-backed test DB.
 */

import type { Context } from "../../context.js";

/**
 * Options for building a fake tRPC context.
 * All fields are optional — omit any you do not care about for a given test.
 */
export interface TestContextOptions {
  /** The authenticated user. Omit to simulate an unauthenticated request. */
  user?: { id: string; email: string; name: string | null };
  /** The active tenant ID (maps to a tenant row in the control DB). */
  tenantId?: string;
  /** The active business ID (maps to a business row in the tenant DB). */
  businessId?: string;
}

/**
 * Builds a mock tRPC Context for use with createCallerFactory.
 *
 * The returned context mirrors the shape that `createContext` (context.ts) produces
 * after parsing a real request, so all middleware guards (isAuthenticated,
 * hasTenantAccess, hasBusinessAccess) will behave the same way in tests.
 */
export function createTestContext(opts: TestContextOptions = {}): Context {
  // Build minimal Request and Headers objects that satisfy the Fetch API types.
  // We do NOT use real network sockets — only the headers are inspected.
  const headers = new Headers({
    "content-type": "application/json",
    ...(opts.businessId ? { "x-business-id": opts.businessId } : {}),
  });

  const req = new Request("http://localhost:3000/api/trpc/test", {
    method: "POST",
    headers,
  });

  const resHeaders = new Headers();

  return {
    user: opts.user ?? null,
    tenantId: opts.tenantId ?? null,
    businessId: opts.businessId && opts.user ? opts.businessId : null,
    req,
    resHeaders,
  };
}

/**
 * Convenience: creates a context with a user but no tenant/business selected.
 * Use this for auth-router tests that only need the user populated.
 */
export function createAuthenticatedContext(
  user: { id: string; email: string; name: string | null },
): Context {
  return createTestContext({ user });
}

/**
 * Convenience: creates a fully-populated context ready for businessProcedure tests.
 * Use this for invoice/payment/item/party router tests.
 */
export function createBusinessContext(opts: {
  userId: string;
  email: string;
  name: string;
  tenantId: string;
  businessId: string;
}): Context {
  return createTestContext({
    user: { id: opts.userId, email: opts.email, name: opts.name },
    tenantId: opts.tenantId,
    businessId: opts.businessId,
  });
}
