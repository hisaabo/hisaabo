CREATE TABLE "notification_preferences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"business_id" uuid,
	"channel" text NOT NULL,
	"delivery" text,
	"scope" text,
	"threshold_paise" bigint,
	"email" boolean,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "push_devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"session_id" text NOT NULL,
	"platform" text NOT NULL,
	"app_flavor" text NOT NULL,
	"token_hash" text NOT NULL,
	"token" text NOT NULL,
	"public_key" text,
	"auth_secret" text,
	"locale" text DEFAULT 'en' NOT NULL,
	"app_version" text,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "push_quota_usage" (
	"scope" text NOT NULL,
	"scope_id" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "push_quota_usage_scope_scope_id_window_start_pk" PRIMARY KEY("scope","scope_id","window_start")
);
--> statement-breakpoint
CREATE TABLE "user_notification_settings" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"locale" text DEFAULT 'en' NOT NULL,
	"quiet_start" text DEFAULT '22:00',
	"quiet_end" text DEFAULT '08:00',
	"paused_until" timestamp with time zone,
	"lock_screen_privacy" boolean DEFAULT false NOT NULL,
	"promotions_opt_in_at" timestamp with time zone,
	"promotions_opt_in_source" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
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
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_devices" ADD CONSTRAINT "push_devices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_devices" ADD CONSTRAINT "push_devices_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_notification_settings" ADD CONSTRAINT "user_notification_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_inbox" ADD CONSTRAINT "notification_inbox_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_inbox" ADD CONSTRAINT "notification_inbox_outbox_id_notification_outbox_id_fk" FOREIGN KEY ("outbox_id") REFERENCES "public"."notification_outbox"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_outbox" ADD CONSTRAINT "notification_outbox_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "notif_prefs_tenant_idx" ON "notification_preferences" USING btree ("user_id","tenant_id","channel") WHERE business_id IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "notif_prefs_business_idx" ON "notification_preferences" USING btree ("user_id","tenant_id","business_id","channel") WHERE business_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX "notif_prefs_lookup_idx" ON "notification_preferences" USING btree ("tenant_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "push_devices_token_idx" ON "push_devices" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "push_devices_user_idx" ON "push_devices" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "push_devices_session_idx" ON "push_devices" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "push_quota_window_idx" ON "push_quota_usage" USING btree ("window_start");--> statement-breakpoint
CREATE UNIQUE INDEX "notif_inbox_outbox_recipient_idx" ON "notification_inbox" USING btree ("outbox_id","recipient_user_id");--> statement-breakpoint
CREATE INDEX "notif_inbox_recipient_idx" ON "notification_inbox" USING btree ("tenant_id","recipient_user_id","created_at");--> statement-breakpoint
CREATE INDEX "notif_inbox_unread_idx" ON "notification_inbox" USING btree ("tenant_id","recipient_user_id","business_id") WHERE read_at IS NULL AND archived_at IS NULL;--> statement-breakpoint
CREATE INDEX "notif_inbox_created_idx" ON "notification_inbox" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "notif_outbox_dedupe_idx" ON "notification_outbox" USING btree ("tenant_id","dedupe_key");--> statement-breakpoint
CREATE INDEX "notif_outbox_pending_idx" ON "notification_outbox" USING btree ("status","available_at");--> statement-breakpoint
CREATE INDEX "notif_outbox_business_idx" ON "notification_outbox" USING btree ("business_id");