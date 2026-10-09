CREATE TABLE "calendar_event" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"created_by_user_id" text,
	"title" text NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"link" text,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone,
	"all_day" boolean DEFAULT false NOT NULL,
	"audience" text DEFAULT 'me' NOT NULL,
	"notify_minutes" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "calendar_event_attendee" (
	"event_id" text NOT NULL,
	"user_id" text NOT NULL,
	CONSTRAINT "calendar_event_attendee_event_id_user_id_pk" PRIMARY KEY("event_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "reminder" ADD COLUMN "event_id" text;--> statement-breakpoint
ALTER TABLE "calendar_event" ADD CONSTRAINT "calendar_event_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_event" ADD CONSTRAINT "calendar_event_created_by_user_id_line_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."line_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_event_attendee" ADD CONSTRAINT "calendar_event_attendee_event_id_calendar_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."calendar_event"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_event_attendee" ADD CONSTRAINT "calendar_event_attendee_user_id_line_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."line_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "calendar_event_range_idx" ON "calendar_event" USING btree ("workspace_id","starts_at");--> statement-breakpoint
CREATE INDEX "calendar_event_attendee_user_idx" ON "calendar_event_attendee" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "reminder" ADD CONSTRAINT "reminder_event_id_calendar_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."calendar_event"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "reminder_event_dedup_key" ON "reminder" USING btree ("event_id","recipient_user_id","original_send_at");