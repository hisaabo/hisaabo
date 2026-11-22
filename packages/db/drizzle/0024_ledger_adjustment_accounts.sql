-- Data-only migration: system accounts the derived ledger posts invoice-level
-- round-off, discount and additional charges to. New businesses get them from
-- the chart-of-accounts seed (packages/api/src/lib/coa-seed.ts); this adds them
-- to every EXISTING business. Idempotent: a business that already has an
-- account with the code (the system one from a previous run, or one the user
-- created) is left alone, and the ledger then falls back to a seeded account
-- (see ledger-documents.ts).
INSERT INTO "chart_of_accounts" ("business_id", "code", "name", "account_type", "is_system", "is_active")
SELECT "id", '4020', 'Other Charges', 'income', true, true
FROM "businesses"
WHERE NOT EXISTS (
  SELECT 1 FROM "chart_of_accounts" coa
  WHERE coa."business_id" = "businesses"."id" AND coa."code" = '4020'
);
--> statement-breakpoint
INSERT INTO "chart_of_accounts" ("business_id", "code", "name", "account_type", "is_system", "is_active")
SELECT "id", '5020', 'Discount Allowed', 'expense', true, true
FROM "businesses"
WHERE NOT EXISTS (
  SELECT 1 FROM "chart_of_accounts" coa
  WHERE coa."business_id" = "businesses"."id" AND coa."code" = '5020'
);
--> statement-breakpoint
INSERT INTO "chart_of_accounts" ("business_id", "code", "name", "account_type", "is_system", "is_active")
SELECT "id", '5030', 'Round Off', 'expense', true, true
FROM "businesses"
WHERE NOT EXISTS (
  SELECT 1 FROM "chart_of_accounts" coa
  WHERE coa."business_id" = "businesses"."id" AND coa."code" = '5030'
);
--> statement-breakpoint
INSERT INTO "chart_of_accounts" ("business_id", "code", "name", "account_type", "is_system", "is_active")
SELECT "id", '2900', 'Suspense / Unreconciled', 'liability', true, true
FROM "businesses"
WHERE NOT EXISTS (
  SELECT 1 FROM "chart_of_accounts" coa
  WHERE coa."business_id" = "businesses"."id" AND coa."code" = '2900'
);
