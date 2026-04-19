ALTER TABLE "businesses" ADD COLUMN "logo_data" "bytea";--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "logo_mime_type" text;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "logo_width" integer;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "logo_height" integer;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "logo_updated_at" timestamp with time zone;