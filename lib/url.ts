/**
 * Is this a link we will accept, store, and show to someone?
 *
 * The one definition. It existed four times — the submit path, the PATCH
 * route, the link checker, and the client-side entry form — and four copies of
 * a rule about which schemes are allowed is how they end up disagreeing.
 * Audit finding SEC-5.
 *
 * Deliberately not in check-link.ts, which is server-only: the entry form runs
 * in the browser and needs the same answer. A pure rule behind a server-only
 * import cannot be used where it is also needed.
 *
 * `javascript:` and `data:` are the ones that matter — both parse fine as URLs
 * and both are dangerous in an href.
 */
export function isSafeHttpUrl(value: string): boolean {
  try {
    return ['http:', 'https:'].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}
