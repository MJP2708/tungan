CREATE TABLE "announcement" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"author_user_id" text,
	"title" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "announcement_read" (
	"announcement_id" text NOT NULL,
	"user_id" text NOT NULL,
	"read_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "announcement_read_announcement_id_user_id_pk" PRIMARY KEY("announcement_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "inbox_item" ADD COLUMN "assign_all" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN "batch_id" text;--> statement-breakpoint
ALTER TABLE "announcement" ADD CONSTRAINT "announcement_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcement" ADD CONSTRAINT "announcement_author_user_id_line_user_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."line_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcement_read" ADD CONSTRAINT "announcement_read_announcement_id_announcement_id_fk" FOREIGN KEY ("announcement_id") REFERENCES "public"."announcement"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcement_read" ADD CONSTRAINT "announcement_read_user_id_line_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."line_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "announcement_workspace_idx" ON "announcement" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "task_batch_idx" ON "task" USING btree ("batch_id");