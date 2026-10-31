CREATE TABLE "tds_section_configs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"section_code" text NOT NULL,
	"section_label" text NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"effective_to" timestamp with time zone,
	"status" text DEFAULT 'active' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "parties" ADD COLUMN "tan" text;--> statement-breakpoint
ALTER TABLE "payment_allocations" ADD COLUMN "tds_amount" numeric(15, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "payment_allocations" ADD COLUMN "tds_section_code" text;--> statement-breakpoint
ALTER TABLE "payment_allocations" ADD COLUMN "tds_rate" numeric(5, 2);--> statement-breakpoint
ALTER TABLE "tds_section_configs" ADD CONSTRAINT "tds_section_configs_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "tds_section_configs_business_code_version_idx" ON "tds_section_configs" USING btree ("business_id","section_code","version");--> statement-breakpoint
CREATE INDEX "tds_section_configs_active_idx" ON "tds_section_configs" USING btree ("business_id","section_code","effective_from");
--> statement-breakpoint
INSERT INTO "chart_of_accounts" ("business_id", "code", "name", "account_type", "is_system", "is_active")
SELECT "id", '1600', 'TDS Receivable', 'asset', true, true
FROM "businesses"
WHERE NOT EXISTS (
  SELECT 1 FROM "chart_of_accounts" coa
  WHERE coa."business_id" = "businesses"."id" AND coa."code" = '1600'
);