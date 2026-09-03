ALTER TABLE "task_event" ADD COLUMN "previous_state" jsonb;--> statement-breakpoint
ALTER TABLE "task_event" ADD COLUMN "undone_at" timestamp with time zone;