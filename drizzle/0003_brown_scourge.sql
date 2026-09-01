ALTER TABLE "workspace" ADD COLUMN "working_hours_start" text DEFAULT '09:00' NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "working_hours_end" text DEFAULT '18:00' NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "default_due_time" text DEFAULT '18:00' NOT NULL;