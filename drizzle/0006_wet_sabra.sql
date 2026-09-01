ALTER TABLE "task" ADD COLUMN "pending_assignee_user_id" text;--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN "handoff_offered_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN "blocked_reason" text;--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN "status_changed_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_pending_assignee_user_id_line_user_id_fk" FOREIGN KEY ("pending_assignee_user_id") REFERENCES "public"."line_user"("id") ON DELETE set null ON UPDATE no action;