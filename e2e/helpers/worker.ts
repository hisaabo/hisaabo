/**
 * worker.ts — which isolated stack the current Playwright worker talks to.
 *
 * Each worker (identified by Playwright's TEST_PARALLEL_INDEX, 0 outside a
 * worker) has its own database, API and web server and its own seeded owner,
 * business, party and item (see harness/topology.cjs and global-setup.ts), so
 * spec files running on different workers cannot affect each other.
 */
import path from "node:path";
import { apiOrigin, baseDatabaseUrl, webOrigin, workerDatabaseUrl } from "../harness/topology.cjs";

export function workerIndex(): number {
  return Number(process.env.TEST_PARALLEL_INDEX ?? 0);
}

/** API origin of worker `k` (default: the current worker). */
export function apiUrl(k: number = workerIndex()): string {
  return apiOrigin(k);
}

/** Web origin of worker `k` (default: the current worker). */
export function baseUrl(k: number = workerIndex()): string {
  return webOrigin(k);
}

/**
 * Connection string of worker `k`'s database. E2E_DEV=1 runs one stack on
 * DATABASE_URL itself instead of a per-worker clone.
 */
export function databaseUrl(k: number = workerIndex()): string {
  return process.env.E2E_DEV === "1" ? baseDatabaseUrl() : workerDatabaseUrl(k);
}

/** Directory holding worker `k`'s generated auth state (storage state + seed ids). */
export function authDir(k: number = workerIndex()): string {
  return path.join(__dirname, "..", ".auth", `w${k}`);
}

/** Playwright storageState file of worker `k`'s owner (relative to the repo root, as Playwright resolves it). */
export function ownerStorageStatePath(k: number = workerIndex()): string {
  return path.join(authDir(k), "user.json");
}
