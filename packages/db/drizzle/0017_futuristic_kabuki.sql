CREATE TABLE "store_slugs" (
	"slug" text PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"store_enabled" boolean NOT NULL,
	"released_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "store_slugs_slug_format" CHECK ("store_slugs"."slug" ~ '^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$')
);
--> statement-breakpoint
ALTER TABLE "store_slugs" ADD CONSTRAINT "store_slugs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "store_slugs_live_business_idx" ON "store_slugs" USING btree ("tenant_id","business_id") WHERE "store_slugs"."released_at" IS NULL;