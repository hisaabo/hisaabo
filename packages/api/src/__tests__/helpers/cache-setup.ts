/**
 * Global vitest setup (runs after env-setup.ts): every test starts with empty
 * in-process caches and the cache layer out of degraded mode.
 */
import { beforeEach } from "vitest";
import { resetAllCaches, setDegraded } from "../../lib/cache/ttl-cache.js";

beforeEach(() => {
  resetAllCaches();
  setDegraded(false);
});
