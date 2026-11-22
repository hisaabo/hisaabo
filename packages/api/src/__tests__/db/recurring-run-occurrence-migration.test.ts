/**
 * Migration `recurring_run_occurrence` against real SQL.
 *
 * It adds recurring_invoice_runs.scheduled_for and a PARTIAL unique index on
 * (template_id, scheduled_for) as the database backstop for the template row
 * lock. Production runs tables written by the old scheduler, which could
 * double-generate, so they may already hold duplicate runs. The migration must
 * apply cleanly on top of such rows and leave them alone: history has no
 * occurrence (scheduled_for stays NULL), NULLs never collide, and the index
 * only constrains rows written from now on.
 *
 * Each scratch database is built from the committed migrations up to the one
 * before this migration, filled with duplicate runs, and then migrated. Both
 * migration directories are covered: `drizzle-tenant` (cloud tenant databases)
 * and `drizzle` (self-hosted, control and tenant schema in one database).
 */
import { describe, it, expect, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  DB_PKG,
  applyMigrationFile,
  createScratchDb,
  journalTags,
  type MigrationDir,
  type Scratch,
} from "./scratch-control-db";

const TAG_SUFFIX = "_recurring_run_occurrence";
const INDEX = "recurring_run_occurrence_uniq";

const scratches: Scratch[] = [];
afterAll(async () => {
  for (const s of scratches) await s.drop();
});

function newMigration(dir: MigrationDir) {
  const tags = journalTags(dir);
  const idx = tags.findIndex((t) => t.endsWith(TAG_SUFFIX));
  expect(idx, `${dir} journal has the ${TAG_SUFFIX} migration`).toBeGreaterThan(0);
  return { tag: tags[idx]!, before: idx };
}

/** Rows as the OLD scheduler could leave them: the same occurrence billed twice. */
async function seedDuplicateRuns(s: Scratch) {
  const [biz] = await s.sql`INSERT INTO businesses (created_by_user_id, name) VALUES (gen_random_uuid(), 'Dup Biz') RETURNING id`;
  const [party] = await s.sql`INSERT INTO parties (business_id, type, name) VALUES (${biz!.id}, 'customer', 'P') RETURNING id`;
  const [tpl] = await s.sql`
    INSERT INTO recurring_invoice_templates (business_id, party_id, name, type, frequency, line_items, start_date, next_run_date)
    VALUES (${biz!.id}, ${party!.id}, 'T', 'sale', 'monthly', '[]'::jsonb, now(), now()) RETURNING id`;
  const at = new Date("2026-05-01T10:00:00Z");
  for (const status of ["success", "success", "success", "failed", "failed", "skipped_limit", "skipped_limit"]) {
    await s.sql`INSERT INTO recurring_invoice_runs (template_id, business_id, status, executed_at)
                VALUES (${tpl!.id}, ${biz!.id}, ${status}, ${at})`;
  }
  return { businessId: biz!.id as string, templateId: tpl!.id as string, rows: 7 };
}

describe.each(["drizzle-tenant", "drizzle"] as const)("recurring_run_occurrence migration (%s)", (dir) => {
  it("applies cleanly on top of existing duplicate runs and leaves them untouched", async () => {
    const { tag, before } = newMigration(dir);
    const s = await createScratchDb(dir, before);
    scratches.push(s);
    const seeded = await seedDuplicateRuns(s);

    // sanity: the old schema has neither the column nor the index
    const pre = await s.sql`SELECT column_name FROM information_schema.columns
      WHERE table_name = 'recurring_invoice_runs' AND column_name = 'scheduled_for'`;
    expect(pre).toHaveLength(0);

    await expect(applyMigrationFile(s.sql, dir, `${tag}.sql`)).resolves.toBeUndefined();

    // nothing deleted, nothing rewritten: duplicates are still there, with no occurrence
    const rows = await s.sql`SELECT status, scheduled_for FROM recurring_invoice_runs WHERE template_id = ${seeded.templateId}`;
    expect(rows).toHaveLength(seeded.rows);
    expect(rows.every((r) => r.scheduled_for === null)).toBe(true);
    expect(rows.filter((r) => r.status === "success")).toHaveLength(3);

    // the column and the partial unique index exist
    const col = await s.sql`SELECT data_type, is_nullable FROM information_schema.columns
      WHERE table_name = 'recurring_invoice_runs' AND column_name = 'scheduled_for'`;
    expect(col[0]).toMatchObject({ data_type: "timestamp with time zone", is_nullable: "YES" });
    const [idx] = await s.sql`SELECT indexdef FROM pg_indexes WHERE indexname = ${INDEX}`;
    expect(idx!.indexdef).toMatch(/CREATE UNIQUE INDEX/);
    expect(idx!.indexdef).toMatch(/WHERE/);
  });

  it("enforces one run per occurrence for new rows only", async () => {
    const { tag, before } = newMigration(dir);
    const s = await createScratchDb(dir, before);
    scratches.push(s);
    const seeded = await seedDuplicateRuns(s);
    await applyMigrationFile(s.sql, dir, `${tag}.sql`);

    const occurrence = new Date("2026-06-01T00:00:00Z");
    const insert = (status: string, scheduledFor: Date | null) =>
      s.sql`INSERT INTO recurring_invoice_runs (template_id, business_id, status, scheduled_for)
            VALUES (${seeded.templateId}, ${seeded.businessId}, ${status}, ${scheduledFor})`;

    await insert("success", occurrence);
    // a second success (or skip) for the same occurrence is the double-billing the backstop exists for
    await expect(insert("success", occurrence)).rejects.toMatchObject({ code: "23505", constraint_name: INDEX });
    await expect(insert("skipped_limit", occurrence)).rejects.toMatchObject({ code: "23505", constraint_name: INDEX });
    // a different occurrence is fine; failed attempts repeat by design; history (NULL) never collides
    await insert("success", new Date("2026-07-01T00:00:00Z"));
    await insert("failed", occurrence);
    await insert("failed", occurrence);
    await insert("success", null);
    await insert("success", null);
  });

});

describe("recurring_run_occurrence migration files", () => {
  it("is the same SQL in the self-hosted and cloud-tenant directories", () => {
    const sqlOf = (dir: MigrationDir) => readFileSync(resolve(DB_PKG, dir, `${newMigration(dir).tag}.sql`), "utf-8");
    expect(sqlOf("drizzle")).toBe(sqlOf("drizzle-tenant"));
  });
});
