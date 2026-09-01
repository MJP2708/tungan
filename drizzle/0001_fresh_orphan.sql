ALTER TABLE "line_event" ADD COLUMN "source_type" text;--> statement-breakpoint
ALTER TABLE "line_event" ADD COLUMN "source_id" text;--> statement-breakpoint
ALTER TABLE "line_event" ADD COLUMN "sender_user_id" text;--> statement-breakpoint
ALTER TABLE "line_event" ADD COLUMN "processed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "line_event" ADD COLUMN "processing_error" text;--> statement-breakpoint
CREATE INDEX "line_event_source_idx" ON "line_event" USING btree ("source_type","source_id");--> statement-breakpoint
CREATE INDEX "line_event_received_idx" ON "line_event" USING btree ("received_at");