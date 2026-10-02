import 'server-only';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { aiUsage, workspace } from '../db/schema.ts';
import { zonedDateParts } from '../deadline.ts';
import { aiConfigured } from './model.ts';
import { isUniqueViolation } from '../db/errors.ts';

/**
 * What an AI read costs, and whether this workspace may spend one.
 *
 * The AI scope's rules, in one place: a hard cap per day and one for the whole
 * allowance, a kill switch, no negative balances, and a retry under the same
 * source never charged twice. When there is nothing left, everything else in
 * the product carries on — the rules, manual creation, reminders and every
 * status action are untouched.
 *
 * Spending is recorded BEFORE the model is called. Paying for an answer that
 * never arrives is the honest direction to fail: the alternative is a way to
 * call the model for free by dropping the connection.
 */

export type SpendOutcome =
  | 'ok'
  | 'off' // no key, kill switch thrown, or the team has not turned it on
  | 'already' // same source read before; costs nothing
  | 'over_daily'
  | 'over_allowance';

/** Weighted consumption: text 1. Image and voice are not built yet. */
const UNITS = { text: 1 } as const;

function bangkokDay(now: Date): string {
  const { year, month, day } = zonedDateParts(now);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export async function spendAiRead(
  params: { workspaceId: string; sourceId: string; kind?: keyof typeof UNITS },
  now = new Date(),
): Promise<SpendOutcome> {
  if (!aiConfigured()) return 'off';

  const [ws] = await db()
    .select({
      enabled: workspace.aiEnabled,
      dailyCap: workspace.aiDailyCap,
      allowance: workspace.aiAllowance,
    })
    .from(workspace)
    .where(eq(workspace.id, params.workspaceId))
    .limit(1);
  if (!ws?.enabled) return 'off';

  const kind = params.kind ?? 'text';
  const units = UNITS[kind];
  const day = bangkokDay(now);

  const [totals] = await db()
    .select({
      spent: sql<number>`coalesce(sum(${aiUsage.units}), 0)`,
      today: sql<number>`coalesce(sum(case when ${aiUsage.day} = ${day} then ${aiUsage.units} else 0 end), 0)`,
    })
    .from(aiUsage)
    .where(eq(aiUsage.workspaceId, params.workspaceId));

  if (Number(totals?.spent ?? 0) + units > ws.allowance) return 'over_allowance';
  if (Number(totals?.today ?? 0) + units > ws.dailyCap) return 'over_daily';

  try {
    await db().insert(aiUsage).values({
      id: crypto.randomUUID(),
      workspaceId: params.workspaceId,
      sourceId: params.sourceId,
      kind,
      units,
      day,
    });
  } catch (error) {
    // The unique index already holds this source: a retry, not a new read.
    if (isUniqueViolation(error)) return 'already';
    throw error;
  }
  return 'ok';
}

export type AiAllowance = {
  /** A key exists and the kill switch is not thrown. Server-side fact. */
  configured: boolean;
  /** Configured AND this team turned it on. */
  enabled: boolean;
  /** Reads left in the whole allowance, never below zero. */
  remaining: number;
  allowance: number;
  usedToday: number;
  dailyCap: number;
};

/** What the UI shows. Never the words token or credit in Thai. */
export async function aiAllowanceFor(workspaceId: string, now = new Date()): Promise<AiAllowance> {
  // Answer without touching the database when AI is off. It also means this
  // code is safe to deploy before the migration that adds its columns.
  if (!aiConfigured()) {
    return { configured: false, enabled: false, remaining: 0, allowance: 0, usedToday: 0, dailyCap: 0 };
  }
  const [ws] = await db()
    .select({
      enabled: workspace.aiEnabled,
      dailyCap: workspace.aiDailyCap,
      allowance: workspace.aiAllowance,
    })
    .from(workspace)
    .where(eq(workspace.id, workspaceId))
    .limit(1);

  const day = bangkokDay(now);
  const [totals] = await db()
    .select({
      spent: sql<number>`coalesce(sum(${aiUsage.units}), 0)`,
      today: sql<number>`coalesce(sum(case when ${aiUsage.day} = ${day} then ${aiUsage.units} else 0 end), 0)`,
    })
    .from(aiUsage)
    .where(eq(aiUsage.workspaceId, workspaceId));

  const allowance = ws?.allowance ?? 0;
  return {
    configured: true,
    enabled: Boolean(ws?.enabled),
    allowance,
    remaining: Math.max(0, allowance - Number(totals?.spent ?? 0)),
    usedToday: Number(totals?.today ?? 0),
    dailyCap: ws?.dailyCap ?? 0,
  };
}

/** Give a read back when the model never answered. Keeps counts honest. */
export async function refundAiRead(workspaceId: string, sourceId: string): Promise<void> {
  await db()
    .delete(aiUsage)
    .where(and(eq(aiUsage.workspaceId, workspaceId), eq(aiUsage.sourceId, sourceId)))
    .catch(() => {});
}
