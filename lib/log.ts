/**
 * What may go into a log line or a stored error (2026-11-06).
 *
 * Logs outlive the 7-day rule for message text, and anyone with access to
 * the Vercel dashboard reads them. Drizzle wraps a database error as
 * "Failed query: <sql> params: <values>", and those values are message
 * text, titles, names and LINE ids. So an error is reduced to its Postgres
 * code and a short reason before it is printed or stored, and a LINE id is
 * shortened to something that tells two apart without naming anyone.
 */

const MAX = 200;

export function safeErrorMessage(error: unknown): string {
  const code = pgCode(error);
  let message = '';
  for (let current: unknown = error, depth = 0; current && depth < 4; depth += 1) {
    const text = (current as { message?: unknown }).message;
    // Drizzle's own wrapper carries the query and its values; the cause
    // underneath carries the driver's reason. Prefer the reason.
    if (typeof text === 'string' && !text.startsWith('Failed query')) {
      message = text;
      break;
    }
    current = (current as { cause?: unknown }).cause;
  }
  if (!message) message = error instanceof Error ? error.name : typeof error === 'string' ? error : 'error';
  // A driver reason can still quote a value ("Key (x)=(...) already exists").
  message = message
    .replace(/params:[\s\S]*$/i, '')
    .replace(/Failed query:[\s\S]*$/i, 'query failed')
    .replace(/=\([^)]*\)/g, '=(…)')
    .trim();
  return `${code ? `[${code}] ` : ''}${message}`.slice(0, MAX);
}

function pgCode(error: unknown): string | null {
  for (let current: unknown = error, depth = 0; current && depth < 4; depth += 1) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) return code;
    current = (current as { cause?: unknown }).cause;
  }
  return null;
}

/** "U1234…abcd": enough to tell two people or groups apart in a log. */
export function maskLineId(id: string | null | undefined): string {
  if (!id) return '-';
  return id.length <= 9 ? `${id.slice(0, 1)}…` : `${id.slice(0, 5)}…${id.slice(-4)}`;
}
