import { timingSafeEqual } from 'node:crypto';

/**
 * Does this request carry `Authorization: Bearer <CRON_SECRET>`? The
 * schedulers send it to /api/cron/reminders, and an operator sends it to
 * /api/health for the full picture.
 *
 * Header only. A ?key= fallback put the secret into URLs, and URLs end up in
 * access logs and in the scheduler's run history.
 */
export function hasCronSecret(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.get('authorization') ?? '';
  const provided = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (provided.length !== secret.length) return false;
  return timingSafeEqual(Buffer.from(provided), Buffer.from(secret));
}
