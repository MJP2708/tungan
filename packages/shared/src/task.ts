// One definition of a Task, imported by both the UI and the Worker.
//
// The deadline is an ISO instant. Status words live in `status` and never in
// the deadline field — the prototype wrote "เสร็จเมื่อสักครู่" over `due`,
// which destroyed the original time and made reminders impossible.

export type TaskStatus = 'todo' | 'progress' | 'blocked' | 'done';
export type TaskPriority = 'urgent' | 'high' | 'normal';
export type ReviewState = 'working' | 'review' | 'approved' | 'revision';
export type AssigneeType = 'member' | 'team';

export type WorkspaceRole = 'owner' | 'admin' | 'member';

export type Evidence = {
  label: string;
  url: string;
};

export type ActivityEntry = {
  text: string;
  /** ISO instant. The prototype stored the literal string "เมื่อสักครู่". */
  at: string;
  actorId?: string;
};

export type Task = {
  id: string;
  workspaceId: string;
  title: string;
  note: string;
  assigneeType: AssigneeType;
  assigneeId: string;
  primaryAssigneeType?: AssigneeType;
  primaryAssigneeId?: string;
  source: string;
  /** ISO instant, resolved in Asia/Bangkok when the task was created. */
  dueAt: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  reviewState: ReviewState;
  /** ISO instant, or null when nobody has accepted the task yet. */
  acceptedAt: string | null;
  evidence: Evidence[];
  activity: ActivityEntry[];
  createdAt: string;
  updatedAt: string;
};

export type Member = {
  id: string;
  /** The LINE user ID is the identity. Nicknames are display only. */
  lineUserId: string | null;
  lineName: string;
  nickname: string;
  initials: string;
  role: string;
  /** False when the member has not added the OA as a friend: they cannot
   *  receive reminder DMs and the UI must say so rather than dropping them. */
  canReceiveDirectMessages: boolean;
};

/** Server-side authorization result. A client-supplied workspace ID is never
 *  sufficient on its own — the API resolves membership before touching data. */
export type Membership = {
  workspaceId: string;
  lineUserId: string;
  role: WorkspaceRole;
};
