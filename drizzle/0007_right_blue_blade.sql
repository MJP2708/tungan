CREATE TABLE "member_schedule" (
	"workspace_id" text NOT NULL,
	"user_id" text NOT NULL,
	"starts_at" text DEFAULT '09:00' NOT NULL,
	"ends_at" text DEFAULT '18:00' NOT NULL,
	"is_manual" boolean DEFAULT false NOT NULL,
	"samples" integer DEFAULT 0 NOT NULL,
	"observed_start_minutes" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "member_schedule_workspace_id_user_id_pk" PRIMARY KEY("workspace_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "reminder" ADD COLUMN "snooze_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "member_schedule" ADD CONSTRAINT "member_schedule_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_schedule" ADD CONSTRAINT "member_schedule_user_id_line_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."line_user"("id") ON DELETE cascade ON UPDATE no action;