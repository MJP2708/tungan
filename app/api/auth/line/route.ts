import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/index.ts';
import { lineUser, workspace, workspaceMember } from '@/lib/db/schema.ts';
import { verifyLineIdToken } from '@/lib/line/verify.ts';
import { createSession } from '@/lib/auth/session.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Exchange a LIFF ID token for our own session.
 *
 * The browser sends only the ID token. It is verified with LINE, passing our
 * channel id, and the verified `sub` is the sole source of identity — a
 * profile object from liff.getProfile() is ordinary JSON and is never trusted.
 */
export async function POST(req: NextRequest) {
  let idToken: string | undefined;
  try {
    ({ idToken } = await req.json());
  } catch {
    return NextResponse.json({ error: 'ต้องส่ง idToken' }, { status: 400 });
  }
  if (!idToken) return NextResponse.json({ error: 'ต้องส่ง idToken' }, { status: 400 });

  let identity;
  try {
    identity = await verifyLineIdToken(idToken);
  } catch (error) {
    console.warn('[auth] id token rejected:', (error as Error).message);
    return NextResponse.json({ error: 'ยืนยันตัวตนกับ LINE ไม่สำเร็จ' }, { status: 401 });
  }

  const existing = await db()
    .select({ id: lineUser.id })
    .from(lineUser)
    .where(eq(lineUser.lineUserId, identity.lineUserId))
    .limit(1);

  let userId = existing[0]?.id;
  if (!userId) {
    userId = crypto.randomUUID();
    await db().insert(lineUser).values({
      id: userId,
      lineUserId: identity.lineUserId,
      displayName: identity.displayName,
      pictureUrl: identity.pictureUrl,
    });
    // A brand-new account starts with its own empty personal workspace.
    // Prototype localStorage is never imported into a real account.
    const workspaceId = crypto.randomUUID();
    await db().insert(workspace).values({ id: workspaceId, name: 'งานของฉัน' });
    await db().insert(workspaceMember).values({
      workspaceId,
      userId,
      role: 'owner',
      nickname: identity.displayName,
    });
  } else {
    await db()
      .update(lineUser)
      .set({ displayName: identity.displayName, pictureUrl: identity.pictureUrl, updatedAt: new Date() })
      .where(eq(lineUser.id, userId));
  }

  await createSession(userId);
  return NextResponse.json({ ok: true });
}
