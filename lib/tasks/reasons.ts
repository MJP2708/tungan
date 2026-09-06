/**
 * Why work is waiting.
 *
 * Presets rather than free text, so blocked work is countable and sortable by
 * cause — and so reporting a problem never requires typing. Free text stays
 * optional alongside: forcing prose is how a mandatory field turns into "-"
 * and stops meaning anything.
 *
 * Deliberately not in transitions.ts. That module is server-only, and these
 * are product vocabulary the LINE buttons and the app both need. A pure
 * constant behind a server-only import cannot be rendered or tested.
 */
export const BLOCKED_REASONS = ['รอลูกค้า', 'รอของ', 'รอคนอื่น', 'อื่นๆ'] as const;

export type BlockedReason = (typeof BLOCKED_REASONS)[number];

export function isBlockedReason(value: unknown): value is BlockedReason {
  return BLOCKED_REASONS.includes(value as BlockedReason);
}
