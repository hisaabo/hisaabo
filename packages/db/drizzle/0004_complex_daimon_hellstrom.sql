ALTER TABLE "sessions" ADD COLUMN "last_used_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "store_orders_invoice_idx" ON "store_orders" USING btree ("invoice_id");