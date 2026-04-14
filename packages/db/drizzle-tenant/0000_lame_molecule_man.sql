CREATE TYPE "public"."account_type" AS ENUM('asset', 'liability', 'equity', 'income', 'expense');--> statement-breakpoint
CREATE TYPE "public"."bank_account_type" AS ENUM('savings', 'current', 'cash', 'upi', 'credit_card', 'payment_gateway');--> statement-breakpoint
CREATE TYPE "public"."bank_statement_import_status" AS ENUM('pending', 'mapped', 'processing', 'review', 'completed');--> statement-breakpoint
CREATE TYPE "public"."bank_statement_match_status" AS ENUM('auto_matched', 'manual_matched', 'unmatched', 'created', 'ignored');--> statement-breakpoint
CREATE TYPE "public"."bank_transaction_type" AS ENUM('deposit', 'withdrawal', 'transfer');--> statement-breakpoint
CREATE TYPE "public"."document_type" AS ENUM('invoice', 'quotation', 'credit_note', 'debit_note', 'delivery_challan', 'proforma', 'sales_return', 'purchase_return');--> statement-breakpoint
CREATE TYPE "public"."eway_bill_status" AS ENUM('generated', 'active', 'cancelled', 'expired');--> statement-breakpoint
CREATE TYPE "public"."gst_registration_type" AS ENUM('regular', 'composition', 'unregistered');--> statement-breakpoint
CREATE TYPE "public"."invoice_status" AS ENUM('draft', 'unfulfilled', 'sent', 'paid', 'partial', 'overdue', 'cancelled', 'adjusted');--> statement-breakpoint
CREATE TYPE "public"."invoice_type" AS ENUM('sale', 'purchase');--> statement-breakpoint
CREATE TYPE "public"."itc_status" AS ENUM('available', 'utilized', 'reversed', 'reclaimed', 'blocked');--> statement-breakpoint
CREATE TYPE "public"."item_mode" AS ENUM('simple', 'alt_units', 'variants');--> statement-breakpoint
CREATE TYPE "public"."item_type" AS ENUM('product', 'service');--> statement-breakpoint
CREATE TYPE "public"."party_type" AS ENUM('customer', 'supplier');--> statement-breakpoint
CREATE TYPE "public"."payment_mode" AS ENUM('cash', 'bank', 'upi', 'cheque', 'other', 'credit_card', 'debit_card', 'net_banking', 'wallet');--> statement-breakpoint
CREATE TYPE "public"."recurring_frequency" AS ENUM('weekly', 'biweekly', 'monthly', 'quarterly', 'half_yearly', 'yearly', 'custom');--> statement-breakpoint
CREATE TYPE "public"."recurring_run_status" AS ENUM('success', 'failed', 'skipped_limit');--> statement-breakpoint
CREATE TYPE "public"."recurring_template_status" AS ENUM('active', 'paused', 'completed', 'expired');--> statement-breakpoint
CREATE TYPE "public"."shipment_status" AS ENUM('pending', 'shipped', 'in_transit', 'delivered', 'returned');--> statement-breakpoint
CREATE TYPE "public"."store_order_status" AS ENUM('pending', 'confirmed', 'preparing', 'ready', 'delivered', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."unit" AS ENUM('pcs', 'kg', 'g', 'l', 'ml', 'm', 'cm', 'ft', 'in', 'box', 'dozen', 'pair', 'set', 'pkt', 'bun', 'pouch', 'jar', 'btl', 'bag', 'ton', 'pack', 'pet', 'person', 'other');--> statement-breakpoint
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
CREATE TABLE "bank_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"bank_account_id" uuid NOT NULL,
	"type" "bank_transaction_type" NOT NULL,
	"amount" numeric(15, 2) NOT NULL,
	"description" text,
	"reference_type" text,
	"reference_id" uuid,
	"payment_id" uuid,
	"transaction_date" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "businesses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"legal_name" text,
	"gst_registration_type" "gst_registration_type" DEFAULT 'unregistered' NOT NULL,
	"gstin" text,
	"pan" text,
	"phone" text,
	"email" text,
	"address" text,
	"city" text,
	"state" text,
	"state_code" text,
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
	"debit_note_prefix" text DEFAULT 'DN' NOT NULL,
	"next_debit_note_number" integer DEFAULT 1 NOT NULL,
	"sales_return_prefix" text DEFAULT 'SR' NOT NULL,
	"next_sales_return_number" integer DEFAULT 1 NOT NULL,
	"purchase_return_prefix" text DEFAULT 'PR' NOT NULL,
	"next_purchase_return_number" integer DEFAULT 1 NOT NULL,
	"delivery_challan_prefix" text DEFAULT 'DC' NOT NULL,
	"next_delivery_challan_number" integer DEFAULT 1 NOT NULL,
	"proforma_prefix" text DEFAULT 'PI' NOT NULL,
	"next_proforma_number" integer DEFAULT 1 NOT NULL,
	"financial_year_start_month" integer DEFAULT 4 NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"annual_turnover" numeric(15, 2),
	"store_enabled" boolean DEFAULT false NOT NULL,
	"store_slug" text,
	"store_tagline" text,
	"store_accent_color" text,
	"store_min_order_amount" numeric(15, 2),
	"store_delivery_note" text,
	"store_whatsapp_number" text,
	"store_allow_negative_stock" boolean DEFAULT false NOT NULL,
	"custom_shipping_methods" jsonb,
	"carrier_credentials" jsonb,
	"next_store_order_number" integer DEFAULT 1 NOT NULL,
	"store_order_prefix" text DEFAULT 'ORD' NOT NULL,
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
CREATE TABLE "expenses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"category" text NOT NULL,
	"description" text,
	"amount" numeric(15, 2) NOT NULL,
	"mode" "payment_mode" NOT NULL,
	"expense_date" timestamp with time zone DEFAULT now() NOT NULL,
	"reference_number" text,
	"bank_account_id" uuid,
	"created_by_user_id" uuid,
	"created_by_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
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
CREATE TABLE "invoice_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"item_id" uuid,
	"item_name" text NOT NULL,
	"description" text,
	"quantity" numeric(15, 3) NOT NULL,
	"unit_price" numeric(15, 2) NOT NULL,
	"tax_percent" numeric(5, 2) DEFAULT '0' NOT NULL,
	"tax_amount" numeric(15, 2) DEFAULT '0' NOT NULL,
	"discount_percent" numeric(5, 2) DEFAULT '0' NOT NULL,
	"total_amount" numeric(15, 2) NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"selected_unit" text,
	"conversion_factor" numeric(10, 4) DEFAULT '1',
	"variant_id" uuid
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
	"created_by_user_id" uuid,
	"created_by_name" text,
	"delivery_method" text DEFAULT 'self_pickup',
	"is_reverse_charge" boolean DEFAULT false NOT NULL,
	"source" text,
	"irn" text,
	"irn_ack_number" text,
	"irn_ack_date" timestamp with time zone,
	"signed_qr_code" text,
	"signed_invoice" jsonb,
	"e_invoice_status" text,
	"e_invoice_error" text,
	"e_invoice_retry_count" integer DEFAULT 0,
	"e_invoice_cancel_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
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
CREATE TABLE "item_variants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_id" uuid NOT NULL,
	"attribute_values" jsonb NOT NULL,
	"sku" text,
	"sale_price" numeric(15, 2),
	"purchase_price" numeric(15, 2),
	"stock_quantity" numeric(15, 3) DEFAULT '0' NOT NULL,
	"low_stock_alert" numeric(15, 3),
	"store_enabled" boolean DEFAULT false NOT NULL,
	"store_price" numeric(15, 2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"name" text NOT NULL,
	"hsn" text,
	"sku" text,
	"unit" "unit" DEFAULT 'pcs' NOT NULL,
	"item_mode" "item_mode" DEFAULT 'simple' NOT NULL,
	"unit_variants" jsonb,
	"variant_attributes" jsonb,
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
	"store_enabled" boolean DEFAULT false NOT NULL,
	"store_price" numeric(15, 2),
	"store_sort_order" integer DEFAULT 0 NOT NULL,
	"store_category" text,
	"store_description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
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
	"state_code" text,
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
CREATE TABLE "payment_allocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payment_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"amount" numeric(15, 2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_gateway_configs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"bank_account_id" uuid NOT NULL,
	"settlement_account_id" uuid NOT NULL,
	"charge_config" jsonb NOT NULL,
	"expense_category" text DEFAULT 'Payment Gateway Charges' NOT NULL,
	"auto_settle" boolean DEFAULT true NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
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
	"created_by_user_id" uuid,
	"created_by_name" text,
	"source" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
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
CREATE TABLE "sales_targets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"target_type" text NOT NULL,
	"target_value" numeric(15, 2) NOT NULL,
	"item_id" uuid,
	"period_type" text NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"notes" text,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shipment_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shipment_id" uuid NOT NULL,
	"status" text NOT NULL,
	"status_detail" text,
	"location" text,
	"source" text DEFAULT 'manual',
	"carrier_status" text,
	"event_time" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shipments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"invoice_id" uuid,
	"party_id" uuid,
	"carrier" text,
	"mode" text,
	"tracking_number" text,
	"tracking_url" text,
	"cost" numeric(15, 2) DEFAULT '0' NOT NULL,
	"weight" numeric(10, 3),
	"shipping_address" text,
	"shipping_city" text,
	"shipping_pincode" text,
	"carrier_order_id" text,
	"label_url" text,
	"manifest_id" text,
	"carrier_meta" jsonb,
	"status" "shipment_status" DEFAULT 'pending' NOT NULL,
	"shipment_date" timestamp with time zone,
	"estimated_delivery" timestamp with time zone,
	"actual_delivery" timestamp with time zone,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_adjustments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"variant_id" uuid,
	"quantity" numeric(15, 3) NOT NULL,
	"previous_stock" numeric(15, 3) NOT NULL,
	"new_stock" numeric(15, 3) NOT NULL,
	"reason" text,
	"adjustment_date" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_user_id" uuid,
	"created_by_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "store_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"invoice_id" uuid,
	"order_number" text NOT NULL,
	"status" "store_order_status" DEFAULT 'pending' NOT NULL,
	"customer_name" text NOT NULL,
	"customer_phone" text NOT NULL,
	"customer_email" text,
	"delivery_address" text,
	"delivery_city" text,
	"delivery_pincode" text,
	"delivery_notes" text,
	"total_amount" numeric(15, 2) DEFAULT '0' NOT NULL,
	"item_count" integer DEFAULT 0 NOT NULL,
	"source" text DEFAULT 'online_store' NOT NULL,
	"confirmed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancellation_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_categorization_rules" ADD CONSTRAINT "bank_categorization_rules_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_categorization_rules" ADD CONSTRAINT "bank_categorization_rules_bank_account_id_bank_accounts_id_fk" FOREIGN KEY ("bank_account_id") REFERENCES "public"."bank_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_statement_imports" ADD CONSTRAINT "bank_statement_imports_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_statement_imports" ADD CONSTRAINT "bank_statement_imports_bank_account_id_bank_accounts_id_fk" FOREIGN KEY ("bank_account_id") REFERENCES "public"."bank_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_statement_imports" ADD CONSTRAINT "bank_statement_imports_template_id_bank_statement_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."bank_statement_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_statement_lines" ADD CONSTRAINT "bank_statement_lines_import_id_bank_statement_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."bank_statement_imports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_statement_lines" ADD CONSTRAINT "bank_statement_lines_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_statement_templates" ADD CONSTRAINT "bank_statement_templates_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_bank_account_id_bank_accounts_id_fk" FOREIGN KEY ("bank_account_id") REFERENCES "public"."bank_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chart_of_accounts" ADD CONSTRAINT "chart_of_accounts_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "e_invoice_configs" ADD CONSTRAINT "e_invoice_configs_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eway_bill_vehicle_updates" ADD CONSTRAINT "eway_bill_vehicle_updates_eway_bill_id_eway_bills_id_fk" FOREIGN KEY ("eway_bill_id") REFERENCES "public"."eway_bills"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eway_bills" ADD CONSTRAINT "eway_bills_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eway_bills" ADD CONSTRAINT "eway_bills_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_bank_account_id_bank_accounts_id_fk" FOREIGN KEY ("bank_account_id") REFERENCES "public"."bank_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gstr2b_records" ADD CONSTRAINT "gstr2b_records_upload_id_gstr2b_uploads_id_fk" FOREIGN KEY ("upload_id") REFERENCES "public"."gstr2b_uploads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gstr2b_records" ADD CONSTRAINT "gstr2b_records_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gstr2b_uploads" ADD CONSTRAINT "gstr2b_uploads_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_variant_id_item_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."item_variants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_party_id_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."parties"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "itc_ledger_entries" ADD CONSTRAINT "itc_ledger_entries_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "itc_ledger_entries" ADD CONSTRAINT "itc_ledger_entries_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "itc_utilizations" ADD CONSTRAINT "itc_utilizations_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_variants" ADD CONSTRAINT "item_variants_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entry_lines" ADD CONSTRAINT "journal_entry_lines_journal_entry_id_journal_entries_id_fk" FOREIGN KEY ("journal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entry_lines" ADD CONSTRAINT "journal_entry_lines_account_id_chart_of_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."chart_of_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entry_templates" ADD CONSTRAINT "journal_entry_templates_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parties" ADD CONSTRAINT "parties_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_gateway_configs" ADD CONSTRAINT "payment_gateway_configs_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_gateway_configs" ADD CONSTRAINT "payment_gateway_configs_bank_account_id_bank_accounts_id_fk" FOREIGN KEY ("bank_account_id") REFERENCES "public"."bank_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_gateway_configs" ADD CONSTRAINT "payment_gateway_configs_settlement_account_id_bank_accounts_id_fk" FOREIGN KEY ("settlement_account_id") REFERENCES "public"."bank_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_party_id_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."parties"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_invoice_runs" ADD CONSTRAINT "recurring_invoice_runs_template_id_recurring_invoice_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."recurring_invoice_templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_invoice_runs" ADD CONSTRAINT "recurring_invoice_runs_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_invoice_runs" ADD CONSTRAINT "recurring_invoice_runs_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_invoice_templates" ADD CONSTRAINT "recurring_invoice_templates_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_invoice_templates" ADD CONSTRAINT "recurring_invoice_templates_party_id_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."parties"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_targets" ADD CONSTRAINT "sales_targets_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_targets" ADD CONSTRAINT "sales_targets_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_events" ADD CONSTRAINT "shipment_events_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_party_id_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."parties"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "stock_adjustments_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "stock_adjustments_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "stock_adjustments_variant_id_item_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."item_variants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_orders" ADD CONSTRAINT "store_orders_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_orders" ADD CONSTRAINT "store_orders_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_log_business_idx" ON "audit_log" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "audit_log_entity_idx" ON "audit_log" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "audit_log_date_idx" ON "audit_log" USING btree ("business_id","created_at");--> statement-breakpoint
CREATE INDEX "bank_accounts_business_idx" ON "bank_accounts" USING btree ("business_id");--> statement-breakpoint
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
CREATE INDEX "bank_txn_business_idx" ON "bank_transactions" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "bank_txn_account_idx" ON "bank_transactions" USING btree ("bank_account_id");--> statement-breakpoint
CREATE INDEX "bank_txn_date_idx" ON "bank_transactions" USING btree ("bank_account_id","transaction_date");--> statement-breakpoint
CREATE INDEX "bank_txn_ref_idx" ON "bank_transactions" USING btree ("reference_type","reference_id");--> statement-breakpoint
CREATE INDEX "bank_txn_payment_idx" ON "bank_transactions" USING btree ("payment_id");--> statement-breakpoint
CREATE INDEX "businesses_owner_idx" ON "businesses" USING btree ("created_by_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "businesses_store_slug_idx" ON "businesses" USING btree ("store_slug");--> statement-breakpoint
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
CREATE INDEX "expenses_business_idx" ON "expenses" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "expenses_date_idx" ON "expenses" USING btree ("business_id","expense_date");--> statement-breakpoint
CREATE INDEX "expenses_category_idx" ON "expenses" USING btree ("business_id","category");--> statement-breakpoint
CREATE INDEX "expenses_active_idx" ON "expenses" USING btree ("business_id","expense_date") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "g2br_upload_idx" ON "gstr2b_records" USING btree ("upload_id");--> statement-breakpoint
CREATE INDEX "g2br_business_idx" ON "gstr2b_records" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "g2br_gstin_idx" ON "gstr2b_records" USING btree ("business_id","supplier_gstin");--> statement-breakpoint
CREATE INDEX "g2br_match_idx" ON "gstr2b_records" USING btree ("upload_id","match_status");--> statement-breakpoint
CREATE INDEX "g2b_business_idx" ON "gstr2b_uploads" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "g2b_period_idx" ON "gstr2b_uploads" USING btree ("business_id","return_period");--> statement-breakpoint
CREATE INDEX "invoice_items_invoice_idx" ON "invoice_items" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "invoice_items_item_idx" ON "invoice_items" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "invoice_items_variant_idx" ON "invoice_items" USING btree ("variant_id");--> statement-breakpoint
CREATE INDEX "invoices_business_idx" ON "invoices" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "invoices_party_idx" ON "invoices" USING btree ("party_id");--> statement-breakpoint
CREATE INDEX "invoices_status_idx" ON "invoices" USING btree ("business_id","status");--> statement-breakpoint
CREATE INDEX "invoices_date_idx" ON "invoices" USING btree ("business_id","invoice_date");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_number_idx" ON "invoices" USING btree ("business_id","invoice_number");--> statement-breakpoint
CREATE INDEX "invoices_doc_type_idx" ON "invoices" USING btree ("business_id","document_type");--> statement-breakpoint
CREATE INDEX "invoices_party_date_idx" ON "invoices" USING btree ("business_id","party_id","invoice_date");--> statement-breakpoint
CREATE INDEX "invoices_ref_doc_idx" ON "invoices" USING btree ("reference_document_id");--> statement-breakpoint
CREATE INDEX "invoices_einvoice_status_idx" ON "invoices" USING btree ("business_id","e_invoice_status");--> statement-breakpoint
CREATE INDEX "invoices_active_idx" ON "invoices" USING btree ("business_id","invoice_date") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "invoices_active_type_idx" ON "invoices" USING btree ("business_id","type","document_type","invoice_date") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "itc_business_idx" ON "itc_ledger_entries" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "itc_invoice_idx" ON "itc_ledger_entries" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "itc_period_idx" ON "itc_ledger_entries" USING btree ("business_id","return_period");--> statement-breakpoint
CREATE INDEX "itc_status_idx" ON "itc_ledger_entries" USING btree ("business_id","status");--> statement-breakpoint
CREATE INDEX "itc_util_business_idx" ON "itc_utilizations" USING btree ("business_id");--> statement-breakpoint
CREATE UNIQUE INDEX "itc_util_period_idx" ON "itc_utilizations" USING btree ("business_id","return_period");--> statement-breakpoint
CREATE INDEX "item_variants_item_idx" ON "item_variants" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "item_variants_sku_idx" ON "item_variants" USING btree ("sku");--> statement-breakpoint
CREATE INDEX "item_variants_active_idx" ON "item_variants" USING btree ("item_id") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "items_business_idx" ON "items" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "items_name_idx" ON "items" USING btree ("business_id","name");--> statement-breakpoint
CREATE INDEX "items_sku_idx" ON "items" USING btree ("business_id","sku");--> statement-breakpoint
CREATE INDEX "items_store_idx" ON "items" USING btree ("business_id","store_enabled");--> statement-breakpoint
CREATE INDEX "items_active_idx" ON "items" USING btree ("business_id","name") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "je_business_idx" ON "journal_entries" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "je_date_idx" ON "journal_entries" USING btree ("business_id","entry_date");--> statement-breakpoint
CREATE UNIQUE INDEX "je_number_idx" ON "journal_entries" USING btree ("business_id","entry_number");--> statement-breakpoint
CREATE INDEX "jel_entry_idx" ON "journal_entry_lines" USING btree ("journal_entry_id");--> statement-breakpoint
CREATE INDEX "jel_account_idx" ON "journal_entry_lines" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "jet_business_idx" ON "journal_entry_templates" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "parties_business_idx" ON "parties" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "parties_type_idx" ON "parties" USING btree ("business_id","type");--> statement-breakpoint
CREATE INDEX "parties_name_idx" ON "parties" USING btree ("business_id","name");--> statement-breakpoint
CREATE INDEX "payment_alloc_payment_idx" ON "payment_allocations" USING btree ("payment_id");--> statement-breakpoint
CREATE INDEX "payment_alloc_invoice_idx" ON "payment_allocations" USING btree ("invoice_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pg_config_account_idx" ON "payment_gateway_configs" USING btree ("bank_account_id");--> statement-breakpoint
CREATE INDEX "pg_config_business_idx" ON "payment_gateway_configs" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "payments_business_idx" ON "payments" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "payments_invoice_idx" ON "payments" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "payments_party_idx" ON "payments" USING btree ("party_id");--> statement-breakpoint
CREATE INDEX "payments_date_idx" ON "payments" USING btree ("business_id","payment_date");--> statement-breakpoint
CREATE INDEX "payments_party_date_idx" ON "payments" USING btree ("business_id","party_id","payment_date");--> statement-breakpoint
CREATE INDEX "payments_active_idx" ON "payments" USING btree ("business_id","payment_date") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "recurring_run_template_idx" ON "recurring_invoice_runs" USING btree ("template_id");--> statement-breakpoint
CREATE INDEX "recurring_run_business_idx" ON "recurring_invoice_runs" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "recurring_run_executed_idx" ON "recurring_invoice_runs" USING btree ("business_id","executed_at");--> statement-breakpoint
CREATE INDEX "recurring_tpl_business_idx" ON "recurring_invoice_templates" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "recurring_tpl_party_idx" ON "recurring_invoice_templates" USING btree ("party_id");--> statement-breakpoint
CREATE INDEX "recurring_tpl_status_idx" ON "recurring_invoice_templates" USING btree ("business_id","status");--> statement-breakpoint
CREATE INDEX "recurring_tpl_next_run_idx" ON "recurring_invoice_templates" USING btree ("status","next_run_date");--> statement-breakpoint
CREATE INDEX "sales_targets_business_idx" ON "sales_targets" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "sales_targets_user_idx" ON "sales_targets" USING btree ("business_id","user_id");--> statement-breakpoint
CREATE INDEX "sales_targets_period_idx" ON "sales_targets" USING btree ("business_id","period_start","period_end");--> statement-breakpoint
CREATE INDEX "shipment_events_shipment_idx" ON "shipment_events" USING btree ("shipment_id");--> statement-breakpoint
CREATE INDEX "shipment_events_time_idx" ON "shipment_events" USING btree ("shipment_id","event_time");--> statement-breakpoint
CREATE INDEX "shipments_business_idx" ON "shipments" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "shipments_invoice_idx" ON "shipments" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "shipments_party_idx" ON "shipments" USING btree ("party_id");--> statement-breakpoint
CREATE INDEX "shipments_status_idx" ON "shipments" USING btree ("business_id","status");--> statement-breakpoint
CREATE INDEX "shipments_date_idx" ON "shipments" USING btree ("business_id","shipment_date");--> statement-breakpoint
CREATE INDEX "shipments_carrier_order_idx" ON "shipments" USING btree ("carrier_order_id");--> statement-breakpoint
CREATE INDEX "stock_adj_business_idx" ON "stock_adjustments" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "stock_adj_item_idx" ON "stock_adjustments" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "stock_adj_variant_idx" ON "stock_adjustments" USING btree ("variant_id");--> statement-breakpoint
CREATE INDEX "stock_adj_date_idx" ON "stock_adjustments" USING btree ("business_id","adjustment_date");--> statement-breakpoint
CREATE INDEX "store_orders_business_idx" ON "store_orders" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "store_orders_status_idx" ON "store_orders" USING btree ("business_id","status");--> statement-breakpoint
CREATE INDEX "store_orders_date_idx" ON "store_orders" USING btree ("business_id","created_at");--> statement-breakpoint
CREATE INDEX "store_orders_phone_idx" ON "store_orders" USING btree ("business_id","customer_phone");--> statement-breakpoint
CREATE UNIQUE INDEX "store_orders_number_idx" ON "store_orders" USING btree ("business_id","order_number");--> statement-breakpoint
CREATE INDEX "store_orders_invoice_idx" ON "store_orders" USING btree ("invoice_id");