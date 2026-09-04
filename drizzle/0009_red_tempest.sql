ALTER TABLE "task" ADD COLUMN "submitted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN "reviewer_user_id" text;--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN "closed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "review_nudge_hours" integer DEFAULT 24 NOT NULL;--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_reviewer_user_id_line_user_id_fk" FOREIGN KEY ("reviewer_user_id") REFERENCES "public"."line_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- Existing rows predate the split between submitting and closing.
--
-- Anything already "done" stays closed. Reopening finished work to run it
-- through an approval step that did not exist when it was done would be a
-- silent accusation against whoever did it, so the row is annotated instead.
UPDATE "task"
   SET "closed_at" = COALESCE("closed_at", "updated_at"),
       "review_state" = 'approved'
 WHERE "status" = 'done';--> statement-breakpoint

INSERT INTO "task_event" ("id", "task_id", "workspace_id", "actor_user_id", "kind", "detail", "at")
SELECT gen_random_uuid()::text, t."id", t."workspace_id", NULL, 'migrated',
       'ปิดงานก่อนที่จะมีขั้นตอนอนุมัติ · ไม่มีบันทึกว่าใครเป็นผู้ตรวจ',
       COALESCE(t."closed_at", t."updated_at")
  FROM "task" t
 WHERE t."status" = 'done';--> statement-breakpoint

-- Tasks already submitted under the old model carried รอตรวจ in review_state
-- while status still said progress, so every status-based view called them
-- "in progress". They become a first-class review state.
UPDATE "task"
   SET "status" = 'review',
       "submitted_at" = COALESCE("submitted_at", "status_changed_at"),
       "reviewer_user_id" = COALESCE("reviewer_user_id", "created_by_user_id")
 WHERE "review_state" = 'review' AND "status" = 'progress';
