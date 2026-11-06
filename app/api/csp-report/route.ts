import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Where browsers report Content-Security-Policy violations (next.config.ts).
 * Logged as [csp] with only the directive and the blocked origin — never the
 * page's query string or the reporter's address — so the Report-Only phase
 * shows what LIFF needs before the policy is enforced.
 */
export async function POST(req: Request) {
  const raw = (await req.text().catch(() => '')).slice(0, 8000);
  try {
    const body = JSON.parse(raw) as { 'csp-report'?: Record<string, unknown> };
    const r = body['csp-report'] ?? {};
    const origin = (value: unknown) => {
      try {
        return new URL(String(value)).origin;
      } catch {
        return String(value ?? '').slice(0, 40);
      }
    };
    console.warn(
      '[csp]',
      JSON.stringify({
        directive: String(r['effective-directive'] ?? r['violated-directive'] ?? '').slice(0, 60),
        blocked: origin(r['blocked-uri']),
        page: (() => {
          try {
            return new URL(String(r['document-uri'])).pathname;
          } catch {
            return '';
          }
        })(),
      }),
    );
  } catch {
    // Not a report; nothing to log.
  }
  return new NextResponse(null, { status: 204 });
}
