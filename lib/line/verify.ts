import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';

const LINE_VERIFY_ENDPOINT = 'https://api.line.me/oauth2/v2.1/verify';
const LINE_TOKEN_ENDPOINT = 'https://api.line.me/oauth2/v2.1/token';
const LINE_AUTHORIZE_ENDPOINT = 'https://access.line.me/oauth2/v2.1/authorize';

export type VerifiedLineIdentity = {
  /** The only value that counts as identity. */
  lineUserId: string;
  displayName: string;
  pictureUrl?: string;
  email?: string;
};

/**
 * Verify a LIFF/Login ID token with LINE.
 *
 * We send the token to LINE's verify endpoint together with our channel id, so
 * LINE checks the signature, the expiry, and that the token was actually
 * issued for *our* channel. A token minted for another channel would otherwise
 * be a valid JWT and would sail past a naive local decode.
 *
 * The browser's `liff.getProfile()` result is never accepted as identity: it
 * is ordinary JSON that any client can fabricate.
 */
export async function verifyLineIdToken(
  idToken: string,
  options: { channelId?: string; nonce?: string; fetchImpl?: typeof fetch } = {},
): Promise<VerifiedLineIdentity> {
  const channelId = options.channelId ?? process.env.LINE_LOGIN_CHANNEL_ID;
  if (!channelId) throw new Error('LINE_LOGIN_CHANNEL_ID is not configured');
  if (!idToken) throw new Error('missing id token');

  const body = new URLSearchParams({ id_token: idToken, client_id: channelId });
  if (options.nonce) body.set('nonce', options.nonce);

  const doFetch = options.fetchImpl ?? fetch;
  const res = await doFetch(LINE_VERIFY_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!res.ok) {
    // Do not echo LINE's body to the client: it can contain token fragments.
    throw new Error(`LINE rejected the id token (${res.status})`);
  }
  const claims = (await res.json()) as {
    sub?: string;
    aud?: string;
    exp?: number;
    name?: string;
    picture?: string;
    email?: string;
  };

  if (!claims.sub) throw new Error('id token has no subject');
  // LINE already checked `aud`, but re-check rather than assume.
  if (claims.aud && claims.aud !== channelId) {
    throw new Error('id token was issued for a different channel');
  }
  if (claims.exp && claims.exp * 1000 < Date.now()) {
    throw new Error('id token has expired');
  }

  return {
    lineUserId: claims.sub,
    displayName: claims.name ?? '',
    pictureUrl: claims.picture,
    email: claims.email,
  };
}

/**
 * Verify the `x-line-signature` header over the RAW request body.
 *
 * Must run before any parsing: the signature covers the exact bytes LINE sent,
 * and re-serialising parsed JSON will not reproduce them. Comparison is
 * timing-safe.
 */
export function verifyLineSignature(
  rawBody: string,
  signature: string | null,
  channelSecret: string | undefined = process.env.LINE_MESSAGING_CHANNEL_SECRET,
): boolean {
  if (!signature || !channelSecret) return false;
  const expected = createHmac('sha256', channelSecret).update(rawBody, 'utf8').digest();
  let provided: Buffer;
  try {
    provided = Buffer.from(signature, 'base64');
  } catch {
    return false;
  }
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(provided, expected);
}

/** Authorization URL for the non-LIFF web login, with PKCE. */
export function buildAuthorizeUrl(params: {
  channelId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
}) {
  const url = new URL(LINE_AUTHORIZE_ENDPOINT);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', params.channelId);
  url.searchParams.set('redirect_uri', params.redirectUri);
  url.searchParams.set('state', params.state);
  url.searchParams.set('scope', 'openid profile');
  url.searchParams.set('code_challenge', params.codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  return url.toString();
}

/** Exchange an authorization code for tokens. Channel secret stays server-side. */
export async function exchangeCode(params: {
  code: string;
  redirectUri: string;
  codeVerifier: string;
  channelId?: string;
  channelSecret?: string;
  fetchImpl?: typeof fetch;
}): Promise<{ idToken: string }> {
  const channelId = params.channelId ?? process.env.LINE_LOGIN_CHANNEL_ID;
  const channelSecret = params.channelSecret ?? process.env.LINE_LOGIN_CHANNEL_SECRET;
  if (!channelId || !channelSecret) throw new Error('LINE Login channel is not configured');

  const doFetch = params.fetchImpl ?? fetch;
  const res = await doFetch(LINE_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: params.code,
      redirect_uri: params.redirectUri,
      client_id: channelId,
      client_secret: channelSecret,
      code_verifier: params.codeVerifier,
    }).toString(),
  });
  if (!res.ok) throw new Error(`token exchange failed (${res.status})`);
  const body = (await res.json()) as { id_token?: string };
  if (!body.id_token) throw new Error('token response had no id_token');
  return { idToken: body.id_token };
}
