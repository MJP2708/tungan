/**
 * Postgres errors we act on, told apart from every other failure.
 *
 * Deliberately free of any HTTP or Next import: the allowance and other
 * plain-data code needs this, and pulling `next/server` in behind it makes
 * those modules unusable outside the bundler (and untestable).
 */

/** unique_violation (23505), however the driver wrapped it. */
export function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; current && depth < 4; depth += 1) {
    if ((current as { code?: unknown }).code === '23505') return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}
