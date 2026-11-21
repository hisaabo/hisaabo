/**
 * global-setup.ts — vitest globalSetup for the API suite. Runs once in the
 * main process, before any worker starts.
 *
 * With more than one worker it clones the pushed test database (the template,
 * TEST_DATABASE_URL) into one database per worker slot and tells the workers
 * about them via `project.provide`; env-setup.ts does the per-worker
 * redirection. The returned teardown drops the clones. See worker-db-config.ts
 * for the full scheme.
 *
 * With a single worker (API_TEST_WORKERS=1, or low free memory) nothing is
 * cloned and every file runs against the template database itself, exactly as
 * before.
 */
import { randomBytes } from "node:crypto";
import type { TestProject } from "vitest/node";
import {
  databaseNameOf,
  templateDatabaseUrl,
  type WorkerDbPlan,
} from "./worker-db-config.js";
import {
  connectAdmin,
  createWorkerDatabase,
  dropDatabase,
  sweepStaleWorkerDatabases,
} from "./worker-db.js";

export default async function setup(project: TestProject): Promise<(() => Promise<void>) | void> {
  const maxWorkers = project.config.maxWorkers ?? 1;
  if (maxWorkers <= 1) return;

  const templateUrl = templateDatabaseUrl();
  const template = databaseNameOf(templateUrl);

  // No point cloning more databases than there are files to run (single-file
  // runs while developing). `filenamePattern` is where Vitest keeps the CLI
  // filters; it is not public API, so without it we just clone one per worker.
  const filters = (project.vitest as unknown as { filenamePattern?: string[] }).filenamePattern;
  const { testFiles } = await project.globTestFiles(filters);
  const slots = Math.max(1, Math.min(maxWorkers, testFiles.length));

  const runId = randomBytes(3).toString("hex");
  const plan: WorkerDbPlan = { template, prefix: `${template}_w${runId}_` };
  const names = Array.from({ length: slots }, (_, i) => `${plan.prefix}${i + 1}`);

  const admin = await connectAdmin(templateUrl, slots);
  const created: string[] = [];
  const dropAll = async () => {
    try {
      await Promise.all(created.splice(0).map((n) => dropDatabase(admin, n)));
    } finally {
      await admin.end({ timeout: 2 });
    }
  };

  try {
    await sweepStaleWorkerDatabases(admin, template);
    // Concurrent CREATE DATABASE from one template is fine; each copy is a
    // file-level copy of a ~10 MB database.
    await Promise.all(
      names.map(async (name) => {
        created.push(name); // before cloning: DROP ... IF EXISTS is harmless, a leak is not
        await createWorkerDatabase(admin, templateUrl, template, name);
      }),
    );
  } catch (e) {
    await dropAll();
    throw e;
  }

  project.provide("hisaaboWorkerDbs", plan);
  return dropAll;
}
