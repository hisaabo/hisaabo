// Run: node --experimental-strip-types --test scripts/check-migrations.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { lintMigration, maskSql, normalizeName } from "./check-migrations.ts";

const rules = (sql: string) => lintMigration(sql, "m.sql").map((f) => f.rule);

test("flags the expand/contract violations on existing tables", () => {
  assert.deepEqual(rules(`ALTER TABLE "items" DROP COLUMN "legacy";`), ["drop"]);
  assert.deepEqual(rules(`DROP TABLE "old_things";`), ["drop"]);
  assert.deepEqual(rules(`DROP TYPE "public"."status";`), ["drop"]);
  assert.deepEqual(rules(`ALTER TABLE "items" ALTER COLUMN "qty" DROP DEFAULT;`), ["drop"]);
  assert.deepEqual(rules(`ALTER TABLE "invoice_items" RENAME COLUMN "description" TO "item_name";`), ["rename"]);
  assert.deepEqual(rules(`ALTER TABLE "items" RENAME TO "products";`), ["rename"]);
  assert.deepEqual(rules(`ALTER TYPE "status" RENAME VALUE 'a' TO 'b';`), ["rename"]);
  assert.deepEqual(rules(`ALTER TABLE "items" ALTER COLUMN "qty" SET DATA TYPE numeric(12, 2);`), ["alter-column-type"]);
  assert.deepEqual(rules(`ALTER TABLE "items" ALTER COLUMN "qty" TYPE bigint;`), ["alter-column-type"]);
  assert.deepEqual(rules(`ALTER TABLE "items" ADD COLUMN "sku" text NOT NULL;`), ["add-not-null-column"]);
  assert.deepEqual(rules(`ALTER TABLE "items" ALTER COLUMN "sku" SET NOT NULL;`), ["set-not-null"]);
  assert.deepEqual(rules(`CREATE INDEX "items_sku_idx" ON "items" USING btree ("sku");`), ["index-existing-table"]);
  assert.deepEqual(rules(`CREATE UNIQUE INDEX "x" ON "public"."items" ("sku");`), ["index-existing-table"]);
  assert.deepEqual(
    rules(`ALTER TABLE "expenses" ADD CONSTRAINT "fk" FOREIGN KEY ("bank_id") REFERENCES "public"."banks"("id");`),
    ["constraint-existing-table"],
  );
  assert.deepEqual(rules(`ALTER TABLE "items" ADD CONSTRAINT "u" UNIQUE("sku");`), ["constraint-existing-table"]);
});

test("allows expand-safe statements", () => {
  assert.deepEqual(rules(`ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "kind" text DEFAULT 'cookie' NOT NULL;`), []);
  assert.deepEqual(rules(`ALTER TABLE "items" ADD COLUMN "note" text;`), []);
  assert.deepEqual(rules(`ALTER TABLE "items" ADD COLUMN "id2" bigserial NOT NULL;`), []);
  assert.deepEqual(rules(`ALTER TABLE "items" ALTER COLUMN "note" DROP NOT NULL;`), []);
  assert.deepEqual(rules(`ALTER TABLE "items" DROP CONSTRAINT "old_fk";`), []);
  assert.deepEqual(rules(`DROP INDEX IF EXISTS "items_old_idx";`), []);
  assert.deepEqual(rules(`CREATE INDEX CONCURRENTLY "x" ON "items" ("sku");`), []);
  assert.deepEqual(
    rules(`ALTER TABLE "expenses" ADD CONSTRAINT "fk" FOREIGN KEY ("b") REFERENCES "banks"("id") NOT VALID;`),
    [],
  );
});

test("new tables (same file or same change) are exempt from existing-data rules", () => {
  const sql = `CREATE TABLE IF NOT EXISTS "item_images" ("id" uuid PRIMARY KEY, "item_id" uuid NOT NULL);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "item_images" ADD CONSTRAINT "fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id");
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "item_images_item_idx" ON "item_images" USING btree ("item_id");
ALTER TABLE "item_images" ADD COLUMN "w" integer NOT NULL;`;
  assert.deepEqual(rules(sql), []);

  // Created in another new migration of the same change.
  assert.deepEqual(
    lintMigration(`CREATE INDEX "a" ON "staged" ("x");`, "0017.sql", new Set(["staged"])).map((f) => f.rule),
    [],
  );
});

test("checks each statement separately, including inside DO blocks", () => {
  const sql = `CREATE TABLE "fresh" ("id" uuid);
ALTER TABLE "fresh" ADD COLUMN "a" text NOT NULL;
ALTER TABLE "items" ADD COLUMN "b" text NOT NULL;
DO $$ BEGIN
 ALTER TABLE "invoices" ADD CONSTRAINT "fk" FOREIGN KEY ("x") REFERENCES "fresh"("id");
EXCEPTION WHEN duplicate_object THEN null;
END $$;`;
  const findings = lintMigration(sql, "m.sql");
  assert.deepEqual(findings.map((f) => [f.rule, f.line]), [
    ["add-not-null-column", 3],
    ["constraint-existing-table", 5],
  ]);
});

test("ignores keywords in comments, strings and quoted identifiers", () => {
  assert.deepEqual(rules(`-- we will DROP TABLE "x" later\nALTER TABLE "items" ADD COLUMN "c" text;`), []);
  assert.deepEqual(rules(`ALTER TABLE "items" ADD COLUMN "c" text DEFAULT 'RENAME me';`), []);
  assert.deepEqual(rules(`ALTER TABLE "items" ADD COLUMN "rename" text;`), []);
  assert.deepEqual(rules(`ALTER TABLE "items" ADD COLUMN "c" text DEFAULT 'x' NOT NULL;`), []);
});

test("allow markers suppress named rules and must carry a reason", () => {
  const allowed = `--> statement-breakpoint
-- migration-lint-allow drop: contract step, unused since v0.10
ALTER TABLE "items" DROP COLUMN "legacy";`;
  assert.deepEqual(rules(allowed), []);

  const multi = `-- migration-lint-allow drop, rename: contract step
ALTER TABLE "items" DROP COLUMN "a", RENAME COLUMN "b" TO "c";`;
  assert.deepEqual(rules(multi), []);

  // Marker only covers its own statement.
  const scoped = `-- migration-lint-allow drop: ok
ALTER TABLE "items" DROP COLUMN "a";
ALTER TABLE "items" DROP COLUMN "b";`;
  assert.deepEqual(rules(scoped), ["drop"]);

  assert.deepEqual(rules(`-- migration-lint-allow drop\nALTER TABLE "items" DROP COLUMN "a";`), ["bad-allow-marker", "drop"]);
  assert.deepEqual(rules(`-- migration-lint-allow dorp: typo\nALTER TABLE "items" DROP COLUMN "a";`), ["bad-allow-marker", "drop"]);
  assert.deepEqual(rules(`-- migration-lint-allow edited-migration: no\nSELECT 1;`), ["bad-allow-marker"]);
});

test("helpers", () => {
  assert.equal(normalizeName(`"public"."Items"`), "Items");
  assert.equal(normalizeName(`public.Items`), "items");
  const sql = `a -- c\n'x;y' /* z */ b`;
  assert.equal(maskSql(sql).length, sql.length);
  assert.equal(maskSql(sql).split("\n").length, 2);
  assert.match(maskSql(sql), /^a\s+\n\s+b$/);
});
