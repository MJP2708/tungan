CREATE TABLE "line_quota" (
	"id" text PRIMARY KEY NOT NULL,
	"monthly_limit" integer,
	"used" integer DEFAULT 0 NOT NULL,
	"checked_at" timestamp with time zone NOT NULL,
	"exhausted_month" text
);
--> statement-breakpoint
-- A personal workspace's share of the account quota is 50, not 300
-- (2026-11-06). Only rows still on the old default move; a cap someone set
-- by hand stays.
UPDATE "workspace" SET "monthly_message_cap" = 50 WHERE "kind" = 'personal' AND "monthly_message_cap" = 300;
