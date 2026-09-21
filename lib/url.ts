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

/**
 * Hosts a submitted link must never make the server fetch.
 *
 * Covers loopback, RFC 1918, link-local, carrier-grade NAT and IPv6
 * local ranges. The WHATWG URL parser has already normalised numeric forms
 * such as http://2130706433/ to dotted IPv4 by the time this sees them.
 */
export function isPrivateHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.internal') || h.endsWith('.local')) {
    return true;
  }
  const v4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return (
      a === 0 || a === 10 || a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127)
    );
  }
  if (h.includes(':')) {
    return h === '::1' || h === '::' || /^f[cd]/.test(h) || /^fe[89ab]/.test(h) || h.startsWith('::ffff:');
  }
  return false;
}
