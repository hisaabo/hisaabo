-- Corrective migration: align the unified (self-hosted) migration history with the
-- control-plane schema. The session auth-token tables/columns were added to the
-- control migrations (drizzle-control 0002/0003) but never to the unified set, so
-- self-hosted installs (which run only drizzle/) were missing them while the
-- 0013 snapshot already claimed parity. This migration closes that gap.
--
-- All statements are idempotent (IF NOT EXISTS / duplicate_object guards) so it is
-- safe on installs that were bootstrapped via `db:push` and already have these
-- objects, as well as on partially-migrated databases.
DO $$ BEGIN
 CREATE TYPE "public"."session_auth_method" AS ENUM('cookie', 'bearer');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "auth_method" "session_auth_method" DEFAULT 'cookie' NOT NULL;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "max_expires_at" timestamp with time zone;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "access_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "access_tokens" ADD CONSTRAINT "access_tokens_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "access_tokens_session_idx" ON "access_tokens" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "access_tokens_expires_idx" ON "access_tokens" USING btree ("expires_at");
