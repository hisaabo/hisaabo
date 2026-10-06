-- Native sign-in requests (control), store phone OTP (tenant) and the
-- item_images table. item_images was added to drizzle-tenant (0004) in PR #42
-- but never to this unified set, so self-hosted installs were missing it.
-- Idempotent (IF NOT EXISTS / duplicate_object guards) like 0014, so it is safe
-- on installs bootstrapped via db:push that already have some of these objects.
CREATE TABLE IF NOT EXISTS "native_auth_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client" text NOT NULL,
	"redirect_uri" text NOT NULL,
	"code_challenge" text NOT NULL,
	"state" text NOT NULL,
	"user_id" uuid,
	"code_hash" text,
	"authorized_at" timestamp with time zone,
	"consumed_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"ip_address" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "item_images" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"variant_id" uuid,
	"storage_key" text NOT NULL,
	"mime_type" text NOT NULL,
	"width" integer,
	"height" integer,
	"size_bytes" integer,
	"alt" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "store_phone_otps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"phone" text NOT NULL,
	"code_hash" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"verified_at" timestamp with time zone,
	"ip_address" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN IF NOT EXISTS "store_require_phone_otp" boolean DEFAULT false NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "native_auth_requests" ADD CONSTRAINT "native_auth_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "item_images" ADD CONSTRAINT "item_images_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "item_images" ADD CONSTRAINT "item_images_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "item_images" ADD CONSTRAINT "item_images_variant_id_item_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."item_variants"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "store_phone_otps" ADD CONSTRAINT "store_phone_otps_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "native_auth_requests_expires_idx" ON "native_auth_requests" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "item_images_item_idx" ON "item_images" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "item_images_variant_idx" ON "item_images" USING btree ("variant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "item_images_business_idx" ON "item_images" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "item_images_active_idx" ON "item_images" USING btree ("item_id","sort_order") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "store_phone_otps_business_phone_idx" ON "store_phone_otps" USING btree ("business_id","phone");