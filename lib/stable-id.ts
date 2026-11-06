import { createHash } from 'node:crypto';

/**
 * A UUID that is always the same for the same name (RFC 4122 version 5 layout
 * over SHA-1).
 *
 * Doing something twice safely needs a key both attempts agree on without
 * talking to each other: a re-run webhook event makes the same draft row ids,
 * and a re-sent push carries the same X-Line-Retry-Key, which LINE requires
 * to be a UUID.
 */
const NAMESPACE = Buffer.from('6f1b2c1e8a3d4b5e9c7f0a1b2c3d4e5f', 'hex');

export function stableUuid(name: string): string {
  const hash = createHash('sha1').update(NAMESPACE).update(name).digest();
  hash[6] = (hash[6] & 0x0f) | 0x50;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const hex = hash.subarray(0, 16).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
