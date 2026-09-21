import 'server-only';
import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { idempotencyKey } from '../db/schema.ts';
import { HttpError } from '../auth/session.ts';

/** Turn a thrown HttpError into the right status instead of a 500. */
export function errorResponse(error: unknown) {
  if (error instanceof HttpError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  console.error('[api]', error);
  return NextResponse.json({ error: 'เกิดข้อผิดพลาดในระบบ' }, { status: 500 });
}

/**
 * Make a mutating route safe to retry.
 *
 * The caller sends an Idempotency-Key. The key is claimed with an insert, so
 * two concurrent retries race on the primary key and exactly one proceeds; the
 * loser returns the first call's result instead of performing the work twice.
 */
export async function withIdempotency<T extends { id?: string }>(
  params: { key: string | null; workspaceId: string; route: string },
  run: () => Promise<T>,
): Promise<{ result: T | null; replayedId: string | null }> {
  if (!params.key) {
    return { result: await run(), replayedId: null };
  }

  try {
    await db().insert(idempotencyKey).values({
      key: params.key,
      workspaceId: params.workspaceId,
      route: params.route,
    });
  } catch (error) {
    // Only "this key is already taken" means a retry. Any other failure (the
    // database unreachable, say) must surface as an error, not be reported
    // to the client as a successful replay of work that never happened.
    if (!isUniqueViolation(error)) throw error;
    const prior = await db()
      .select({ resultId: idempotencyKey.resultId })
      .from(idempotencyKey)
      .where(eq(idempotencyKey.key, params.key))
      .limit(1);
    return { result: null, replayedId: prior[0]?.resultId ?? null };
  }

  let result: T;
  try {
    result = await run();
  } catch (error) {
    // The work failed, so the key must not stay claimed. Otherwise every
    // retry under it is answered "already done" and the person's task is
    // silently lost — the exact opposite of "safe to retry".
    await db()
      .delete(idempotencyKey)
      .where(eq(idempotencyKey.key, params.key))
      .catch(() => {});
    throw error;
  }
  if (result?.id) {
    await db()
      .update(idempotencyKey)
      .set({ resultId: result.id })
      .where(eq(idempotencyKey.key, params.key));
  }
  return { result, replayedId: null };
}

/** Postgres unique_violation (23505), however the driver wraps it. */
export function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; current && depth < 4; depth += 1) {
    if ((current as { code?: unknown }).code === '23505') return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}
