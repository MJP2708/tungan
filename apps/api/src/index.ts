// TUNGAN API — Cloudflare Worker.
//
// Deliberately separate from the Next.js app: the LINE webhook has to
// acknowledge in about a second and push work onto a Queue, and Cron Triggers
// and queue consumers are Worker-level features that cannot live behind a
// Next.js route.
//
// Nothing here trusts the browser. A session is established only by verifying
// a LINE ID token server-side (Task 3), and every route that touches workspace
// data resolves membership from the session before reading or writing.

export type Env = {
  DB: D1Database;
  REMINDERS: Queue<ReminderJob>;
  // Secrets, set with `wrangler secret put`. Never in the client bundle,
  // never behind a NEXT_PUBLIC_ or VITE_ prefix, never committed.
  LINE_LOGIN_CHANNEL_ID?: string;
  LINE_LOGIN_CHANNEL_SECRET?: string;
  LINE_MESSAGING_CHANNEL_SECRET?: string;
  LINE_MESSAGING_CHANNEL_ACCESS_TOKEN?: string;
  SESSION_SECRET?: string;
  APP_BASE_URL?: string;
};

export type ReminderJob = {
  kind: 'reminder';
  taskId: string;
  workspaceId: string;
  recipientLineUserId: string;
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });

/**
 * Verify LINE's x-line-signature over the RAW body, before any parsing.
 * Uses WebCrypto's constant-time-ish verify rather than comparing strings.
 */
async function verifyLineSignature(
  rawBody: ArrayBuffer,
  signature: string | null,
  channelSecret: string | undefined,
): Promise<boolean> {
  if (!signature || !channelSecret) return false;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(channelSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  let provided: Uint8Array;
  try {
    provided = Uint8Array.from(atob(signature), (c) => c.charCodeAt(0));
  } catch {
    return false;
  }
  return crypto.subtle.verify('HMAC', key, provided, rawBody);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/health') {
      return json({ ok: true, service: 'tungan-api' });
    }

    // Inbound LINE events. Verify first, acknowledge fast, queue the work.
    if (url.pathname === '/webhooks/line' && request.method === 'POST') {
      const raw = await request.arrayBuffer();
      const valid = await verifyLineSignature(
        raw,
        request.headers.get('x-line-signature'),
        env.LINE_MESSAGING_CHANNEL_SECRET,
      );
      if (!valid) {
        // Log nothing from the body: it may contain a customer's message.
        return json({ error: 'bad signature' }, 401);
      }
      // Task 4 lands the event store, the webhookEventId unique constraint
      // and the queue push here. Until then this only proves the signature
      // path works end to end, and still answers within LINE's window.
      return json({ ok: true });
    }

    return json({ error: 'not found' }, 404);
  },
};
