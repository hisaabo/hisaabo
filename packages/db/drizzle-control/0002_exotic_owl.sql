CREATE TYPE "public"."session_auth_method" AS ENUM('cookie', 'bearer');--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "auth_method" "session_auth_method" DEFAULT 'cookie' NOT NULL;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "max_expires_at" timestamp with time zone;