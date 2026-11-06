ALTER TABLE "announcement" ADD COLUMN "source_message_id" text;--> statement-breakpoint
ALTER TABLE "line_event" ADD COLUMN "attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "line_event" ADD COLUMN "claimed_until" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "announcement_source_message_key" ON "announcement" USING btree ("source_message_id");