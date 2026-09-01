CREATE TABLE "line_group_member" (
	"line_group_id" text NOT NULL,
	"user_id" text NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "line_group_member_line_group_id_user_id_pk" PRIMARY KEY("line_group_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "group_workspace" ADD COLUMN "bound_by_user_id" text;--> statement-breakpoint
ALTER TABLE "line_group_member" ADD CONSTRAINT "line_group_member_line_group_id_line_group_id_fk" FOREIGN KEY ("line_group_id") REFERENCES "public"."line_group"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "line_group_member" ADD CONSTRAINT "line_group_member_user_id_line_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."line_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "line_group_member_user_idx" ON "line_group_member" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "group_workspace" ADD CONSTRAINT "group_workspace_bound_by_user_id_line_user_id_fk" FOREIGN KEY ("bound_by_user_id") REFERENCES "public"."line_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "group_workspace_group_key" ON "group_workspace" USING btree ("line_group_id");