/**
 * Who may change a task. One rule for every surface.
 *
 * The status buttons (app and LINE) enforced this in transitions.ts, while the
 * edit route only checked workspace membership — so any member could retitle,
 * redate or reassign anyone's task through the edit form, bypassing the lock
 * the UI shows. Both now ask this function.
 *
 * Pure, so it can be tested without a database.
 */
export type TaskAccessFields = {
  assigneeUserId: string | null;
  primaryAssigneeUserId: string | null;
  pendingAssigneeUserId?: string | null;
  createdByUserId: string | null;
};

export type TaskActor = { userId: string; role: string };

export function isWorkspaceManager(role: string): boolean {
  return role === 'owner' || role === 'admin';
}

/** May this person act on the task at all (before action-specific rules)? */
export function mayActOnTask(task: TaskAccessFields, actor: TaskActor): boolean {
  return (
    task.assigneeUserId === actor.userId ||
    task.primaryAssigneeUserId === actor.userId ||
    // The person a handoff was offered to must be able to answer it.
    task.pendingAssigneeUserId === actor.userId ||
    // Whoever asked for the work signs it off.
    task.createdByUserId === actor.userId ||
    isWorkspaceManager(actor.role)
  );
}

/**
 * May this person edit the task's fields (title, deadline, assignee, note)?
 *
 * Narrower than mayActOnTask: someone who has only been OFFERED a handoff has
 * not accepted responsibility yet, so they can answer the offer but not edit.
 */
export function mayEditTaskFields(task: TaskAccessFields, actor: TaskActor): boolean {
  return (
    task.assigneeUserId === actor.userId ||
    task.primaryAssigneeUserId === actor.userId ||
    task.createdByUserId === actor.userId ||
    isWorkspaceManager(actor.role)
  );
}
