CREATE TABLE "notification_inbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"business_id" uuid,
	"recipient_user_id" uuid NOT NULL,
	"outbox_id" uuid,
	"channel" text NOT NULL,
	"event_type" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"locale" text DEFAULT 'en' NOT NULL,
	"target" jsonb NOT NULL,
	"locked" boolean DEFAULT false NOT NULL,
	"read_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"business_id" uuid,
	"event_type" text NOT NULL,
	"actor_user_id" uuid,
	"actor_kind" text DEFAULT 'user' NOT NULL,
	"owner_user_id" uuid,
	"subject_user_id" uuid,
	"payload" jsonb NOT NULL,
	"dedupe_key" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"dispatched_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "notification_inbox" ADD CONSTRAINT "notification_inbox_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_inbox" ADD CONSTRAINT "notification_inbox_outbox_id_notification_outbox_id_fk" FOREIGN KEY ("outbox_id") REFERENCES "public"."notification_outbox"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_outbox" ADD CONSTRAINT "notification_outbox_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "notif_inbox_outbox_recipient_idx" ON "notification_inbox" USING btree ("outbox_id","recipient_user_id");--> statement-breakpoint
CREATE INDEX "notif_inbox_recipient_idx" ON "notification_inbox" USING btree ("tenant_id","recipient_user_id","created_at");--> statement-breakpoint
CREATE INDEX "notif_inbox_unread_idx" ON "notification_inbox" USING btree ("tenant_id","recipient_user_id","business_id") WHERE read_at IS NULL AND archived_at IS NULL;--> statement-breakpoint
CREATE INDEX "notif_inbox_created_idx" ON "notification_inbox" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "notif_outbox_dedupe_idx" ON "notification_outbox" USING btree ("tenant_id","dedupe_key");--> statement-breakpoint
CREATE INDEX "notif_outbox_pending_idx" ON "notification_outbox" USING btree ("status","available_at");--> statement-breakpoint
CREATE INDEX "notif_outbox_business_idx" ON "notification_outbox" USING btree ("business_id");