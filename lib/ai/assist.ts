import 'server-only';
import { and, eq } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { aiUsage } from '../db/schema.ts';
import { callModel, type Fetch } from './client.ts';
import { askJev, type JevAnswers } from './jev.ts';
import type { JevRequest } from './jev-questions.ts';
import { refundAiRead, spendAiRead } from './allowance.ts';
import { buildReadRequest, parseReadResponse, READ_SCHEMA, type Member, type ModelTask } from './read-message.ts';
import { buildPrioritizeRequest, parsePrioritizeResponse, PRIORITIZE_SCHEMA, type Suggestion } from './prioritize.ts';
import {
  buildPeriodSummaryRequest,
  buildTaskSummaryRequest,
  parsePeriodSummary,
  parseTaskSummary,
  PERIOD_SUMMARY_SCHEMA,
  TASK_SUMMARY_SCHEMA,
} from './summarize.ts';
import type { MyTask } from '../tasks/my-tasks.ts';

/**
 * The three AI features, each one call and one structured answer
 * (2026-10-25). Every one:
 *   - spends from the workspace's allowance BEFORE calling (lib/ai/allowance:
 *     daily cap, total cap, kill switch, team switch, never negative), keyed
 *     by a source id so a retry is never charged twice — and never answered
 *     twice either: the answer is kept on the usage row and a retry gets it
 *     back, so a reused key is not a way to call the model for free;
 *   - gives the read back when the model did not answer;
 *   - returns null when anything is off or fails, and the product carries on
 *     exactly as without AI;
 *   - proposes only. Nothing here creates or changes a task.
 */

export type AiRefusal = 'off' | 'over_daily' | 'over_allowance' | 'failed';

/**
 * Spend, call once, keep the answer. `parse` runs on a fresh answer and on a
 * stored one alike, so both are checked the same way.
 */
async function answerOnce<T>(
  params: {
    workspaceId: string;
    sourceId: string;
    run: () => Promise<{ ok: true; data: unknown } | { ok: false }>;
  },
  parse: (data: unknown) => T | null,
): Promise<{ ok: true; value: T } | { ok: false; reason: AiRefusal }> {
  const spent = await spendAiRead({ workspaceId: params.workspaceId, sourceId: params.sourceId });
  if (spent === 'already') {
    const [row] = await db()
      .select({ answer: aiUsage.answer })
      .from(aiUsage)
      .where(and(eq(aiUsage.workspaceId, params.workspaceId), eq(aiUsage.sourceId, params.sourceId)))
      .limit(1);
    const value = row?.answer == null ? null : parse(row.answer);
    // No answer yet: the first call is still running (or was lost). Say so
    // rather than call again unpaid.
    return value ? { ok: true, value } : { ok: false, reason: 'failed' };
  }
  if (spent !== 'ok') return { ok: false, reason: spent };
  const res = await params.run();
  const value = res.ok ? parse(res.data) : null;
  if (!res.ok || !value) {
    await refundAiRead(params.workspaceId, params.sourceId);
    return { ok: false, reason: 'failed' };
  }
  await db()
    .update(aiUsage)
    .set({ answer: res.data as object })
    .where(and(eq(aiUsage.workspaceId, params.workspaceId), eq(aiUsage.sourceId, params.sourceId)))
    .catch(() => {});
  return { ok: true, value };
}

/** Jev's quick judgments on a tagged message (lib/ai/jev-questions.ts). */
export async function checkMessageWithJev(params: {
  workspaceId: string;
  sourceId: string;
  request: JevRequest;
  fetchImpl?: Fetch;
}): Promise<JevAnswers | null> {
  const out = await answerOnce(
    {
      workspaceId: params.workspaceId,
      sourceId: `check:${params.sourceId}`,
      run: async () => {
        const res = await askJev({ state: params.request.state, questions: params.request.questions }, params.fetchImpl);
        return res.ok ? { ok: true, data: res.answers } : { ok: false };
      },
    },
    (data) => (data && typeof data === 'object' && !Array.isArray(data) ? (data as JevAnswers) : null),
  );
  return out.ok ? out.value : null;
}

/** A tagged message the rules could not read well. */
export async function readMessageWithModel(params: {
  workspaceId: string;
  sourceId: string;
  text: string;
  members: Member[];
  senderUserId?: string | null;
  cutoff: string;
  now?: Date;
  fetchImpl?: Fetch;
}): Promise<ModelTask[] | null> {
  const req = buildReadRequest({ text: params.text, members: params.members, senderUserId: params.senderUserId, now: params.now ?? new Date() });
  const out = await answerOnce(
    {
      workspaceId: params.workspaceId,
      sourceId: `read:${params.sourceId}`,
      // The reply token lasts about a minute; leave room for the card.
      run: () => callModel({ task: 'read_message', system: req.system, user: req.user, schema: READ_SCHEMA, maxTokens: 500, timeoutMs: 15_000 }, params.fetchImpl),
    },
    (data) => parseReadResponse(data, { refs: req.refs, cutoff: params.cutoff, text: params.text, members: params.members, now: params.now ?? new Date() }),
  );
  return out.ok ? out.value : null;
}

/** Up to three suggestions, with reasons, for my own tasks. */
export async function suggestPriorities(params: {
  workspaceId: string; // the person's own workspace pays
  idempotencyKey: string;
  tasks: readonly MyTask[];
  now?: Date;
  fetchImpl?: Fetch;
}): Promise<{ ok: true; suggestions: Suggestion[] } | { ok: false; reason: AiRefusal }> {
  const now = params.now ?? new Date();
  const req = buildPrioritizeRequest(params.tasks, now);
  if (req.count === 0) return { ok: true, suggestions: [] };
  const out = await answerOnce(
    {
      workspaceId: params.workspaceId,
      sourceId: `prio:${params.idempotencyKey}`,
      run: () => callModel({ task: 'prioritize', system: req.system, user: req.user, schema: PRIORITIZE_SCHEMA, maxTokens: 400 }, params.fetchImpl),
    },
    (data) => parsePrioritizeResponse(data, req.refs),
  );
  return out.ok ? { ok: true, suggestions: out.value } : out;
}

export async function summarizeTask(params: {
  workspaceId: string;
  idempotencyKey: string;
  input: Parameters<typeof buildTaskSummaryRequest>[0];
  fetchImpl?: Fetch;
}): Promise<{ ok: true; summary: string; nextStep: string | null } | { ok: false; reason: AiRefusal }> {
  const req = buildTaskSummaryRequest(params.input);
  const out = await answerOnce(
    {
      workspaceId: params.workspaceId,
      sourceId: `sum:${params.idempotencyKey}`,
      run: () => callModel({ task: 'summarize', system: req.system, user: req.user, schema: TASK_SUMMARY_SCHEMA, maxTokens: 500 }, params.fetchImpl),
    },
    parseTaskSummary,
  );
  return out.ok ? { ok: true, ...out.value } : out;
}

export async function summarizePeriod(params: {
  workspaceId: string;
  idempotencyKey: string;
  input: Parameters<typeof buildPeriodSummaryRequest>[0];
  fetchImpl?: Fetch;
}): Promise<{ ok: true; summary: string; highlights: string[] } | { ok: false; reason: AiRefusal }> {
  const req = buildPeriodSummaryRequest(params.input);
  const out = await answerOnce(
    {
      workspaceId: params.workspaceId,
      sourceId: `sum:${params.idempotencyKey}`,
      run: () => callModel({ task: 'summarize', system: req.system, user: req.user, schema: PERIOD_SUMMARY_SCHEMA, maxTokens: 700 }, params.fetchImpl),
    },
    parsePeriodSummary,
  );
  return out.ok ? { ok: true, ...out.value } : out;
}

/** What the person is told when there is no AI answer. Thai; translated where shown. */
export function refusalMessage(reason: AiRefusal): string {
  switch (reason) {
    case 'off':
      return 'AI ยังไม่เปิดใช้ในพื้นที่งานนี้';
    case 'over_daily':
      return 'วันนี้ใช้ AI ครบแล้ว · ลองใหม่พรุ่งนี้';
    case 'over_allowance':
      return 'ใช้ AI ครบตามแพ็กเกจแล้ว';
    default:
      return 'AI ไม่ตอบในตอนนี้ · ลองใหม่อีกครั้ง';
  }
}
