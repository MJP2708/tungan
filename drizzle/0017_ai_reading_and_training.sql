CREATE TABLE "ai_training_example" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"inbox_item_id" text,
	"line_message_id" text,
	"source_text" text NOT NULL,
	"rules_reading" jsonb,
	"ai_reading" jsonb,
	"confirmed" jsonb NOT NULL,
	"corrected" boolean DEFAULT false NOT NULL,
	"consent_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_usage" ADD COLUMN "answer" jsonb;--> statement-breakpoint
ALTER TABLE "inbox_item" ADD COLUMN "source_message_id" text;--> statement-breakpoint
ALTER TABLE "inbox_item" ADD COLUMN "ai_assisted" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "inbox_item" ADD COLUMN "ai_reason" text;--> statement-breakpoint
ALTER TABLE "inbox_item" ADD COLUMN "rules_reading" jsonb;--> statement-breakpoint
ALTER TABLE "inbox_item" ADD COLUMN "ai_reading" jsonb;--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "ai_training_opt_in" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "ai_training_consent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "ai_training_consent_by" text;--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "ai_training_consent_version" text;--> statement-breakpoint
ALTER TABLE "ai_training_example" ADD CONSTRAINT "ai_training_example_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_training_example_workspace_idx" ON "ai_training_example" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "ai_training_example_message_idx" ON "ai_training_example" USING btree ("line_message_id");--> statement-breakpoint
ALTER TABLE "workspace" ADD CONSTRAINT "workspace_ai_training_consent_by_line_user_id_fk" FOREIGN KEY ("ai_training_consent_by") REFERENCES "public"."line_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "inbox_source_message_idx" ON "inbox_item" USING btree ("source_message_id");--> statement-breakpoint
-- Drafts made before this column existed: the first row of each message has the id.
UPDATE "inbox_item" SET "source_message_id" = "line_message_id" WHERE "line_message_id" IS NOT NULL;
