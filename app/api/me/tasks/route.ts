import { NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth/session.ts';
import { errorResponse } from '@/lib/api/handler.ts';
import { myTasksFor } from '@/lib/tasks/my-work.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * งานฉัน (2026-10-17): my open tasks across every group I belong to, plus my
 * personal tasks. Scoped by the session's own membership — never a client
 * id — so it can only ever return the caller's own work.
 */
export async function GET() {
  try {
    const user = await requireSession();
    return NextResponse.json({ tasks: await myTasksFor(user.userId) });
  } catch (error) {
    return errorResponse(error);
  }
}
