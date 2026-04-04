ALTER TYPE "public"."bank_account_type" ADD VALUE 'payment_gateway';--> statement-breakpoint
ALTER TYPE "public"."payment_mode" ADD VALUE 'credit_card';--> statement-breakpoint
ALTER TYPE "public"."payment_mode" ADD VALUE 'debit_card';--> statement-breakpoint
ALTER TYPE "public"."payment_mode" ADD VALUE 'net_banking';--> statement-breakpoint
ALTER TYPE "public"."payment_mode" ADD VALUE 'wallet';--> statement-breakpoint
CREATE TABLE "payment_gateway_configs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"bank_account_id" uuid NOT NULL,
	"settlement_account_id" uuid NOT NULL,
	"charge_config" jsonb NOT NULL,
	"expense_category" text DEFAULT 'Payment Gateway Charges' NOT NULL,
	"auto_settle" boolean DEFAULT true NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bank_transactions" ADD COLUMN "payment_id" uuid;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "bank_account_id" uuid;--> statement-breakpoint
ALTER TABLE "payment_gateway_configs" ADD CONSTRAINT "payment_gateway_configs_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_gateway_configs" ADD CONSTRAINT "payment_gateway_configs_bank_account_id_bank_accounts_id_fk" FOREIGN KEY ("bank_account_id") REFERENCES "public"."bank_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_gateway_configs" ADD CONSTRAINT "payment_gateway_configs_settlement_account_id_bank_accounts_id_fk" FOREIGN KEY ("settlement_account_id") REFERENCES "public"."bank_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pg_config_account_idx" ON "payment_gateway_configs" USING btree ("bank_account_id");--> statement-breakpoint
CREATE INDEX "pg_config_business_idx" ON "payment_gateway_configs" USING btree ("business_id");--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_bank_account_id_bank_accounts_id_fk" FOREIGN KEY ("bank_account_id") REFERENCES "public"."bank_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bank_txn_payment_idx" ON "bank_transactions" USING btree ("payment_id");