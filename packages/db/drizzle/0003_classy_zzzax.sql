CREATE TYPE "public"."recurring_frequency" AS ENUM('weekly', 'biweekly', 'monthly', 'quarterly', 'half_yearly', 'yearly', 'custom');--> statement-breakpoint
CREATE TYPE "public"."recurring_run_status" AS ENUM('success', 'failed', 'skipped_limit');--> statement-breakpoint
CREATE TYPE "public"."recurring_template_status" AS ENUM('active', 'paused', 'completed', 'expired');--> statement-breakpoint
CREATE TABLE "recurring_invoice_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"template_id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"invoice_id" uuid,
	"status" "recurring_run_status" NOT NULL,
	"error_message" text,
	"executed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recurring_invoice_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"party_id" uuid NOT NULL,
	"name" text NOT NULL,
	"type" "invoice_type" NOT NULL,
	"frequency" "recurring_frequency" NOT NULL,
	"custom_interval_days" integer,
	"line_items" jsonb NOT NULL,
	"notes" text,
	"terms_and_conditions" text,
	"additional_charges" numeric(15, 2) DEFAULT '0' NOT NULL,
	"charges" jsonb,
	"status" "recurring_template_status" DEFAULT 'active' NOT NULL,
	"start_date" timestamp with time zone NOT NULL,
	"end_date" timestamp with time zone,
	"next_run_date" timestamp with time zone NOT NULL,
	"last_run_date" timestamp with time zone,
	"total_runs" integer DEFAULT 0 NOT NULL,
	"max_runs" integer,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "recurring_invoice_runs" ADD CONSTRAINT "recurring_invoice_runs_template_id_recurring_invoice_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."recurring_invoice_templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_invoice_runs" ADD CONSTRAINT "recurring_invoice_runs_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_invoice_runs" ADD CONSTRAINT "recurring_invoice_runs_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_invoice_templates" ADD CONSTRAINT "recurring_invoice_templates_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_invoice_templates" ADD CONSTRAINT "recurring_invoice_templates_party_id_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."parties"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "recurring_run_template_idx" ON "recurring_invoice_runs" USING btree ("template_id");--> statement-breakpoint
CREATE INDEX "recurring_run_business_idx" ON "recurring_invoice_runs" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "recurring_run_executed_idx" ON "recurring_invoice_runs" USING btree ("business_id","executed_at");--> statement-breakpoint
CREATE INDEX "recurring_tpl_business_idx" ON "recurring_invoice_templates" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "recurring_tpl_party_idx" ON "recurring_invoice_templates" USING btree ("party_id");--> statement-breakpoint
CREATE INDEX "recurring_tpl_status_idx" ON "recurring_invoice_templates" USING btree ("business_id","status");--> statement-breakpoint
CREATE INDEX "recurring_tpl_next_run_idx" ON "recurring_invoice_templates" USING btree ("status","next_run_date");