import { NextRequest, NextResponse, after } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/index.ts';
import { lineEvent } from '@/lib/db/schema.ts';
import { verifyLineSignature } from '@/lib/line/verify.ts';
import { handleEvent, type LineEventPayload } from '@/lib/line/handle-event.ts';

// Signature verification needs node crypto's timingSafeEqual.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  // The signature covers the exact bytes LINE sent. Read the raw body FIRST:
  // parsing and re-serialising would not reproduce them, and verifying after
  // parsing means acting on unverified input.
  const raw = await req.text();
  const signature = req.headers.get('x-line-signature');

  if (!verifyLineSignature(raw, signature)) {
    // Logged on its own channel: a rejected signature is a possible attack,
    // not a bug in our processing, and the two must be told apart.
    console.warn(
      '[webhook][signature-rejected]',
      JSON.stringify({
        hasSignature: Boolean(signature),
        bytes: raw.length,
        ua: req.headers.get('user-agent') ?? '',
      }),
    );
    return NextResponse.json({ error: 'invalid signature' }, { status: 401 });
  }

  let body: { events?: LineEventPayload[] };
  try {
    body = JSON.parse(raw);
  } catch {
    console.error('[webhook][processing-error] body was not JSON');
    // Still a 200: LINE retries non-2xx, and retrying will not fix bad JSON.
    return NextResponse.json({ ok: true });
  }

  const events = body.events ?? [];

  // Work that must outlive the response.
  //
  // The previous version used a bare `void promise` guarded by a
  // `globalThis.waitUntil` check that only exists on Cloudflare Workers. On
  // Vercel the function is frozen the moment the response is returned, so the
  // work was cut off mid-way: the event row landed and the follow-up write
  // silently did not. `after()` is the supported way to keep it alive.
  after(async () => {
    for (const event of events) {
      try {
        await handleEvent(event);
      } catch (error) {
        console.error(
          '[webhook][processing-error]',
          event.type,
          (error as Error).message,
        );
        if (event.webhookEventId) {
          await db()
            .update(lineEvent)
            .set({ processingError: String((error as Error).message).slice(0, 500) })
            .where(eq(lineEvent.webhookEventId, event.webhookEventId))
            .catch(() => {});
        }
      }
    }
  });

  // Always 200 once the signature is good. A non-200 makes LINE retry, and
  // retries are how duplicate tasks appear.
  return NextResponse.json({ ok: true });
}
