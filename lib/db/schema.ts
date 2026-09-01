// TUNGAN schema. Postgres (Neon).
//
// Identity is the LINE user ID. Nicknames are per-workspace display data only:
// two members with the same nickname are different people, so nickname is
// never part of a key or a lookup.
//
// Deadlines and every other time are stored as UTC `timestamptz` and rendered
// in Asia/Bangkok. Status words live in status columns, never in a time column.

import {
  pgTable,
  text,
  timestamp,
  integer,
  boolean,
  uniqueIndex,
  index,
  primaryKey,
  jsonb,
} from 'drizzle-orm/pg-core';

/** A person, keyed by their verified LINE `sub`. */
export const lineUser = pgTable(
  'line_user',
  {
    id: text('id').primaryKey(), // internal id
    lineUserId: text('line_user_id').notNull(), // the LINE `sub`
    displayName: text('display_name').notNull().default(''),
    pictureUrl: text('picture_url'),
    /** False until the user adds the OA as a friend. Without this they
     *  cannot receive reminder DMs, and the UI must warn rather than
     *  silently drop the reminder. */
    isOaFriend: boolean('is_oa_friend').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('line_user_line_user_id_key').on(t.lineUserId)],
);

export const workspace = pgTable('workspace', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  /** End of working day, "HH:MM" in Asia/Bangkok. Used only when a message
   *  names a day but no time. Changing it must never move existing tasks. */
  cutoff: text('cutoff').notNull().default('17:00'),
  quietHoursStart: text('quiet_hours_start').notNull().default('21:00'),
  quietHoursEnd: text('quiet_hours_end').notNull().default('08:00'),
  /** Counted LINE messages allowed per calendar month for this workspace. */
  monthlyMessageCap: integer('monthly_message_cap').notNull().default(300),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Membership is the only proof of access. A workspace id from the client is
 *  never sufficient — every route resolves this row server-side. */
export const workspaceMember = pgTable(
  'workspace_member',
  {
    workspaceId: text('workspace_id').notNull().references(() => workspace.id, { onDelete: 'cascade' }),
    userId: text('user_id').notNull().references(() => lineUser.id, { onDelete: 'cascade' }),
    role: text('role').notNull().default('member'), // owner | admin | member
    /** Display only, scoped to this workspace. */
    nickname: text('nickname').notNull().default(''),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.workspaceId, t.userId] }),
    index('workspace_member_user_idx').on(t.userId),
  ],
);

export const lineGroup = pgTable(
  'line_group',
  {
    id: text('id').primaryKey(),
    lineGroupId: text('line_group_id').notNull(),
    name: text('name').notNull().default(''),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('line_group_line_group_id_key').on(t.lineGroupId)],
);

/** A LINE group maps to exactly one workspace. */
export const groupWorkspace = pgTable(
  'group_workspace',
  {
    lineGroupId: text('line_group_id').notNull().references(() => lineGroup.id, { onDelete: 'cascade' }),
    workspaceId: text('workspace_id').notNull().references(() => workspace.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.lineGroupId, t.workspaceId] })],
);

export const task = pgTable(
  'task',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id').notNull().references(() => workspace.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    note: text('note').notNull().default(''),
    assigneeUserId: text('assignee_user_id').references(() => lineUser.id, { onDelete: 'set null' }),
    primaryAssigneeUserId: text('primary_assignee_user_id').references(() => lineUser.id, { onDelete: 'set null' }),
    source: text('source').notNull().default(''),
    /** Real instant. NULL means no deadline — never a status word. */
    dueAt: timestamp('due_at', { withTimezone: true }),
    status: text('status').notNull().default('todo'), // todo|progress|blocked|done
    priority: text('priority').notNull().default('normal'),
    reviewState: text('review_state').notNull().default('working'),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    evidenceUrl: text('evidence_url'),
    createdByUserId: text('created_by_user_id').references(() => lineUser.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('task_workspace_idx').on(t.workspaceId),
    index('task_due_idx').on(t.dueAt),
  ],
);

/** Append-only audit of who changed what and when. Also the correction data
 *  a later extraction phase would learn from. */
export const taskEvent = pgTable(
  'task_event',
  {
    id: text('id').primaryKey(),
    taskId: text('task_id').notNull().references(() => task.id, { onDelete: 'cascade' }),
    workspaceId: text('workspace_id').notNull().references(() => workspace.id, { onDelete: 'cascade' }),
    actorUserId: text('actor_user_id').references(() => lineUser.id, { onDelete: 'set null' }),
    kind: text('kind').notNull(), // created|accepted|info|blocked|handoff|submitted|approved|revision
    detail: text('detail').notNull().default(''),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('task_event_task_idx').on(t.taskId)],
);

/** Candidate messages awaiting human confirmation. The system never turns one
 *  into a task by itself. Raw text is retained for 7 days at most. */
export const inboxItem = pgTable(
  'inbox_item',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id').notNull().references(() => workspace.id, { onDelete: 'cascade' }),
    lineGroupId: text('line_group_id'),
    senderLineUserId: text('sender_line_user_id'),
    senderName: text('sender_name').notNull().default(''),
    /** Cleared on `unsend`, and by retention after 7 days. */
    rawMessage: text('raw_message'),
    lineMessageId: text('line_message_id'),
    suggestedTitle: text('suggested_title').notNull().default(''),
    suggestedAssigneeUserId: text('suggested_assignee_user_id'),
    suggestedDueAt: timestamp('suggested_due_at', { withTimezone: true }),
    /** explicit | inferred | fallback — drives whether we ask for confirmation. */
    confidence: text('confidence').notNull().default('fallback'),
    state: text('state').notNull().default('pending'), // pending|created|dismissed
    replyToken: text('reply_token'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('inbox_workspace_state_idx').on(t.workspaceId, t.state),
    uniqueIndex('inbox_line_message_key').on(t.lineMessageId),
  ],
);

export const reminder = pgTable(
  'reminder',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id').notNull().references(() => workspace.id, { onDelete: 'cascade' }),
    taskId: text('task_id').references(() => task.id, { onDelete: 'cascade' }),
    /** Reminders go to a person. Never to a group: push is billed per
     *  recipient, so one push into a ten-person group costs ten messages. */
    recipientUserId: text('recipient_user_id').notNull().references(() => lineUser.id, { onDelete: 'cascade' }),
    /** When it should fire, already shifted out of quiet hours. */
    sendAt: timestamp('send_at', { withTimezone: true }).notNull(),
    /** The un-shifted time, kept so a quiet-hours shift cannot cause a second
     *  reminder to be scheduled for the same underlying deadline. */
    originalSendAt: timestamp('original_send_at', { withTimezone: true }).notNull(),
    kind: text('kind').notNull().default('task_due'),
    state: text('state').notNull().default('pending'), // pending|sent|failed|skipped
    failureReason: text('failure_reason'),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    attempts: integer('attempts').notNull().default(0),
    /** Lease for the future scheduler, so two runners cannot both claim it. */
    claimedUntil: timestamp('claimed_until', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('reminder_due_idx').on(t.state, t.sendAt),
    // One pending reminder per task per recipient per intended time. This is
    // what stops a quiet-hours shift or a retry creating a duplicate.
    uniqueIndex('reminder_dedup_key').on(t.taskId, t.recipientUserId, t.originalSendAt),
  ],
);

/** Webhook dedup. LINE retries slow endpoints, and that is exactly how
 *  duplicate tasks appear in production. */
export const lineEvent = pgTable(
  'line_event',
  {
    webhookEventId: text('webhook_event_id').primaryKey(),
    type: text('type').notNull(),
    isRedelivery: boolean('is_redelivery').notNull().default(false),
    payload: jsonb('payload'),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  },
);

/** Metered by actual recipient count, not API call count. */
export const messageUsage = pgTable(
  'message_usage',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id').notNull().references(() => workspace.id, { onDelete: 'cascade' }),
    /** 'reply' is not counted against the LINE quota; 'push' is, per recipient. */
    channel: text('channel').notNull(),
    recipientCount: integer('recipient_count').notNull().default(1),
    /** YYYY-MM in Asia/Bangkok, so a cap is a calendar-month cap for the user. */
    billingMonth: text('billing_month').notNull(),
    taskId: text('task_id'),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('message_usage_month_idx').on(t.workspaceId, t.billingMonth)],
);

/** Server-side login state for the non-LIFF web flow: random `state` + PKCE
 *  verifier, never handed to the browser. */
export const authState = pgTable('auth_state', {
  state: text('state').primaryKey(),
  codeVerifier: text('code_verifier').notNull(),
  redirectTo: text('redirect_to'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const session = pgTable(
  'session',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull().references(() => lineUser.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('session_user_idx').on(t.userId)],
);

/** Makes every mutating route safe to retry. */
export const idempotencyKey = pgTable(
  'idempotency_key',
  {
    key: text('key').primaryKey(),
    workspaceId: text('workspace_id').notNull(),
    route: text('route').notNull(),
    resultId: text('result_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
);
