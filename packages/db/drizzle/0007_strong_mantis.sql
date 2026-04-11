-- Bug B — Split invoice_items.description into itemName snapshot + optional free-text notes.
--
-- BEFORE: invoice_items had a single "description" text column, used doubly as
--         both the item-name display AND a would-be free-text notes field.
-- AFTER:  invoice_items has "item_name" (required snapshot of the billed item
--         name at create time) and "description" (optional free-text line notes).
--
-- Migration strategy (idempotent, zero data loss):
--   1. RENAME the existing "description" column to "item_name". All existing
--      data in the column is already an item-name snapshot in practice (every
--      write path — web, mobile, imports — wrote the item name into
--      "description" via a fallback chain), so the rename preserves meaning.
--   2. ADD a new nullable "description" column for the free-text notes field.
--      Starts NULL on every row, which is correct — historical invoices have
--      no user-authored line notes.
--
-- Drizzle-kit generated a DROP-NOT-NULL + ADD-COLUMN pair instead of a rename
-- (rename detection requires interactive confirmation). The generated SQL was
-- hand-edited to perform the safe rename + add instead. The snapshot
-- (meta/0007_snapshot.json) already reflects the desired final state, so no
-- snapshot edit is needed.
--
-- Also migrates recurring_invoice_templates.line_items JSONB: each element's
-- "description" key is renamed to "itemName", with a new "description": null
-- key added. This keeps recurring templates in lockstep with the new
-- invoice_items shape so generated invoices carry the correct fields.

ALTER TABLE "invoice_items" RENAME COLUMN "description" TO "item_name";--> statement-breakpoint
ALTER TABLE "invoice_items" ADD COLUMN "description" text;--> statement-breakpoint

UPDATE "recurring_invoice_templates"
SET "line_items" = COALESCE(
  (
    SELECT jsonb_agg(
      CASE
        WHEN elem ? 'description' AND NOT (elem ? 'itemName') THEN
          (elem - 'description')
          || jsonb_build_object('itemName', elem->'description')
          || jsonb_build_object('description', NULL::jsonb)
        ELSE elem
      END
      ORDER BY ord
    )
    FROM jsonb_array_elements("line_items") WITH ORDINALITY AS t(elem, ord)
  ),
  "line_items"
)
WHERE "line_items" IS NOT NULL
  AND jsonb_typeof("line_items") = 'array';
