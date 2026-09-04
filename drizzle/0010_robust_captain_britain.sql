ALTER TABLE "task_event" ADD COLUMN "visibility" text DEFAULT 'workspace' NOT NULL;--> statement-breakpoint
-- Existing ติดปัญหา notes were written before there was any choice, and were
-- visible to the whole workspace. They stay that way: silently narrowing them
-- would change what people already believe about who read their note, and the
-- fix for that is to ask, not to guess. Only new notes default to private.
--
-- Recorded here rather than left implicit, because "why is this old note
-- workspace-visible" is otherwise unanswerable later.
UPDATE "task_event" SET "visibility" = 'workspace' WHERE "visibility" IS NULL;
