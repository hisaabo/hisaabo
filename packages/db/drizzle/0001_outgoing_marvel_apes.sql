ALTER TABLE "invoice_items" ADD COLUMN "selected_unit" text;--> statement-breakpoint
ALTER TABLE "invoice_items" ADD COLUMN "conversion_factor" numeric(10, 4) DEFAULT '1';