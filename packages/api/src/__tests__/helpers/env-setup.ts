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

import { generateKeyPairSync } from "node:crypto";
import { inject } from "vitest";
import {
  templateDatabaseUrl,
  withDatabase,
  workerDbName,
} from "./worker-db-config.js";

// When global-setup.ts cloned the test database (API_TEST_WORKERS > 1), this
// worker gets its own clone, picked by vitest's worker slot. Every consumer
// reads TEST_DATABASE_URL / DATABASE_URL / CONTROL_DATABASE_URL, so rewriting
// them here redirects the whole process, including helpers that open their own
// connection (scratch databases, LISTEN clients).
let testUrl = templateDatabaseUrl();
const workerDbs = inject("hisaaboWorkerDbs");
if (workerDbs) {
  const poolId = process.env.VITEST_POOL_ID;
  if (!poolId) {
    throw new Error("VITEST_POOL_ID is not set; cannot pick this worker's test database");
  }
  testUrl = withDatabase(testUrl, workerDbName(workerDbs, poolId));
  process.env.TEST_DATABASE_URL = testUrl;
}

process.env.DATABASE_URL = testUrl;
process.env.CONTROL_DATABASE_URL = testUrl;
process.env.MULTI_TENANT = "false";
process.env.NODE_ENV = "test";
// Prevent real email delivery during tests
process.env.RESEND_API_KEY = "";
// E-invoicing refuses to run without a NIC public key (lib/irp-public-key.ts). Tests that
// exercise it mock the IRP client, so any valid RSA key will do; one generated here,
// never a real NIC key. The suites that cover the key itself set their own.
{
  const { publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const pem = publicKey.export({ type: "spki", format: "pem" }).toString();
  process.env.IRP_PUBLIC_KEY_PEM = pem;
  process.env.IRP_SANDBOX_PUBLIC_KEY_PEM = pem;
  delete process.env.IRP_PUBLIC_KEY_PATH;
  delete process.env.IRP_SANDBOX_PUBLIC_KEY_PATH;
}
// Most suites create several users on one self-hosted DB; the invite-only
// signup policy has its own suite that turns this off.
process.env.ALLOW_OPEN_SIGNUP = "true";
