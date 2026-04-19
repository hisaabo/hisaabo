CREATE TABLE "access_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "access_tokens" ADD CONSTRAINT "access_tokens_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "access_tokens_session_idx" ON "access_tokens" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "access_tokens_expires_idx" ON "access_tokens" USING btree ("expires_at");