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
  } catch {
    const prior = await db()
      .select({ resultId: idempotencyKey.resultId })
      .from(idempotencyKey)
      .where(eq(idempotencyKey.key, params.key))
      .limit(1);
    return { result: null, replayedId: prior[0]?.resultId ?? null };
  }

  const result = await run();
  if (result?.id) {
    await db()
      .update(idempotencyKey)
      .set({ resultId: result.id })
      .where(eq(idempotencyKey.key, params.key));
  }
  return { result, replayedId: null };
}
