import { NextRequest, NextResponse } from 'next/server';
import { verifyLineIdToken } from '@/lib/line/verify.ts';
import { createSession } from '@/lib/auth/session.ts';
import { syncGroupMemberships, upsertLineUserOnSignIn } from '@/lib/auth/membership.ts';
import { safeErrorMessage } from '@/lib/log.ts';

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
    console.warn('[auth] id token rejected:', safeErrorMessage(error));
    return NextResponse.json({ error: 'ยืนยันตัวตนกับ LINE ไม่สำเร็จ' }, { status: 401 });
  }

  const userId = await upsertLineUserOnSignIn(identity);

  await syncGroupMemberships(userId);
  await createSession(userId);
  return NextResponse.json({ ok: true });
}
