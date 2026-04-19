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
