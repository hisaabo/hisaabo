-- Stage 5 — Soft delete for items and itemVariants.
--
-- BEFORE: items and item_variants were hard-deleted via physical DELETE in
--         item.ts (mutations at item.delete, item.deleteVariant, item.merge).
--         That's a footgun in an accounting system: historical invoice line
--         items carry item_id / variant_id foreign keys (ON DELETE SET NULL),
--         so a hard delete silently zeroed the join on every legacy line and
--         destroyed the audit trail.
-- AFTER:  both tables carry a nullable `deleted_at` column. Delete mutations
--         stamp the timestamp; every active read path filters on
--         `deleted_at IS NULL`. Historical reads (rendering legacy invoices,
--         GST HSN aggregation, e-invoice / e-way bill HSN snapshot joins,
--         low-stock alerts on active items) keep or drop the filter per the
--         principle: active operations exclude soft-deleted rows,
--         historical joins include them.
--
-- Partial indexes on (business_id, name) for items and (item_id) for
-- item_variants give the planner a fast path for the active-read hot loop
-- without pulling soft-deleted rows into the index at all. Mirrors the
-- existing `invoices_active_idx`, `payments_active_idx`, `expenses_active_idx`
-- indexes introduced in migration 0006.
--
-- No data migration is required: every existing row defaults to
-- `deleted_at = NULL`, which is "active" under the new filter semantics.
-- Restore/undelete is not implemented in this stage — explicitly deferred
-- per FIXES.md.

ALTER TABLE "item_variants" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "item_variants_active_idx" ON "item_variants" USING btree ("item_id") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "items_active_idx" ON "items" USING btree ("business_id","name") WHERE deleted_at IS NULL;