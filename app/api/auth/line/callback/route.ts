import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { exchangeCode, verifyLineIdToken } from '@/lib/line/verify.ts';
import { createSession } from '@/lib/auth/session.ts';
import { syncGroupMemberships, upsertLineUserOnSignIn } from '@/lib/auth/membership.ts';
import { callbackUrl, NEXT_COOKIE } from '../start/route.ts';
import { safeNextPath } from '@/lib/deep-link.ts';
import { safeErrorMessage } from '@/lib/log.ts';

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
  const next = safeNextPath(jar.get(NEXT_COOKIE)?.value);
  for (const name of [STATE_COOKIE, NONCE_COOKIE, VERIFIER_COOKIE, NEXT_COOKIE]) jar.delete(name);

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
    console.warn('[auth callback]', safeErrorMessage(error));
    return backToLogin(req, 'ยืนยันตัวตนกับ LINE ไม่สำเร็จ');
  }

  // LINE has confirmed who this is; the remaining work is ours. An unguarded
  // failure here produced a blank 500 with no way to tell what broke.
  try {
    await upsertUserAndSession(identity);
  } catch (error) {
    const message = (error as Error).message ?? '';
    console.error('[auth callback] could not create the session:', safeErrorMessage(error));
    const reason = /DATABASE_URL/.test(message)
      ? 'db_not_configured'
      : /ECONNREFUSED|ENOTFOUND|timeout|terminating connection|SSL/i.test(message)
        ? 'db_unreachable'
        : 'session_failed';
    return backToLogin(req, reason);
  }
  return NextResponse.redirect(new URL(next, req.url));
}

async function upsertUserAndSession(identity: {
  lineUserId: string;
  displayName: string;
  pictureUrl?: string;
}) {
  const userId = await upsertLineUserOnSignIn(identity);
  // A group may have been connected while this person was away; joining the
  // LINE group is what grants access, so reconcile it at every sign-in.
  await syncGroupMemberships(userId);
  await createSession(userId);
}
