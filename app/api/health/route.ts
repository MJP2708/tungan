import { NextResponse } from 'next/server';
import { hasCronSecret } from '@/lib/auth/cron-secret.ts';
import { healthReport } from '@/lib/health.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Readiness check for deployment: `ready` for anyone, the full picture with
 * `Authorization: Bearer <CRON_SECRET>` (lib/health.ts).
 */
export async function GET(req: Request) {
  const { status, body } = await healthReport(hasCronSecret(req));
  return NextResponse.json(body, { status });
}
