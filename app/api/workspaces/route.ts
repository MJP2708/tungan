import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/index.ts';
import { workspace, workspaceMember } from '@/lib/db/schema.ts';
import { requireSession } from '@/lib/auth/session.ts';
import { errorResponse, withIdempotency } from '@/lib/api/handler.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const user = await requireSession();
    // Scoped by membership, never by a client-supplied id.
    const rows = await db()
      .select({
        id: workspace.id,
        name: workspace.name,
        role: workspaceMember.role,
        cutoff: workspace.cutoff,
        quietHoursStart: workspace.quietHoursStart,
        quietHoursEnd: workspace.quietHoursEnd,
      })
      .from(workspaceMember)
      .innerJoin(workspace, eq(workspace.id, workspaceMember.workspaceId))
      .where(eq(workspaceMember.userId, user.userId));
    return NextResponse.json({ workspaces: rows });
  } catch (error) {
    return errorResponse(error);
  }
}

/** Create a workspace. The creator owns it. */
export async function POST(req: Request) {
  try {
    const user = await requireSession();
    const body = await req.json().catch(() => ({}));
    const name = String(body.name ?? '').trim();
    if (!name) return NextResponse.json({ error: 'ใส่ชื่อพื้นที่งานก่อน' }, { status: 400 });

    // A double tap used to create two workspaces with the same name, which
    // then look identical in the switcher and split the team's work between
    // them without anyone noticing which is which.
    //
    // Keyed on the user rather than a workspace, since there is no workspace
    // to belong to yet.
    const { result, replayedId } = await withIdempotency(
      {
        key: req.headers.get('idempotency-key'),
        workspaceId: user.userId,
        route: 'POST /api/workspaces',
      },
      async () => {
        const id = crypto.randomUUID();
        await db().insert(workspace).values({ id, name });
        await db().insert(workspaceMember).values({
          workspaceId: id,
          userId: user.userId,
          role: 'owner',
          nickname: user.displayName,
        });
        return { id, name };
      },
    );
    if (!result) {
      return NextResponse.json({ id: replayedId, name, replayed: true });
    }
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
