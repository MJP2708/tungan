-- Seed for the real-backend end-to-end run (tools/e2e). LOCAL database only.
-- Two people (หัวหน้าบอส owns ws-team, เมย์ is a member), one LINE group bound
-- to the team, one group not yet connected, and a task nobody has touched
-- since the day before yesterday (for the end-of-day list on วันนี้).
-- Session ids are sha256('tok-boss-e2e') and sha256('tok-may-e2e'): the
-- cookies the scripts send. They mean nothing outside this seeded database.
TRUNCATE line_user, workspace, workspace_member, session, line_group, group_workspace, line_group_member, task, task_event, reminder, inbox_item, line_event, message_usage, idempotency_key, task_question RESTART IDENTITY CASCADE;
INSERT INTO line_user (id, line_user_id, display_name, is_oa_friend) VALUES
  ('u-boss', 'U00000000000000000000000000000b05', 'หัวหน้าบอส', true),
  ('u-may',  'U00000000000000000000000000000a11', 'เมย์', true);
INSERT INTO workspace (id, name, cutoff) VALUES ('ws-team', 'ทีมทดสอบ', '17:00'), ('ws-boss-own', 'งานของฉัน', '17:00');
INSERT INTO workspace_member (workspace_id, user_id, role) VALUES
  ('ws-team', 'u-boss', 'owner'), ('ws-team', 'u-may', 'member'), ('ws-boss-own', 'u-boss', 'owner');
INSERT INTO session (id, user_id, expires_at) VALUES
  ('46fe8d485b71f886e06bb8da77ab5b370cbe3d376a7e14fcca16cb7f94fdb3e3', 'u-boss', now() + interval '1 day'), ('cc390a97ff0ef249ca93cc5285e3d625a30dbdfd69e93730f2b91f0e0967eec2', 'u-may', now() + interval '1 day');
INSERT INTO line_group (id, line_group_id, name) VALUES
  ('g-team', 'C00000000000000000000000000000001', 'กลุ่มทีมทดสอบ'),
  ('g-client', 'C00000000000000000000000000000002', 'กลุ่มลูกค้า ABC');
INSERT INTO group_workspace (line_group_id, workspace_id, bound_by_user_id) VALUES ('g-team', 'ws-team', 'u-boss');
INSERT INTO line_group_member (line_group_id, user_id) VALUES ('g-team','u-boss'),('g-team','u-may'),('g-client','u-boss');
INSERT INTO task (id, workspace_id, title, assignee_user_id, primary_assignee_user_id, created_by_user_id, due_at, status, updated_at, status_changed_at, created_at)
VALUES ('t-stale', 'ws-team', 'งานค้างจากเมื่อวาน', 'u-may', 'u-may', 'u-boss', now() + interval '2 days', 'todo',
        now() - interval '2 days', now() - interval '2 days', now() - interval '2 days');
