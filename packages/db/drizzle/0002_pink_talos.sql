CREATE TYPE "public"."gst_registration_type" AS ENUM('regular', 'composition', 'unregistered');--> statement-breakpoint
CREATE TYPE "public"."item_mode" AS ENUM('simple', 'alt_units', 'variants');--> statement-breakpoint
CREATE TYPE "public"."shipment_status" AS ENUM('pending', 'shipped', 'in_transit', 'delivered', 'returned');--> statement-breakpoint
CREATE TYPE "public"."store_order_status" AS ENUM('pending', 'confirmed', 'preparing', 'ready', 'delivered', 'cancelled');--> statement-breakpoint
ALTER TYPE "public"."member_role" ADD VALUE 'superadmin';--> statement-breakpoint
ALTER TYPE "public"."member_role" ADD VALUE 'seller_manager';--> statement-breakpoint
ALTER TYPE "public"."member_role" ADD VALUE 'seller';--> statement-breakpoint
ALTER TYPE "public"."member_role" ADD VALUE 'accountant';--> statement-breakpoint
ALTER TYPE "public"."invoice_status" ADD VALUE 'unfulfilled' BEFORE 'sent';--> statement-breakpoint
ALTER TYPE "public"."unit" ADD VALUE 'pkt' BEFORE 'other';--> statement-breakpoint
ALTER TYPE "public"."unit" ADD VALUE 'bun' BEFORE 'other';--> statement-breakpoint
ALTER TYPE "public"."unit" ADD VALUE 'pouch' BEFORE 'other';--> statement-breakpoint
ALTER TYPE "public"."unit" ADD VALUE 'jar' BEFORE 'other';--> statement-breakpoint
ALTER TYPE "public"."unit" ADD VALUE 'btl' BEFORE 'other';--> statement-breakpoint
ALTER TYPE "public"."unit" ADD VALUE 'bag' BEFORE 'other';--> statement-breakpoint
ALTER TYPE "public"."unit" ADD VALUE 'ton' BEFORE 'other';--> statement-breakpoint
ALTER TYPE "public"."unit" ADD VALUE 'pack' BEFORE 'other';--> statement-breakpoint
ALTER TYPE "public"."unit" ADD VALUE 'pet' BEFORE 'other';--> statement-breakpoint
ALTER TYPE "public"."unit" ADD VALUE 'person' BEFORE 'other';--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"key_hash" text NOT NULL,
	"key_prefix" text NOT NULL,
	"name" text NOT NULL,
	"last_used_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "magic_link_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"token_hash" text NOT NULL,
	"user_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"ip_address" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
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
ALTER TABLE "users" ALTER COLUMN "name" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "password_hash" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "gst_registration_type" "gst_registration_type" DEFAULT 'unregistered' NOT NULL;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "state_code" text;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "store_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "store_slug" text;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "store_tagline" text;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "store_accent_color" text;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "store_min_order_amount" numeric(15, 2);--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "store_delivery_note" text;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "store_whatsapp_number" text;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "store_allow_negative_stock" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "custom_shipping_methods" jsonb;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "carrier_credentials" jsonb;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "next_store_order_number" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "store_order_prefix" text DEFAULT 'ORD' NOT NULL;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "created_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "created_by_name" text;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "invoice_items" ADD COLUMN "variant_id" uuid;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "created_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "created_by_name" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "delivery_method" text DEFAULT 'self_pickup';--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "item_mode" "item_mode" DEFAULT 'simple' NOT NULL;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "variant_attributes" jsonb;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "store_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "store_price" numeric(15, 2);--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "store_sort_order" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "store_category" text;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "store_description" text;--> statement-breakpoint
ALTER TABLE "parties" ADD COLUMN "state_code" text;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "created_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "created_by_name" text;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "magic_link_tokens" ADD CONSTRAINT "magic_link_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_variants" ADD CONSTRAINT "item_variants_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
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
CREATE INDEX "api_keys_user_idx" ON "api_keys" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "api_keys_hash_idx" ON "api_keys" USING btree ("key_hash");--> statement-breakpoint
CREATE INDEX "magic_link_tokens_email_idx" ON "magic_link_tokens" USING btree ("email");--> statement-breakpoint
CREATE INDEX "magic_link_tokens_hash_idx" ON "magic_link_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "item_variants_item_idx" ON "item_variants" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "item_variants_sku_idx" ON "item_variants" USING btree ("sku");--> statement-breakpoint
CREATE INDEX "payment_alloc_payment_idx" ON "payment_allocations" USING btree ("payment_id");--> statement-breakpoint
CREATE INDEX "payment_alloc_invoice_idx" ON "payment_allocations" USING btree ("invoice_id");--> statement-breakpoint
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
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_variant_id_item_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."item_variants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "businesses_store_slug_idx" ON "businesses" USING btree ("store_slug");--> statement-breakpoint
CREATE INDEX "invoice_items_variant_idx" ON "invoice_items" USING btree ("variant_id");--> statement-breakpoint
CREATE INDEX "items_store_idx" ON "items" USING btree ("business_id","store_enabled");