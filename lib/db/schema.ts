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
  /** When this team is actually at work. A nudge outside these hours is
   *  buried by the time anyone reads it. */
  workingHoursStart: text('working_hours_start').notNull().default('09:00'),
  workingHoursEnd: text('working_hours_end').notNull().default('18:00'),
  /** Time of day a deadline picked as a bare date resolves to. */
  defaultDueTime: text('default_due_time').notNull().default('18:00'),
  /** Counted LINE messages allowed per calendar month for this workspace. */
  monthlyMessageCap: integer('monthly_message_cap').notNull().default(300),
  /** How long a submission may sit before the reviewer is nudged, once.
   *  One working day by default. There is deliberately no auto-approve
   *  setting: an approval nobody made is a record that proves nothing. */
  reviewNudgeHours: integer('review_nudge_hours').notNull().default(24),
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
    /** Who connected this group. Binding decides where a group's messages
     *  land, so it is an accountable action, not an anonymous one. */
    boundByUserId: text('bound_by_user_id').references(() => lineUser.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.lineGroupId, t.workspaceId] }),
    // A group belongs to one workspace: two bindings would split its
    // messages across workspaces with no way to tell which is right.
    uniqueIndex('group_workspace_group_key').on(t.lineGroupId),
  ],
);

/**
 * Who we have actually seen in a LINE group.
 *
 * The full member list endpoint needs a Verified or Premium account, so until
 * then this is the only member list that exists: people become known by
 * joining or by speaking. The UI must say so rather than presenting it as
 * complete.
 */
export const lineGroupMember = pgTable(
  'line_group_member',
  {
    lineGroupId: text('line_group_id').notNull().references(() => lineGroup.id, { onDelete: 'cascade' }),
    userId: text('user_id').notNull().references(() => lineUser.id, { onDelete: 'cascade' }),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.lineGroupId, t.userId] }),
    index('line_group_member_user_idx').on(t.userId),
  ],
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
    /** todo|progress|blocked|review|done. `review` is รอตรวจ and `done` is
     *  closed. Submitting is not closing: only someone with review rights
     *  moves a task to done, which is what makes the evidence trail mean
     *  anything. */
    status: text('status').notNull().default('todo'),
    priority: text('priority').notNull().default('normal'),
    reviewState: text('review_state').notNull().default('working'),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    /** When the worker submitted. The reviewer's nudge is measured from this,
     *  not from the deadline: a task submitted early should not be chased
     *  early. */
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    /** Resolved once, at submit, so the nudge has a definite recipient rather
     *  than a rule re-derived later against a workspace that has since
     *  changed hands. */
    reviewerUserId: text('reviewer_user_id').references(() => lineUser.id, { onDelete: 'set null' }),
    /** When it actually closed. Never set by the worker. */
    closedAt: timestamp('closed_at', { withTimezone: true }),
    /** A handoff waits here until the receiver accepts. Until then the task
     *  is still the sender's: an unaccepted handoff that silently moved
     *  responsibility is how work falls between two people. */
    pendingAssigneeUserId: text('pending_assignee_user_id').references(() => lineUser.id, { onDelete: 'set null' }),
    handoffOfferedAt: timestamp('handoff_offered_at', { withTimezone: true }),
    /** รอลูกค้า | รอของ | รอคนอื่น | อื่นๆ — a preset, so "blocked" is
     *  sortable and countable rather than only free text. */
    blockedReason: text('blocked_reason'),
    /** When the status last changed, so time-in-state can be shown. Time
     *  stuck is more actionable than a count of overdue tasks. */
    statusChangedAt: timestamp('status_changed_at', { withTimezone: true }).notNull().defaultNow(),
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
    /** The fields this event changed, as they were before it.
     *  Undo restores exactly these rather than guessing an inverse: there is
     *  no reliable inverse of "blocked" without knowing what it was before. */
    previousState: jsonb('previous_state'),
    /** Set once this event has been undone, which is what makes undo
     *  idempotent — a second undo of the same event does nothing. */
    undoneAt: timestamp('undone_at', { withTimezone: true }),
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

/**
 * A question attached to a task, addressed to a named person.
 *
 * ขอข้อมูล used to be only a status: the label changed and nothing reached
 * anyone. Naming who is being asked is what turns "this task is late" into
 * "this task is waiting on Somchai", which is the difference between the tool
 * helping and the tool blaming.
 */
export const taskQuestion = pgTable(
  'task_question',
  {
    id: text('id').primaryKey(),
    taskId: text('task_id').notNull().references(() => task.id, { onDelete: 'cascade' }),
    workspaceId: text('workspace_id').notNull().references(() => workspace.id, { onDelete: 'cascade' }),
    askedByUserId: text('asked_by_user_id').references(() => lineUser.id, { onDelete: 'set null' }),
    /** Who is being asked. The task waits on them, not on the assignee. */
    askedOfUserId: text('asked_of_user_id').notNull().references(() => lineUser.id, { onDelete: 'cascade' }),
    question: text('question').notNull(),
    answer: text('answer'),
    answeredAt: timestamp('answered_at', { withTimezone: true }),
    /** When an unanswered question should surface to the owner. */
    escalateAt: timestamp('escalate_at', { withTimezone: true }),
    escalatedAt: timestamp('escalated_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('task_question_task_idx').on(t.taskId),
    index('task_question_open_idx').on(t.askedOfUserId, t.answeredAt),
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
    /** task_due = the single pre-deadline nudge to the assignee.
     *  owner_overdue = the single escalation to whoever asked for the work. */
    kind: text('kind').notNull().default('task_due'),
    state: text('state').notNull().default('pending'), // pending|sent|failed|skipped
    failureReason: text('failure_reason'),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    attempts: integer('attempts').notNull().default(0),
    /** Snoozing is capped: unlimited deferral is indistinguishable from
     *  ignoring, and it hides the fact that nothing is moving. */
    snoozeCount: integer('snooze_count').notNull().default(0),
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

/**
 * When a person is actually at work, per workspace.
 *
 * Learned from when they respond rather than assumed: a fixed 09:00 for
 * everyone sends the morning nudge to a night-shift installer while they
 * sleep, and a reminder read six hours late is a reminder that did nothing.
 * Always visible and always overridable — a schedule inferred about someone
 * that they cannot see or correct is surveillance, not a feature.
 */
export const memberSchedule = pgTable(
  'member_schedule',
  {
    workspaceId: text('workspace_id').notNull().references(() => workspace.id, { onDelete: 'cascade' }),
    userId: text('user_id').notNull().references(() => lineUser.id, { onDelete: 'cascade' }),
    startsAt: text('starts_at').notNull().default('09:00'),
    endsAt: text('ends_at').notNull().default('18:00'),
    /** True once a person edits it, after which observation stops overwriting. */
    isManual: boolean('is_manual').notNull().default(false),
    /** How many observations the learned value rests on. */
    samples: integer('samples').notNull().default(0),
    /** Earliest hour seen, as minutes past midnight, averaged. */
    observedStartMinutes: integer('observed_start_minutes'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.workspaceId, t.userId] })],
);

/** Webhook dedup. LINE retries slow endpoints, and that is exactly how
 *  duplicate tasks appear in production. */
export const lineEvent = pgTable(
  'line_event',
  {
    webhookEventId: text('webhook_event_id').primaryKey(),
    type: text('type').notNull(),
    /** user | group | room — decides which fallback path applies. */
    sourceType: text('source_type'),
    /** The group/room/user id the event came from. */
    sourceId: text('source_id'),
    /** Present on most events; absent when LINE cannot disclose the sender. */
    senderUserId: text('sender_user_id'),
    isRedelivery: boolean('is_redelivery').notNull().default(false),
    /** Set once the work behind the event finished, so a truncated run is
     *  visible instead of looking identical to a successful one. */
    processedAt: timestamp('processed_at', { withTimezone: true }),
    processingError: text('processing_error'),
    payload: jsonb('payload'),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('line_event_source_idx').on(t.sourceType, t.sourceId),
    index('line_event_received_idx').on(t.receivedAt),
  ],
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

/**
 * What a workspace has corrected before.
 *
 * When someone fixes an assignee the parser got wrong, the same phrase should
 * resolve correctly next time. Scoped to one workspace and never shared: two
 * companies can use the same nickname for different people, and carrying a
 * mapping across them would assign work to a stranger. This is learning with
 * no model involved — it is a lookup table people fill in by correcting.
 */
export const nameCorrection = pgTable(
  'name_correction',
  {
    workspaceId: text('workspace_id').notNull().references(() => workspace.id, { onDelete: 'cascade' }),
    /** The phrase as written, lower-cased. */
    phrase: text('phrase').notNull(),
    userId: text('user_id').notNull().references(() => lineUser.id, { onDelete: 'cascade' }),
    timesUsed: integer('times_used').notNull().default(1),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.workspaceId, t.phrase] })],
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
