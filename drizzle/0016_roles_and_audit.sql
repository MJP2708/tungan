CREATE TABLE "audit_log" (
	"id" text PRIMARY KEY NOT NULL,
	"actor_user_id" text,
	"action" text NOT NULL,
	"target_user_id" text,
	"target_task_id" text,
	"workspace_id" text,
	"before" jsonb,
	"after" jsonb,
	"self_approved" boolean DEFAULT false NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "kind" text DEFAULT 'team' NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "created_by_user_id" text;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_user_id_line_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."line_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_target_user_id_line_user_id_fk" FOREIGN KEY ("target_user_id") REFERENCES "public"."line_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_log_workspace_idx" ON "audit_log" USING btree ("workspace_id","at");--> statement-breakpoint
ALTER TABLE "workspace" ADD CONSTRAINT "workspace_created_by_user_id_line_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."line_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "task_assignee_due_status_idx" ON "task" USING btree ("assignee_user_id","due_at","status");--> statement-breakpoint
-- Roles (2026-10-17): owner and admin were the two levels with review and
-- settings rights; both become MANAGER. Everyone else is MEMBER.
UPDATE "workspace_member" SET "role" = 'manager' WHERE "role" IN ('owner', 'admin');--> statement-breakpoint
UPDATE "workspace_member" SET "role" = 'member' WHERE "role" NOT IN ('manager', 'member');--> statement-breakpoint
-- Who set each workspace up: whoever bound its LINE group, else the earliest
-- owner (now manager) by when they joined.
UPDATE "workspace" w SET "created_by_user_id" = gw."bound_by_user_id"
  FROM "group_workspace" gw
  WHERE gw."workspace_id" = w."id" AND gw."bound_by_user_id" IS NOT NULL AND w."created_by_user_id" IS NULL;--> statement-breakpoint
UPDATE "workspace" w SET "created_by_user_id" = (
    SELECT m."user_id" FROM "workspace_member" m
    WHERE m."workspace_id" = w."id" AND m."role" = 'manager'
    ORDER BY m."created_at" ASC LIMIT 1)
  WHERE w."created_by_user_id" IS NULL;--> statement-breakpoint
-- Personal ("no group"): only the solo workspace made at first sign-in —
-- named งานของฉัน, never bound to a LINE group, with exactly one member.
-- Anything less certain stays a team workspace: never guess.
UPDATE "workspace" w SET "kind" = 'personal'
  WHERE w."name" = 'งานของฉัน'
    AND NOT EXISTS (SELECT 1 FROM "group_workspace" gw WHERE gw."workspace_id" = w."id")
    AND (SELECT count(*) FROM "workspace_member" m WHERE m."workspace_id" = w."id") = 1;
