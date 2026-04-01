/**
 * env-setup.ts — Environment bootstrap loaded via vitest setupFiles.
 *
 * WHY THIS FILE EXISTS:
 * vitest setupFiles run before any test module is imported. That means the
 * process.env mutations below take effect before @hisaabo/db creates its
 * postgres.js clients (which happen at module evaluation time). This is the
 * ONLY safe place to redirect DB connections for tests — anywhere later and
 * the production clients are already open.
 *
 * MULTI_TENANT=false keeps getTenantDb() in self-hosted mode, meaning the
 * control schema and tenant schema live in the same database. This is the
 * correct model for the test environment.
 */

const testUrl =
  process.env.TEST_DATABASE_URL ??
  "postgresql://test:test@localhost:5433/hisaabo_test";

process.env.DATABASE_URL = testUrl;
process.env.CONTROL_DATABASE_URL = testUrl;
process.env.MULTI_TENANT = "false";
process.env.NODE_ENV = "test";
// Prevent real email delivery during tests
process.env.RESEND_API_KEY = "";
