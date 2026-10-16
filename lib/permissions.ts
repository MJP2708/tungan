/**
 * Who may do what — the ONLY place a role is compared (2026-10-17).
 *
 *     can(user, action, group, task?) -> boolean
 *
 * Two roles on group membership: MEMBER and MANAGER. A "group" is a
 * workspace: each LINE group has exactly one, and a workspace made in the app
 * is a group with no LINE chat. The same person can be MANAGER in one group
 * and MEMBER in another, because the role lives on the membership row.
 *
 * A personal workspace is "no group": the person's own, made at first
 * sign-in. Only the person who created a task there can ever see or touch it,
 * and they close it directly — the one exception to submitted ≠ closed.
 *
 * Pure: no database. The server loads the facts (lib/auth/roles.ts) and the
 * browser has them from the members list, so both ask the same function and
 * the app never offers a button the server will refuse. Every route, server
 * action and LINE postback handler asks this; none compares a role itself.
 */

export type Role = 'manager' | 'member';
/** The stored values. Other files write and query roles with these, never a
 *  string of their own. */
export const MANAGER: Role = 'manager';
export const MEMBER: Role = 'member';
export const ROLES: readonly Role[] = [MANAGER, MEMBER];

/** A stored role, read safely. Unknown text is a MEMBER, never a MANAGER. */
export function roleOf(value: unknown): Role | null {
  if (value === 'manager') return 'manager';
  if (value === 'member') return 'member';
  return null;
}

export function isRole(value: unknown): value is Role {
  return value === 'manager' || value === 'member';
}

/** Display: is this stored role the manager one? (For labels and sorting.) */
export function isManagerRole(value: unknown): boolean {
  return roleOf(value) === 'manager';
}

export type Action =
  // Member and Manager
  | 'create_task'
  | 'view_group_tasks'
  | 'update_own_task_progress'
  | 'submit_own_task'
  | 'flag_blocked_own_task'
  | 'view_own_blocked_reason'
  // Manager only
  | 'approve_task'
  | 'request_revision'
  | 'reassign_task'
  | 'change_deadline'
  | 'view_blocked_reason'
  | 'change_member_role'
  | 'edit_group_settings'
  // Existing actions the spec did not list, mapped here so nothing decides
  // outside this file (each says who, below).
  | 'edit_task_details'
  | 'delete_task'
  | 'offer_handoff'
  | 'answer_handoff'
  | 'undo_new_task'
  | 'answer_question'
  | 'post_announcement'
  | 'see_unread_names'
  | 'edit_shared_event'
  | 'ask_question'
  | 'manage_others_reminders'
  | 'edit_member_nickname';

/** The person asking. */
export type Actor = { userId: string };

/** What is known about the group, from this person's point of view. */
export type GroupFacts = {
  /** Their role here; null when they are not a member at all. */
  role: Role | null;
  kind: 'team' | 'personal';
  /** Managers in the group right now. */
  managerCount: number;
  /** Who set the group up: the recovery path for naming a Manager. */
  createdByUserId: string | null;
};

export type TaskFacts = {
  assigneeUserId: string | null;
  primaryAssigneeUserId?: string | null;
  pendingAssigneeUserId?: string | null;
  createdByUserId: string | null;
};

/** Extra facts some actions need. */
export type Extra = {
  /** change_member_role: whose role. */
  targetUserId?: string | null;
  /** view_own_blocked_reason: who wrote the note. */
  noteAuthorUserId?: string | null;
  /** answer_question: who was asked, and who asked. */
  askedOfUserId?: string | null;
  askedByUserId?: string | null;
  /** see_unread_names / edit_shared_event: who made the thing. */
  authorUserId?: string | null;
};

const MEMBER_ACTIONS = new Set<Action>([
  'create_task',
  'view_group_tasks',
  'update_own_task_progress',
  'submit_own_task',
  'flag_blocked_own_task',
  'view_own_blocked_reason',
]);

export function can(
  user: Actor,
  action: Action,
  group: GroupFacts,
  task?: TaskFacts | null,
  extra: Extra = {},
): boolean {
  const me = user.userId;
  if (!me || !group.role) return false;
  const manager = group.role === 'manager';
  const assignee = !!task && task.assigneeUserId === me;

  // ── No group: a personal task belongs to whoever made it, entirely. ──
  // Nobody else — no Manager, not the workspace creator — can see or act on
  // it, and its maker closes it directly (approve_task) with no reviewer.
  if (group.kind === 'personal') {
    if (action === 'create_task' || action === 'view_group_tasks') return true;
    // One person, no one else to name; settings (name, AI) are theirs.
    if (action === 'change_member_role') return false;
    if (action === 'edit_group_settings') return manager;
    if (!task) return false;
    return task.createdByUserId === me || assignee;
  }

  switch (action) {
    case 'create_task':
    case 'view_group_tasks':
      return true;

    // Your own task: the person it is assigned to.
    case 'update_own_task_progress':
    case 'submit_own_task':
    case 'flag_blocked_own_task':
    case 'offer_handoff':
      return assignee;

    case 'view_own_blocked_reason':
      return (
        !!task &&
        (assignee || task.primaryAssigneeUserId === me || extra.noteAuthorUserId === me)
      );

    case 'answer_handoff':
      return !!task && task.pendingAssigneeUserId === me;

    // ── Manager only ──
    case 'approve_task':
      if (!manager || !task) return false;
      // Not your own work while another Manager could sign it off. As the
      // only Manager you may — and the audit log marks it self_approved.
      if (assignee && group.managerCount > 1) return false;
      return true;
    case 'request_revision':
    case 'reassign_task':
    case 'change_deadline':
    case 'view_blocked_reason':
    case 'edit_group_settings':
    case 'post_announcement':
    case 'see_unread_names':
      return manager;

    case 'change_member_role': {
      // Nobody changes their own role.
      if (!extra.targetUserId || extra.targetUserId === me) return false;
      // Managers do; the person who set the group up always may (recovery,
      // e.g. after the last Manager left), even as a Member.
      return manager || group.createdByUserId === me;
    }

    // Title, note, priority, proof link: the person doing it, or a Manager.
    case 'edit_task_details':
      return assignee || manager;

    // Deleting removes someone's record of the work: who asked for it, or a
    // Manager.
    case 'delete_task':
      return manager || (!!task && task.createdByUserId === me);

    // The 30-second "take it back" right after confirming in LINE.
    case 'undo_new_task':
      return manager || (!!task && task.createdByUserId === me);

    // The person asked answers; a Manager may stand in, but never the asker.
    case 'answer_question':
      if (extra.askedOfUserId === me) return true;
      return manager && extra.askedByUserId !== me;

    case 'edit_shared_event':
      return extra.authorUserId === me || manager;

    // Asking someone for information about a task: its worker, or a Manager.
    case 'ask_question':
      return assignee || manager;

    // A reminder set for somebody else.
    case 'manage_others_reminders':
      return manager;

    // Your own nickname, always; someone else's, a Manager.
    case 'edit_member_nickname':
      return extra.targetUserId === me || manager;

    default:
      return MEMBER_ACTIONS.has(action);
  }
}

/**
 * Why `can` said no, for the person reading the refusal. Thai, like every
 * fixed server message; the app translates it where it is shown.
 */
export function refusal(action: Action, group: GroupFacts, task?: TaskFacts | null, me?: string): string {
  if (!group.role) return 'ไม่พบงานนี้';
  if (group.kind === 'personal') return 'งานส่วนตัว · เฉพาะคนที่สร้างเท่านั้น';
  switch (action) {
    case 'approve_task':
      if (group.role === 'manager' && task?.assigneeUserId === me && group.managerCount > 1) {
        return 'อนุมัติงานของตัวเองไม่ได้ · ให้ผู้จัดการอีกคนอนุมัติ';
      }
      if (group.managerCount === 0) return 'กลุ่มนี้ยังไม่มีผู้จัดการ · รอผู้จัดการก่อนจึงอนุมัติได้';
      return 'อนุมัติได้เฉพาะผู้จัดการ';
    case 'request_revision':
      return 'ขอแก้ไขได้เฉพาะผู้จัดการ';
    case 'reassign_task':
      return 'เปลี่ยนผู้รับผิดชอบได้เฉพาะผู้จัดการ';
    case 'change_deadline':
      return 'เปลี่ยนกำหนดส่งได้เฉพาะผู้จัดการ';
    case 'change_member_role':
      return 'เปลี่ยนบทบาทได้เฉพาะผู้จัดการ และเปลี่ยนของตัวเองไม่ได้';
    case 'edit_group_settings':
    case 'post_announcement':
      return 'ทำได้เฉพาะผู้จัดการ';
    case 'delete_task':
      return 'ลบได้เฉพาะผู้สร้างงานหรือผู้จัดการ';
    default:
      return 'งานนี้ดูได้อย่างเดียว เพราะคุณไม่ใช่ผู้รับผิดชอบ';
  }
}
