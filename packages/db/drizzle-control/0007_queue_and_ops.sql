CREATE TYPE "public"."ops_role" AS ENUM('admin', 'viewer');--> statement-breakpoint
CREATE TABLE "ops_audit_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"operator_id" uuid,
	"actor" text NOT NULL,
	"action" text NOT NULL,
	"queue" text,
	"job_ids" jsonb,
	"details" jsonb,
	"ip" text,
	"result" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ops_operators" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"role" "ops_role" NOT NULL,
	"totp_secret" text,
	"totp_enrolled_at" timestamp with time zone,
	"totp_last_step" bigint,
	"recovery_code_hashes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"failed_attempts" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"disabled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ops_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" text NOT NULL,
	"operator_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"session_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"step_up_at" timestamp with time zone,
	"ip" text,
	"user_agent" text,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "queue_controls" (
	"queue" text PRIMARY KEY NOT NULL,
	"paused" boolean DEFAULT false NOT NULL,
	"paused_at" timestamp with time zone,
	"paused_by" text
);
--> statement-breakpoint
ALTER TABLE "ops_sessions" ADD CONSTRAINT "ops_sessions_operator_id_ops_operators_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."ops_operators"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops_sessions" ADD CONSTRAINT "ops_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ops_audit_log_at_idx" ON "ops_audit_log" USING btree ("at");--> statement-breakpoint
CREATE UNIQUE INDEX "ops_operators_email_idx" ON "ops_operators" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "ops_sessions_token_hash_idx" ON "ops_sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "ops_sessions_operator_idx" ON "ops_sessions" USING btree ("operator_id");