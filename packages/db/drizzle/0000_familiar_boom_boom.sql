CREATE TYPE "public"."member_role" AS ENUM('owner', 'admin', 'member', 'viewer');--> statement-breakpoint
CREATE TYPE "public"."tenant_plan" AS ENUM('free', 'pro', 'business', 'enterprise');--> statement-breakpoint
CREATE TYPE "public"."tenant_status" AS ENUM('active', 'suspended', 'deleted');--> statement-breakpoint
CREATE TYPE "public"."bank_account_type" AS ENUM('savings', 'current', 'cash', 'upi', 'credit_card');--> statement-breakpoint
CREATE TYPE "public"."bank_transaction_type" AS ENUM('deposit', 'withdrawal', 'transfer');--> statement-breakpoint
CREATE TYPE "public"."document_type" AS ENUM('invoice', 'quotation', 'credit_note', 'debit_note', 'delivery_challan', 'proforma', 'sales_return', 'purchase_return');--> statement-breakpoint
CREATE TYPE "public"."invoice_status" AS ENUM('draft', 'sent', 'paid', 'partial', 'overdue', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."invoice_type" AS ENUM('sale', 'purchase');--> statement-breakpoint
CREATE TYPE "public"."item_type" AS ENUM('product', 'service');--> statement-breakpoint
CREATE TYPE "public"."party_type" AS ENUM('customer', 'supplier');--> statement-breakpoint
CREATE TYPE "public"."payment_mode" AS ENUM('cash', 'bank', 'upi', 'cheque', 'other');--> statement-breakpoint
CREATE TYPE "public"."unit" AS ENUM('pcs', 'kg', 'g', 'l', 'ml', 'm', 'cm', 'ft', 'in', 'box', 'dozen', 'pair', 'set', 'other');--> statement-breakpoint
CREATE TABLE "invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"email" text NOT NULL,
	"role" "member_role" DEFAULT 'member' NOT NULL,
	"token" text NOT NULL,
	"invited_by" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"tenant_id" uuid
);
--> statement-breakpoint
CREATE TABLE "tenant_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "member_role" DEFAULT 'member' NOT NULL,
	"invited_by" uuid,
	"accepted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"db_name" text,
	"db_host" text,
	"db_port" text,
	"db_user" text,
	"db_password" text,
	"plan" "tenant_plan" DEFAULT 'free' NOT NULL,
	"status" "tenant_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"password_hash" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid,
	"metadata" text,
	"ip_address" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bank_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"account_name" text NOT NULL,
	"account_number" text,
	"ifsc" text,
	"bank_name" text,
	"account_type" "bank_account_type" DEFAULT 'savings' NOT NULL,
	"opening_balance" numeric(15, 2) DEFAULT '0' NOT NULL,
	"current_balance" numeric(15, 2) DEFAULT '0' NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bank_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"bank_account_id" uuid NOT NULL,
	"type" "bank_transaction_type" NOT NULL,
	"amount" numeric(15, 2) NOT NULL,
	"description" text,
	"reference_type" text,
	"reference_id" uuid,
	"transaction_date" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "businesses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"legal_name" text,
	"gstin" text,
	"pan" text,
	"phone" text,
	"email" text,
	"address" text,
	"city" text,
	"state" text,
	"pincode" text,
	"logo_url" text,
	"invoice_prefix" text DEFAULT 'INV' NOT NULL,
	"next_invoice_number" integer DEFAULT 1 NOT NULL,
	"payment_prefix" text DEFAULT 'PAY' NOT NULL,
	"next_payment_number" integer DEFAULT 1 NOT NULL,
	"quotation_prefix" text DEFAULT 'QTN' NOT NULL,
	"next_quotation_number" integer DEFAULT 1 NOT NULL,
	"credit_note_prefix" text DEFAULT 'CN' NOT NULL,
	"next_credit_note_number" integer DEFAULT 1 NOT NULL,
	"delivery_challan_prefix" text DEFAULT 'DC' NOT NULL,
	"next_delivery_challan_number" integer DEFAULT 1 NOT NULL,
	"proforma_prefix" text DEFAULT 'PI' NOT NULL,
	"next_proforma_number" integer DEFAULT 1 NOT NULL,
	"financial_year_start_month" integer DEFAULT 4 NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "expenses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"category" text NOT NULL,
	"description" text,
	"amount" numeric(15, 2) NOT NULL,
	"mode" "payment_mode" NOT NULL,
	"expense_date" timestamp with time zone DEFAULT now() NOT NULL,
	"reference_number" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoice_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"item_id" uuid,
	"description" text NOT NULL,
	"quantity" numeric(15, 3) NOT NULL,
	"unit_price" numeric(15, 2) NOT NULL,
	"tax_percent" numeric(5, 2) DEFAULT '0' NOT NULL,
	"tax_amount" numeric(15, 2) DEFAULT '0' NOT NULL,
	"discount_percent" numeric(5, 2) DEFAULT '0' NOT NULL,
	"total_amount" numeric(15, 2) NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"party_id" uuid NOT NULL,
	"type" "invoice_type" NOT NULL,
	"status" "invoice_status" DEFAULT 'draft' NOT NULL,
	"document_type" "document_type" DEFAULT 'invoice' NOT NULL,
	"invoice_number" text NOT NULL,
	"invoice_date" timestamp with time zone DEFAULT now() NOT NULL,
	"due_date" timestamp with time zone,
	"subtotal" numeric(15, 2) DEFAULT '0' NOT NULL,
	"tax_amount" numeric(15, 2) DEFAULT '0' NOT NULL,
	"discount_amount" numeric(15, 2) DEFAULT '0' NOT NULL,
	"charges" jsonb,
	"additional_charges" numeric(15, 2) DEFAULT '0' NOT NULL,
	"round_off" numeric(15, 2) DEFAULT '0' NOT NULL,
	"total_amount" numeric(15, 2) DEFAULT '0' NOT NULL,
	"amount_paid" numeric(15, 2) DEFAULT '0' NOT NULL,
	"notes" text,
	"terms_and_conditions" text,
	"reference_document_id" uuid,
	"source" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"name" text NOT NULL,
	"hsn" text,
	"sku" text,
	"unit" "unit" DEFAULT 'pcs' NOT NULL,
	"unit_variants" jsonb,
	"sale_price" numeric(15, 2),
	"purchase_price" numeric(15, 2),
	"tax_percent" numeric(5, 2) DEFAULT '0' NOT NULL,
	"stock_quantity" numeric(15, 3) DEFAULT '0' NOT NULL,
	"low_stock_alert" numeric(15, 3),
	"description" text,
	"item_type" "item_type" DEFAULT 'product' NOT NULL,
	"category" text,
	"tax_inclusive" boolean DEFAULT false NOT NULL,
	"source" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "parties" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"type" "party_type" NOT NULL,
	"name" text NOT NULL,
	"phone" text,
	"email" text,
	"gstin" text,
	"pan" text,
	"billing_address" text,
	"shipping_address" text,
	"city" text,
	"state" text,
	"pincode" text,
	"opening_balance" numeric(15, 2) DEFAULT '0' NOT NULL,
	"category" text,
	"credit_period_days" integer,
	"credit_limit" numeric(15, 2),
	"contact_person_name" text,
	"contact_person_dob" timestamp with time zone,
	"bank_account_number" text,
	"bank_ifsc" text,
	"bank_name" text,
	"source" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payment_number" text,
	"business_id" uuid NOT NULL,
	"invoice_id" uuid,
	"party_id" uuid NOT NULL,
	"amount" numeric(15, 2) NOT NULL,
	"discount" numeric(15, 2) DEFAULT '0' NOT NULL,
	"mode" "payment_mode" NOT NULL,
	"reference_number" text,
	"payment_date" timestamp with time zone DEFAULT now() NOT NULL,
	"notes" text,
	"bank_account_id" uuid,
	"source" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_members" ADD CONSTRAINT "tenant_members_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_members" ADD CONSTRAINT "tenant_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_members" ADD CONSTRAINT "tenant_members_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_bank_account_id_bank_accounts_id_fk" FOREIGN KEY ("bank_account_id") REFERENCES "public"."bank_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_party_id_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."parties"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parties" ADD CONSTRAINT "parties_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_party_id_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."parties"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "invitations_token_idx" ON "invitations" USING btree ("token");--> statement-breakpoint
CREATE INDEX "invitations_email_idx" ON "invitations" USING btree ("email");--> statement-breakpoint
CREATE INDEX "invitations_tenant_idx" ON "invitations" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_tenant_idx" ON "sessions" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tenant_members_unique_idx" ON "tenant_members" USING btree ("tenant_id","user_id");--> statement-breakpoint
CREATE INDEX "tenant_members_user_idx" ON "tenant_members" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tenants_slug_idx" ON "tenants" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_idx" ON "users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "audit_log_business_idx" ON "audit_log" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "audit_log_entity_idx" ON "audit_log" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "audit_log_date_idx" ON "audit_log" USING btree ("business_id","created_at");--> statement-breakpoint
CREATE INDEX "bank_accounts_business_idx" ON "bank_accounts" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "bank_txn_business_idx" ON "bank_transactions" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "bank_txn_account_idx" ON "bank_transactions" USING btree ("bank_account_id");--> statement-breakpoint
CREATE INDEX "bank_txn_date_idx" ON "bank_transactions" USING btree ("bank_account_id","transaction_date");--> statement-breakpoint
CREATE INDEX "bank_txn_ref_idx" ON "bank_transactions" USING btree ("reference_type","reference_id");--> statement-breakpoint
CREATE INDEX "businesses_owner_idx" ON "businesses" USING btree ("created_by_user_id");--> statement-breakpoint
CREATE INDEX "expenses_business_idx" ON "expenses" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "expenses_date_idx" ON "expenses" USING btree ("business_id","expense_date");--> statement-breakpoint
CREATE INDEX "expenses_category_idx" ON "expenses" USING btree ("business_id","category");--> statement-breakpoint
CREATE INDEX "invoice_items_invoice_idx" ON "invoice_items" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "invoice_items_item_idx" ON "invoice_items" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "invoices_business_idx" ON "invoices" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "invoices_party_idx" ON "invoices" USING btree ("party_id");--> statement-breakpoint
CREATE INDEX "invoices_status_idx" ON "invoices" USING btree ("business_id","status");--> statement-breakpoint
CREATE INDEX "invoices_date_idx" ON "invoices" USING btree ("business_id","invoice_date");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_number_idx" ON "invoices" USING btree ("business_id","invoice_number");--> statement-breakpoint
CREATE INDEX "invoices_doc_type_idx" ON "invoices" USING btree ("business_id","document_type");--> statement-breakpoint
CREATE INDEX "invoices_party_date_idx" ON "invoices" USING btree ("business_id","party_id","invoice_date");--> statement-breakpoint
CREATE INDEX "invoices_ref_doc_idx" ON "invoices" USING btree ("reference_document_id");--> statement-breakpoint
CREATE INDEX "items_business_idx" ON "items" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "items_name_idx" ON "items" USING btree ("business_id","name");--> statement-breakpoint
CREATE INDEX "items_sku_idx" ON "items" USING btree ("business_id","sku");--> statement-breakpoint
CREATE INDEX "parties_business_idx" ON "parties" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "parties_type_idx" ON "parties" USING btree ("business_id","type");--> statement-breakpoint
CREATE INDEX "parties_name_idx" ON "parties" USING btree ("business_id","name");--> statement-breakpoint
CREATE INDEX "payments_business_idx" ON "payments" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "payments_invoice_idx" ON "payments" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "payments_party_idx" ON "payments" USING btree ("party_id");--> statement-breakpoint
CREATE INDEX "payments_date_idx" ON "payments" USING btree ("business_id","payment_date");--> statement-breakpoint
CREATE INDEX "payments_party_date_idx" ON "payments" USING btree ("business_id","party_id","payment_date");