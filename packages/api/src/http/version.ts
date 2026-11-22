/**
 * GET /api/version -> { "version": "0.10.1" }
 *
 * The one public, unauthenticated answer to "which release is this API
 * running?". `release.yml` (job `wait-for-api`) polls it on the production API
 * and holds the web/store deploy until it reports the tagged version, so the
 * frontends never ship ahead of the API they were built against.
 *
 * Deliberately minimal: the version only (the same string as the release tag
 * without its `v`, from `buildInfo`), never the commit, the environment or a
 * health verdict. `/health` stays version-free on purpose (docs/DEPLOYMENT.md,
 * "Which build is this?"). No database access, so it answers while the
 * database is down and costs nothing to poll. Not cacheable: a stale answer
 * would let the gate open (or stay shut) for the wrong release.
 */
import type { Hono } from "hono";
import { buildInfo, type BuildInfo } from "../lib/build-info.js";

export function registerVersionRoute(app: Hono, info: Pick<BuildInfo, "version"> = buildInfo): void {
  app.get("/api/version", (c) => {
    c.header("Cache-Control", "no-store");
    return c.json({ version: info.version });
  });
}
