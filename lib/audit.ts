import 'server-only';
import { db } from './db/index.ts';
import { auditLog } from './db/schema.ts';

/**
 * The audit log (2026-10-17): role changes, approvals (self-approval
 * flagged), revision requests, reassignments and deadline changes. Written
 * by whoever makes the change, in the same request; never edited.
 */
export type AuditAction =
  | 'role_changed'
  | 'manager_left'
  | 'task_approved'
  | 'revision_requested'
  | 'task_reassigned'
  | 'deadline_changed';

type Executor = Pick<ReturnType<typeof db>, 'insert'>;

export async function audit(
  entry: {
    actorUserId: string | null;
    action: AuditAction;
    workspaceId: string;
    targetUserId?: string | null;
    targetTaskId?: string | null;
    before?: unknown;
    after?: unknown;
    selfApproved?: boolean;
  },
  executor: Executor = db(),
): Promise<void> {
  await executor.insert(auditLog).values({
    id: crypto.randomUUID(),
    actorUserId: entry.actorUserId,
    action: entry.action,
    workspaceId: entry.workspaceId,
    targetUserId: entry.targetUserId ?? null,
    targetTaskId: entry.targetTaskId ?? null,
    before: entry.before ?? null,
    after: entry.after ?? null,
    selfApproved: entry.selfApproved ?? false,
  });
}
