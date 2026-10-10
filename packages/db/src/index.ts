// Schema exports (both control plane and tenant tables)
export * from "./control-schema.js";
export * from "./tenant-schema.js";

// DB client exports
export { controlDb, type ControlDatabase, closeControlClient } from "./control-client.js";
export { getTenantDb, type TenantDatabase, closeAllTenantPools } from "./tenant-pool.js";

// Tenant provisioning
export {
  provisionTenantDatabase,
  cleanupTenantDatabase,
  scramSha256Verifier,
  type TenantDbConfig,
} from "./provision-tenant.js";

// Migration-layout startup sanity check (called from API server boot)
export {
  assertMigrationsPresent,
  buildMigrationsDirCandidates,
  pickExistingMigrationsDir,
} from "./migrate.js";

// Backward-compatible default db export
export { db, type Database } from "./client.js";

// Field-level encryption
export {
  encryptField,
  decryptField,
  reEncryptField,
  isEncrypted,
  getKeyVersion,
  encryptDbPassword,
  decryptDbPassword,
} from "./crypto.js";

// Cross-process cache invalidation triggers (single source of truth)
export {
  CACHE_NOTIFY_CHANNEL,
  CACHE_TRIGGER_STATEMENTS,
  expectedCacheTriggers,
  installCacheTriggers,
  verifyCacheTriggers,
  renderCacheTriggerMigration,
} from "./cache-triggers.js";

// Store-slug helpers (shared by backfill and API)
export {
  fallbackSlug, FALLBACK_SLUG_MAX_ATTEMPTS, STORE_SLUG_REGEX,
  storeSlugBusinessLockSql, storeSlugBusinessLockStatement, storeSlugBusinessLockKey,
  STORE_SLUG_LOCK_HEAD, STORE_SLUG_LOCK_TAIL,
} from "./store-slug.js";

// Store-slug registry backfill / reconcile
export {
  backfillStoreSlugRegistry,
  formatBackfillReport,
  STORE_SLUG_MARKER_KEY,
  type BackfillOptions,
  type BackfillReport,
  type SlugRename,
  type TenantRenamer,
  type UnresolvedLoser,
  type BusinessSlugRow,
  type TenantReader,
  type TenantRow,
} from "./backfill-store-slugs.js";
