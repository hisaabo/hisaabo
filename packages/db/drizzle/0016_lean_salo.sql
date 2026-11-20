DROP INDEX "bsl_import_idx";--> statement-breakpoint
DROP INDEX "bank_txn_date_idx";--> statement-breakpoint
CREATE INDEX "items_active_updated_idx" ON "items" USING btree ("business_id","updated_at" DESC,"id" DESC) WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "bsl_import_idx" ON "bank_statement_lines" USING btree ("import_id","line_number");--> statement-breakpoint
CREATE INDEX "bank_txn_date_idx" ON "bank_transactions" USING btree ("bank_account_id","transaction_date","created_at","id");