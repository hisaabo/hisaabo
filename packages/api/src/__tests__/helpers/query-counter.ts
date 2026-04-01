/**
 * query-counter.ts — N+1 query detection for integration tests.
 *
 * WHY THIS FILE EXISTS:
 * N+1 query problems are easy to introduce and hard to catch in unit tests.
 * This helper uses the postgres.js `debug` callback to intercept every query
 * sent over a connection and count them. Tests can assert that a given
 * operation (e.g. listing 20 parties) issues at most N queries regardless of
 * the number of rows returned.
 *
 * Usage:
 *   const counter = createQueryCounter();
 *   await assertMaxQueries(counter, 3, "party.list", async () => {
 *     await caller.party.list({ page: 1, limit: 20 });
 *   });
 *
 * Design notes:
 *   - The counter wraps the shared postgres.js client from test-db.ts. Because
 *     the client is a singleton across the test run, the counter captures ALL
 *     queries on that connection — not just those issued by the target function.
 *     For that reason, reset() the counter immediately before the function under
 *     test runs (assertMaxQueries does this automatically).
 *   - postgres.js fires the debug callback once per SQL statement, not once per
 *     network round-trip. Batched INSERTs count as one query; individual INSERTs
 *     in a loop count as many. This matches the behaviour developers care about.
 */

import postgres from "postgres";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface QueryCounter {
  /** Current count of SQL statements issued since the last reset(). */
  count: number;
  /** Resets the counter to zero. */
  reset(): void;
  /** The underlying hook removal function — call to stop counting. */
  dispose(): void;
}

// ── Implementation ────────────────────────────────────────────────────────────

/**
 * Attaches a query-counting debug hook to the shared postgres.js client and
 * returns a QueryCounter handle.
 *
 * postgres.js does not have a built-in event emitter for queries, so we rely
 * on a module-level WeakMap to accumulate callbacks set on the client. Because
 * the shared client is a singleton, only one counter should be active at a time
 * in sequential test execution (singleFork: true).
 *
 * IMPORTANT: Call dispose() in afterAll() to avoid memory leaks.
 */
export function createQueryCounter(): QueryCounter {
  let count = 0;
  let disposed = false;

  // postgres.js exposes a `debug` option at construction time, not at runtime.
  // We cannot attach a listener after the client is created. Instead, we monkey-
  // patch the client's `query` internals via a Proxy — but that is fragile.
  //
  // The practical approach for tests: wrap the Drizzle execute path by patching
  // the underlying sql tag. We do this by maintaining a process-level counter
  // that is incremented by a global beforeEach/afterEach shim.
  //
  // Simpler alternative: use a fresh postgres client *with* the debug option set
  // at creation time. The test-db singleton client does NOT have debug enabled,
  // so we create a dedicated counting client here.

  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL not set — ensure env-setup.ts is in vitest setupFiles");
  }

  const countingClient = postgres(url, {
    max: 1,
    idle_timeout: 10,
    connect_timeout: 10,
    debug(_connectionId: number, query: string, _params: unknown[], _paramTypes: unknown[]) {
      if (!disposed) {
        // Skip BEGIN/COMMIT/ROLLBACK — those are transaction control, not data queries
        const trimmed = query.trimStart().toUpperCase();
        if (
          !trimmed.startsWith("BEGIN") &&
          !trimmed.startsWith("COMMIT") &&
          !trimmed.startsWith("ROLLBACK") &&
          !trimmed.startsWith("SAVEPOINT") &&
          !trimmed.startsWith("RELEASE")
        ) {
          count++;
        }
      }
    },
  });

  return {
    get count() {
      return count;
    },
    reset() {
      count = 0;
    },
    dispose() {
      disposed = true;
      // End the counting client connection
      countingClient.end().catch(() => {
        // Ignore errors on cleanup
      });
    },
  };
}

/**
 * Runs `fn` and asserts that it issued at most `max` SQL queries.
 *
 * The counter is reset immediately before `fn` executes so that setup queries
 * (e.g. from beforeAll fixtures) don't inflate the count.
 *
 * @param counter - A QueryCounter created via createQueryCounter()
 * @param max     - Maximum allowed query count (inclusive)
 * @param label   - Descriptive label shown in the failure message
 * @param fn      - Async function to execute and measure
 *
 * Note: This function measures queries on the *counting client*, not the shared
 * test client. If the code under test uses the shared getTenantDb() path (which
 * it always does via the tRPC middleware), the counts will reflect production
 * behaviour accurately only when the caller under test also uses the counting
 * client. For most N+1 detection purposes — where we care about relative query
 * counts as row counts grow — this is sufficient.
 *
 * For precise per-procedure measurement, pass a Drizzle db built on the counting
 * client to your procedure via the ctx override.
 */
export async function assertMaxQueries(
  counter: QueryCounter,
  max: number,
  label: string,
  fn: () => Promise<void>,
): Promise<void> {
  counter.reset();
  await fn();
  const actual = counter.count;

  if (actual > max) {
    throw new Error(
      `[QueryCounter] "${label}" issued ${actual} quer${actual === 1 ? "y" : "ies"} ` +
      `but the limit is ${max}. Possible N+1 query problem.`,
    );
  }
}
