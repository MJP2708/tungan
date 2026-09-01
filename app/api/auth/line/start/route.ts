import { NextResponse } from 'next/server';
import { randomBytes, createHash } from 'node:crypto';
import { cookies } from 'next/headers';
import { buildAuthorizeUrl } from '@/lib/line/verify.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STATE_COOKIE = 'tungan_oauth_state';
const NONCE_COOKIE = 'tungan_oauth_nonce';
const VERIFIER_COOKIE = 'tungan_oauth_verifier';

/** Web LINE Login, for a normal browser outside LIFF. */
export async function GET(req: Request) {
  const channelId = process.env.LINE_LOGIN_CHANNEL_ID;
  if (!channelId) {
    return NextResponse.redirect(new URL('/login?error=config', req.url));
  }

  const state = randomBytes(24).toString('base64url');
  const nonce = randomBytes(24).toString('base64url');
  const codeVerifier = randomBytes(32).toString('base64url');
  const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');

  // Single-use, short-lived, httpOnly. The browser never reads these; they
  // exist so the callback can prove the response belongs to this request.
  const jar = await cookies();
  const opts = {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge: 600,
  };
  jar.set(STATE_COOKIE, state, opts);
  jar.set(NONCE_COOKIE, nonce, opts);
  jar.set(VERIFIER_COOKIE, codeVerifier, opts);

  const url = buildAuthorizeUrl({
    channelId,
    redirectUri: callbackUrl(req),
    state,
    codeChallenge,
  });
  // nonce is echoed back inside the ID token so we can bind them.
  return NextResponse.redirect(`${url}&nonce=${encodeURIComponent(nonce)}`);
}

/**
 * The redirect_uri must match a Callback URL registered in the LINE Login
 * channel character for character.
 *
 * In production that is APP_BASE_URL. In development it is derived from the
 * request, so running on localhost does not bounce the browser to the
 * deployed site — both URLs are registered in the console as separate entries.
 */
export function callbackUrl(req: Request) {
  const configured = process.env.APP_BASE_URL?.replace(/\/$/, '');
  const base =
    process.env.NODE_ENV === 'production' && configured
      ? configured
      : new URL(req.url).origin;
  return `${base}/api/auth/line/callback`;
}
