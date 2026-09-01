CREATE TABLE "name_correction" (
	"workspace_id" text NOT NULL,
	"phrase" text NOT NULL,
	"user_id" text NOT NULL,
	"times_used" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "name_correction_workspace_id_phrase_pk" PRIMARY KEY("workspace_id","phrase")
);
--> statement-breakpoint
ALTER TABLE "name_correction" ADD CONSTRAINT "name_correction_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "name_correction" ADD CONSTRAINT "name_correction_user_id_line_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."line_user"("id") ON DELETE cascade ON UPDATE no action;