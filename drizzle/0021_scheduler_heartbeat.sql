CREATE TABLE "scheduler_heartbeat" (
	"name" text PRIMARY KEY NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL
);
