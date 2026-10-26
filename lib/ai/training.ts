import 'server-only';
import { eq, sql } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { aiTrainingExample, inboxItem, workspace } from '../db/schema.ts';

/**
 * Training data (approved 2026-10-25). The policy, in code:
 *   - per team, OFF until a Manager opts in (edit_group_settings), and the
 *     consent wording version they agreed to is stored with every example;
 *   - only confirmed drafts — a message that tagged the bot, what the rules
 *     read, what the model read, and what the person confirmed. Never other
 *     chat, never untagged messages;
 *   - unsend deletes the example made from that message; opting out deletes
 *     every example of the team at once.
 * Nothing trains on these here: they are kept for a later, separate step.
 */

/** Bump when the wording people agree to changes (app/privacy, ตั้งค่า AI). */
export const TRAINING_CONSENT_VERSION = '2026-10-26';

export async function setTrainingOptIn(params: {
  workspaceId: string;
  actorUserId: string;
  on: boolean;
}): Promise<{ deleted: number }> {
  if (params.on) {
    await db()
      .update(workspace)
      .set({
        aiTrainingOptIn: true,
        aiTrainingConsentAt: new Date(),
        aiTrainingConsentBy: params.actorUserId,
        aiTrainingConsentVersion: TRAINING_CONSENT_VERSION,
      })
      .where(eq(workspace.id, params.workspaceId));
    return { deleted: 0 };
  }
  await db().update(workspace).set({ aiTrainingOptIn: false }).where(eq(workspace.id, params.workspaceId));
  const removed = await db()
    .delete(aiTrainingExample)
    .where(eq(aiTrainingExample.workspaceId, params.workspaceId))
    .returning({ id: aiTrainingExample.id });
  return { deleted: removed.length };
}

type Reading = { title: string; assigneeUserId: string | null; dueAt: string | null };

const asReading = (value: unknown): Reading | null => {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  return {
    title: typeof v.title === 'string' ? v.title : '',
    assigneeUserId: typeof v.assigneeUserId === 'string' ? v.assigneeUserId : null,
    dueAt: typeof v.dueAt === 'string' ? v.dueAt : null,
  };
};

/**
 * A draft was confirmed. Kept only if its team has opted in, and only if the
 * message text still existed when it was confirmed (unsend or retention may
 * have cleared it). The caller passes the draft as it read it BEFORE the
 * confirm cleared its text and readings. Never throws: training must not be
 * able to break confirming a task.
 */
export async function recordConfirmedDraft(params: {
  draft: Pick<
    typeof inboxItem.$inferSelect,
    | 'id'
    | 'workspaceId'
    | 'rawMessage'
    | 'sourceMessageId'
    | 'lineMessageId'
    | 'suggestedTitle'
    | 'suggestedAssigneeUserId'
    | 'suggestedDueAt'
    | 'rulesReading'
    | 'aiReading'
  >;
  confirmed: { title: string; assigneeUserIds: string[]; dueAt: Date | null };
}): Promise<boolean> {
  try {
    const row = params.draft;
    if (!row.rawMessage) return false;
    const [ws] = await db()
      .select({ optIn: workspace.aiTrainingOptIn, version: workspace.aiTrainingConsentVersion })
      .from(workspace)
      .where(eq(workspace.id, row.workspaceId))
      .limit(1);
    if (!ws?.optIn) return false;
    const confirmed = {
      title: params.confirmed.title,
      assigneeUserIds: params.confirmed.assigneeUserIds,
      dueAt: params.confirmed.dueAt ? params.confirmed.dueAt.toISOString() : null,
    };
    // Corrected: the person changed anything from what was put in front of them.
    const shown = {
      title: row.suggestedTitle,
      assigneeUserId: row.suggestedAssigneeUserId,
      dueAt: row.suggestedDueAt ? row.suggestedDueAt.toISOString() : null,
    };
    // (A ทุกคน draft confirms many people; only a single person is compared.)
    const personChanged =
      confirmed.assigneeUserIds.length === 1 && confirmed.assigneeUserIds[0] !== shown.assigneeUserId;
    const corrected = shown.title !== confirmed.title || shown.dueAt !== confirmed.dueAt || personChanged;
    await db().insert(aiTrainingExample).values({
      id: crypto.randomUUID(),
      workspaceId: row.workspaceId,
      inboxItemId: row.id,
      lineMessageId: row.sourceMessageId ?? row.lineMessageId,
      sourceText: row.rawMessage,
      rulesReading: asReading(row.rulesReading) ?? shown,
      aiReading: asReading(row.aiReading),
      confirmed,
      corrected,
      consentVersion: ws.version ?? TRAINING_CONSENT_VERSION,
    });
    return true;
  } catch (error) {
    console.error('[ai][training] could not record an example', error);
    return false;
  }
}

/** Someone took their message back in LINE: the example goes too. */
export async function forgetMessage(lineMessageId: string): Promise<void> {
  await db().delete(aiTrainingExample).where(eq(aiTrainingExample.lineMessageId, lineMessageId));
}

/** For the settings screen. */
export async function trainingStatus(workspaceId: string) {
  const [ws] = await db()
    .select({
      optIn: workspace.aiTrainingOptIn,
      consentAt: workspace.aiTrainingConsentAt,
      version: workspace.aiTrainingConsentVersion,
    })
    .from(workspace)
    .where(eq(workspace.id, workspaceId))
    .limit(1);
  const [count] = await db()
    .select({ n: sql<number>`count(*)::int` })
    .from(aiTrainingExample)
    .where(eq(aiTrainingExample.workspaceId, workspaceId));
  return {
    optIn: Boolean(ws?.optIn),
    consentAt: ws?.consentAt ?? null,
    consentVersion: ws?.version ?? null,
    currentVersion: TRAINING_CONSENT_VERSION,
    examples: Number(count?.n ?? 0),
  };
}
