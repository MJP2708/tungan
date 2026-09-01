CREATE TABLE "task_question" (
	"id" text PRIMARY KEY NOT NULL,
	"task_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"asked_by_user_id" text,
	"asked_of_user_id" text NOT NULL,
	"question" text NOT NULL,
	"answer" text,
	"answered_at" timestamp with time zone,
	"escalate_at" timestamp with time zone,
	"escalated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "task_question" ADD CONSTRAINT "task_question_task_id_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."task"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_question" ADD CONSTRAINT "task_question_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_question" ADD CONSTRAINT "task_question_asked_by_user_id_line_user_id_fk" FOREIGN KEY ("asked_by_user_id") REFERENCES "public"."line_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_question" ADD CONSTRAINT "task_question_asked_of_user_id_line_user_id_fk" FOREIGN KEY ("asked_of_user_id") REFERENCES "public"."line_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "task_question_task_idx" ON "task_question" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "task_question_open_idx" ON "task_question" USING btree ("asked_of_user_id","answered_at");