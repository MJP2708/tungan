import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/index.ts';
import { lineUser, workspace, workspaceMember } from '@/lib/db/schema.ts';
import { exchangeCode, verifyLineIdToken } from '@/lib/line/verify.ts';
import { createSession } from '@/lib/auth/session.ts';
import { callbackUrl } from '../start/route.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STATE_COOKIE = 'tungan_oauth_state';
const NONCE_COOKIE = 'tungan_oauth_nonce';
const VERIFIER_COOKIE = 'tungan_oauth_verifier';

function backToLogin(req: Request, message: string) {
  const url = new URL('/login', req.url);
  url.searchParams.set('error', message);
  return NextResponse.redirect(url);
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const jar = await cookies();

  // Whatever happens next, these are single use.
  const expectedState = jar.get(STATE_COOKIE)?.value;
  const expectedNonce = jar.get(NONCE_COOKIE)?.value;
  const codeVerifier = jar.get(VERIFIER_COOKIE)?.value;
  for (const name of [STATE_COOKIE, NONCE_COOKIE, VERIFIER_COOKIE]) jar.delete(name);

  // The user pressed cancel, or LINE returned an error.
  const lineError = url.searchParams.get('error');
  if (lineError) {
    return backToLogin(
      req,
      lineError === 'access_denied' ? 'ยกเลิกการเข้าสู่ระบบ' : 'LINE ปฏิเสธคำขอเข้าสู่ระบบ',
    );
  }

  const state = url.searchParams.get('state');
  if (!state || !expectedState || state !== expectedState) {
    // Cleared above, so a replayed callback cannot succeed either.
    return backToLogin(req, 'คำขอเข้าสู่ระบบไม่ถูกต้อง กรุณาลองใหม่');
  }

  const code = url.searchParams.get('code');
  if (!code || !codeVerifier) return backToLogin(req, 'ไม่ได้รับรหัสจาก LINE');

  let identity;
  try {
    const { idToken } = await exchangeCode({
      code,
      redirectUri: callbackUrl(req),
      codeVerifier,
    });
    identity = await verifyLineIdToken(idToken, { nonce: expectedNonce });
  } catch (error) {
    console.warn('[auth callback]', (error as Error).message);
    return backToLogin(req, 'ยืนยันตัวตนกับ LINE ไม่สำเร็จ');
  }

  await upsertUserAndSession(identity);
  return NextResponse.redirect(new URL('/', req.url));
}

async function upsertUserAndSession(identity: {
  lineUserId: string;
  displayName: string;
  pictureUrl?: string;
}) {
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
    // First run: one personal workspace so the app is never empty-broken.
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
      .set({
        displayName: identity.displayName,
        pictureUrl: identity.pictureUrl,
        updatedAt: new Date(),
      })
      .where(eq(lineUser.id, userId));
  }
  await createSession(userId);
}
