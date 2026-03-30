// Schema exports (both control plane and tenant tables)
export * from "./control-schema.js";
export * from "./tenant-schema.js";

// DB client exports
export { controlDb, type ControlDatabase } from "./control-client.js";
export { getTenantDb, type TenantDatabase } from "./tenant-pool.js";

// Tenant provisioning
export { provisionTenantDatabase, type TenantDbConfig } from "./provision-tenant.js";

// Backward-compatible default db export
export { db, type Database } from "./client.js";
