CREATE TYPE "public"."account_type" AS ENUM('asset', 'liability', 'equity', 'income', 'expense');--> statement-breakpoint
CREATE TYPE "public"."bank_statement_import_status" AS ENUM('pending', 'mapped', 'processing', 'review', 'completed');--> statement-breakpoint
CREATE TYPE "public"."bank_statement_match_status" AS ENUM('auto_matched', 'manual_matched', 'unmatched', 'created', 'ignored');--> statement-breakpoint
CREATE TYPE "public"."eway_bill_status" AS ENUM('generated', 'active', 'cancelled', 'expired');--> statement-breakpoint
CREATE TYPE "public"."itc_status" AS ENUM('available', 'utilized', 'reversed', 'reclaimed', 'blocked');--> statement-breakpoint
CREATE TABLE "bank_categorization_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"bank_account_id" uuid,
	"match_field" text NOT NULL,
	"match_type" text NOT NULL,
	"match_value" text NOT NULL,
	"action" text NOT NULL,
	"expense_category" text,
	"party_id" uuid,
	"priority" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"hit_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bank_statement_imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"bank_account_id" uuid NOT NULL,
	"file_name" text NOT NULL,
	"status" "bank_statement_import_status" DEFAULT 'pending' NOT NULL,
	"template_id" uuid,
	"template_version" integer,
	"column_mapping" jsonb,
	"total_lines" integer DEFAULT 0 NOT NULL,
	"matched_lines" integer DEFAULT 0 NOT NULL,
	"unmatched_lines" integer DEFAULT 0 NOT NULL,
	"statement_start_date" timestamp with time zone,
	"statement_end_date" timestamp with time zone,
	"closing_balance" numeric(15, 2),
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bank_statement_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"import_id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"line_number" integer NOT NULL,
	"transaction_date" timestamp with time zone NOT NULL,
	"narration" text,
	"debit" numeric(15, 2) DEFAULT '0' NOT NULL,
	"credit" numeric(15, 2) DEFAULT '0' NOT NULL,
	"balance" numeric(15, 2),
	"reference_number" text,
	"raw_data" jsonb,
	"match_status" "bank_statement_match_status" DEFAULT 'unmatched' NOT NULL,
	"match_confidence" numeric(3, 2),
	"matched_payment_id" uuid,
	"matched_expense_id" uuid,
	"matched_bank_transaction_id" uuid,
	"auto_category" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bank_statement_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"bank_slug" text NOT NULL,
	"bank_display_name" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"label" text,
	"is_seeded" boolean DEFAULT false NOT NULL,
	"forked_from_id" uuid,
	"column_mapping" jsonb NOT NULL,
	"preprocess_rules" jsonb,
	"detection_rules" jsonb,
	"file_format" text DEFAULT 'csv' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chart_of_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"account_type" "account_type" NOT NULL,
	"parent_id" uuid,
	"is_system" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "e_invoice_configs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"gstin" text NOT NULL,
	"client_id" text NOT NULL,
	"client_secret" text NOT NULL,
	"username" text NOT NULL,
	"password" text NOT NULL,
	"auth_token" text,
	"token_expires_at" timestamp with time zone,
	"is_sandbox" boolean DEFAULT true NOT NULL,
	"is_enabled" boolean DEFAULT false NOT NULL,
	"threshold_crore" numeric(5, 2) DEFAULT '5' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "eway_bill_vehicle_updates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"eway_bill_id" uuid NOT NULL,
	"vehicle_number" text NOT NULL,
	"from_place" text,
	"reason" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "eway_bills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"invoice_id" uuid,
	"ewb_number" text,
	"ewb_date" timestamp with time zone,
	"valid_upto" timestamp with time zone,
	"status" "eway_bill_status" DEFAULT 'generated' NOT NULL,
	"transporter_id" text,
	"transporter_name" text,
	"vehicle_number" text,
	"vehicle_type" text,
	"transport_mode" text,
	"distance" integer,
	"from_address" text,
	"from_pincode" text,
	"from_state" text,
	"to_address" text,
	"to_pincode" text,
	"to_state" text,
	"cancel_reason" text,
	"api_response" jsonb,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gstr2b_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"upload_id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"supplier_gstin" text NOT NULL,
	"supplier_name" text,
	"invoice_number" text NOT NULL,
	"invoice_date" timestamp with time zone,
	"invoice_value" numeric(15, 2) DEFAULT '0' NOT NULL,
	"taxable_value" numeric(15, 2) DEFAULT '0' NOT NULL,
	"cgst" numeric(15, 2) DEFAULT '0' NOT NULL,
	"sgst" numeric(15, 2) DEFAULT '0' NOT NULL,
	"igst" numeric(15, 2) DEFAULT '0' NOT NULL,
	"cess" numeric(15, 2) DEFAULT '0' NOT NULL,
	"itc_available" text,
	"reason" text,
	"source_type" text,
	"match_status" text DEFAULT 'pending' NOT NULL,
	"matched_invoice_id" uuid,
	"mismatch_reasons" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gstr2b_uploads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"return_period" text NOT NULL,
	"file_name" text NOT NULL,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"total_records" integer DEFAULT 0 NOT NULL,
	"matched_records" integer DEFAULT 0 NOT NULL,
	"unmatched_records" integer DEFAULT 0 NOT NULL,
	"new_records" integer DEFAULT 0 NOT NULL,
	"created_by_user_id" uuid
);
--> statement-breakpoint
CREATE TABLE "itc_ledger_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"invoice_id" uuid,
	"return_period" text NOT NULL,
	"status" "itc_status" NOT NULL,
	"cgst" numeric(15, 2) DEFAULT '0' NOT NULL,
	"sgst" numeric(15, 2) DEFAULT '0' NOT NULL,
	"igst" numeric(15, 2) DEFAULT '0' NOT NULL,
	"cess" numeric(15, 2) DEFAULT '0' NOT NULL,
	"is_reverse_charge" boolean DEFAULT false NOT NULL,
	"block_reason" text,
	"reversal_reason" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "itc_utilizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"return_period" text NOT NULL,
	"cgst_utilized" numeric(15, 2) DEFAULT '0' NOT NULL,
	"sgst_utilized" numeric(15, 2) DEFAULT '0' NOT NULL,
	"igst_utilized_against_cgst" numeric(15, 2) DEFAULT '0' NOT NULL,
	"igst_utilized_against_sgst" numeric(15, 2) DEFAULT '0' NOT NULL,
	"igst_utilized_against_igst" numeric(15, 2) DEFAULT '0' NOT NULL,
	"notes" text,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "journal_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"entry_number" text NOT NULL,
	"entry_date" timestamp with time zone NOT NULL,
	"narration" text,
	"source" text DEFAULT 'manual' NOT NULL,
	"is_voided" boolean DEFAULT false NOT NULL,
	"voided_by_entry_id" uuid,
	"reverses_entry_id" uuid,
	"created_by_user_id" uuid,
	"created_by_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "journal_entry_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"journal_entry_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"debit" numeric(15, 2) DEFAULT '0' NOT NULL,
	"credit" numeric(15, 2) DEFAULT '0' NOT NULL,
	"narration" text
);
--> statement-breakpoint
CREATE TABLE "journal_entry_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"name" text NOT NULL,
	"narration" text,
	"lines" jsonb NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "debit_note_prefix" text DEFAULT 'DN' NOT NULL;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "next_debit_note_number" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "sales_return_prefix" text DEFAULT 'SR' NOT NULL;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "next_sales_return_number" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "purchase_return_prefix" text DEFAULT 'PR' NOT NULL;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "next_purchase_return_number" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "annual_turnover" numeric(15, 2);--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "is_reverse_charge" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "irn" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "irn_ack_number" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "irn_ack_date" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "signed_qr_code" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "signed_invoice" jsonb;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "e_invoice_status" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "e_invoice_error" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "e_invoice_retry_count" integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "e_invoice_cancel_reason" text;--> statement-breakpoint
ALTER TABLE "bank_categorization_rules" ADD CONSTRAINT "bank_categorization_rules_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_categorization_rules" ADD CONSTRAINT "bank_categorization_rules_bank_account_id_bank_accounts_id_fk" FOREIGN KEY ("bank_account_id") REFERENCES "public"."bank_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_statement_imports" ADD CONSTRAINT "bank_statement_imports_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_statement_imports" ADD CONSTRAINT "bank_statement_imports_bank_account_id_bank_accounts_id_fk" FOREIGN KEY ("bank_account_id") REFERENCES "public"."bank_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_statement_imports" ADD CONSTRAINT "bank_statement_imports_template_id_bank_statement_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."bank_statement_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_statement_lines" ADD CONSTRAINT "bank_statement_lines_import_id_bank_statement_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."bank_statement_imports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_statement_lines" ADD CONSTRAINT "bank_statement_lines_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_statement_templates" ADD CONSTRAINT "bank_statement_templates_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chart_of_accounts" ADD CONSTRAINT "chart_of_accounts_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "e_invoice_configs" ADD CONSTRAINT "e_invoice_configs_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eway_bill_vehicle_updates" ADD CONSTRAINT "eway_bill_vehicle_updates_eway_bill_id_eway_bills_id_fk" FOREIGN KEY ("eway_bill_id") REFERENCES "public"."eway_bills"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eway_bills" ADD CONSTRAINT "eway_bills_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eway_bills" ADD CONSTRAINT "eway_bills_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gstr2b_records" ADD CONSTRAINT "gstr2b_records_upload_id_gstr2b_uploads_id_fk" FOREIGN KEY ("upload_id") REFERENCES "public"."gstr2b_uploads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gstr2b_records" ADD CONSTRAINT "gstr2b_records_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gstr2b_uploads" ADD CONSTRAINT "gstr2b_uploads_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "itc_ledger_entries" ADD CONSTRAINT "itc_ledger_entries_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "itc_ledger_entries" ADD CONSTRAINT "itc_ledger_entries_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "itc_utilizations" ADD CONSTRAINT "itc_utilizations_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entry_lines" ADD CONSTRAINT "journal_entry_lines_journal_entry_id_journal_entries_id_fk" FOREIGN KEY ("journal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entry_lines" ADD CONSTRAINT "journal_entry_lines_account_id_chart_of_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."chart_of_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entry_templates" ADD CONSTRAINT "journal_entry_templates_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bcr_business_idx" ON "bank_categorization_rules" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "bsi_business_idx" ON "bank_statement_imports" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "bsi_bank_account_idx" ON "bank_statement_imports" USING btree ("bank_account_id");--> statement-breakpoint
CREATE INDEX "bsl_import_idx" ON "bank_statement_lines" USING btree ("import_id");--> statement-breakpoint
CREATE INDEX "bsl_business_idx" ON "bank_statement_lines" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "bsl_date_idx" ON "bank_statement_lines" USING btree ("business_id","transaction_date");--> statement-breakpoint
CREATE INDEX "bsl_status_idx" ON "bank_statement_lines" USING btree ("import_id","match_status");--> statement-breakpoint
CREATE INDEX "bsl_dedup_idx" ON "bank_statement_lines" USING btree ("business_id","transaction_date","debit","credit","reference_number");--> statement-breakpoint
CREATE INDEX "bst_business_idx" ON "bank_statement_templates" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "bst_bank_slug_idx" ON "bank_statement_templates" USING btree ("business_id","bank_slug");--> statement-breakpoint
CREATE UNIQUE INDEX "bst_business_bank_version_idx" ON "bank_statement_templates" USING btree ("business_id","bank_slug","version","file_format");--> statement-breakpoint
CREATE INDEX "coa_business_idx" ON "chart_of_accounts" USING btree ("business_id");--> statement-breakpoint
CREATE UNIQUE INDEX "coa_business_code_idx" ON "chart_of_accounts" USING btree ("business_id","code");--> statement-breakpoint
CREATE INDEX "coa_parent_idx" ON "chart_of_accounts" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "coa_type_idx" ON "chart_of_accounts" USING btree ("business_id","account_type");--> statement-breakpoint
CREATE UNIQUE INDEX "einv_config_business_idx" ON "e_invoice_configs" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "ewb_vehicle_ewb_idx" ON "eway_bill_vehicle_updates" USING btree ("eway_bill_id");--> statement-breakpoint
CREATE INDEX "ewb_business_idx" ON "eway_bills" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "ewb_invoice_idx" ON "eway_bills" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "ewb_number_idx" ON "eway_bills" USING btree ("ewb_number");--> statement-breakpoint
CREATE INDEX "ewb_status_idx" ON "eway_bills" USING btree ("business_id","status");--> statement-breakpoint
CREATE INDEX "ewb_validity_idx" ON "eway_bills" USING btree ("business_id","valid_upto");--> statement-breakpoint
CREATE INDEX "g2br_upload_idx" ON "gstr2b_records" USING btree ("upload_id");--> statement-breakpoint
CREATE INDEX "g2br_business_idx" ON "gstr2b_records" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "g2br_gstin_idx" ON "gstr2b_records" USING btree ("business_id","supplier_gstin");--> statement-breakpoint
CREATE INDEX "g2br_match_idx" ON "gstr2b_records" USING btree ("upload_id","match_status");--> statement-breakpoint
CREATE INDEX "g2b_business_idx" ON "gstr2b_uploads" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "g2b_period_idx" ON "gstr2b_uploads" USING btree ("business_id","return_period");--> statement-breakpoint
CREATE INDEX "itc_business_idx" ON "itc_ledger_entries" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "itc_invoice_idx" ON "itc_ledger_entries" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "itc_period_idx" ON "itc_ledger_entries" USING btree ("business_id","return_period");--> statement-breakpoint
CREATE INDEX "itc_status_idx" ON "itc_ledger_entries" USING btree ("business_id","status");--> statement-breakpoint
CREATE INDEX "itc_util_business_idx" ON "itc_utilizations" USING btree ("business_id");--> statement-breakpoint
CREATE UNIQUE INDEX "itc_util_period_idx" ON "itc_utilizations" USING btree ("business_id","return_period");--> statement-breakpoint
CREATE INDEX "je_business_idx" ON "journal_entries" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "je_date_idx" ON "journal_entries" USING btree ("business_id","entry_date");--> statement-breakpoint
CREATE UNIQUE INDEX "je_number_idx" ON "journal_entries" USING btree ("business_id","entry_number");--> statement-breakpoint
CREATE INDEX "jel_entry_idx" ON "journal_entry_lines" USING btree ("journal_entry_id");--> statement-breakpoint
CREATE INDEX "jel_account_idx" ON "journal_entry_lines" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "jet_business_idx" ON "journal_entry_templates" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "expenses_active_idx" ON "expenses" USING btree ("business_id","expense_date") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "invoices_einvoice_status_idx" ON "invoices" USING btree ("business_id","e_invoice_status");--> statement-breakpoint
CREATE INDEX "invoices_active_idx" ON "invoices" USING btree ("business_id","invoice_date") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "invoices_active_type_idx" ON "invoices" USING btree ("business_id","type","document_type","invoice_date") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "payments_active_idx" ON "payments" USING btree ("business_id","payment_date") WHERE deleted_at IS NULL;