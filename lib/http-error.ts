/**
 * An error that already knows its HTTP status.
 *
 * On its own, with no Next import behind it: it is thrown by plain modules
 * (the webhook flow, transitions, undo) that must be usable — and testable —
 * outside the bundler. Anything importing it through lib/auth/session.ts
 * would drag next/headers along with it.
 */
export class HttpError extends Error {
  // Assigned in the body rather than as a parameter property: Node's
  // type-stripping (used by the tests) does not support the shorthand.
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
