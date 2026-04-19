import { config } from "dotenv";
config({ path: "../../.env" });

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as controlSchema from "./control-schema.js";

const controlUrl = process.env.CONTROL_DATABASE_URL || process.env.DATABASE_URL!;

if (!controlUrl) {
  throw new Error("DATABASE_URL or CONTROL_DATABASE_URL is required");
}

const controlClient = postgres(controlUrl, {
  max: 10,
  idle_timeout: 20,
  connect_timeout: 10,
});

export const controlDb = drizzle(controlClient, { schema: controlSchema });
export type ControlDatabase = typeof controlDb;

/**
 * Closes the control-plane postgres.js pool. Intended for test teardown only —
 * production code should leave the pool alive for the life of the process.
 *
 * Exported because Vitest's per-file module isolation (`isolate: true` default)
 * re-evaluates this module for each test file, so each file creates its own
 * fresh `controlClient`. Without an explicit close, the old pool's idle
 * connections stay alive in the single worker process until `idle_timeout`
 * elapses, and the test DB's `max_connections` limit gets exhausted mid-run.
 * Calling this in the test helper's `afterAll` gives the pool a clean exit.
 */
export async function closeControlClient(): Promise<void> {
  await controlClient.end({ timeout: 5 });
}
