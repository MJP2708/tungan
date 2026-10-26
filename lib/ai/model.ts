import 'server-only';

/**
 * Which AI is set up (2026-10-26). Two providers, each optional:
 *
 *   Jev (TypeSafe)  answers typed questions — is this a task, who, which
 *                   day. Cannot write text.
 *                   TYPESAFE_API_KEY (server-only)
 *   Writing model   an OpenAI-compatible chat model for what needs words:
 *                   short titles, splitting a message, summaries, reasons.
 *                   For now Typhoon's hosted API; later our own server.
 *                   ML_SERVICE_URL + ML_SERVICE_TOKEN (+ ML_MODEL)
 *
 *   AI_KILL_SWITCH=1 turns every model call off, whatever else is set.
 *
 * With neither, every AI feature is off and the product runs on its rules —
 * which is also how it must behave when a service is down, out of
 * allowance, or switched off.
 */
const killed = () => process.env.AI_KILL_SWITCH === '1';

/** The writing model (Typhoon) can be called. */
export function mlConfigured(): boolean {
  return Boolean(process.env.ML_SERVICE_URL && process.env.ML_SERVICE_TOKEN) && !killed();
}

/** Jev can be called. */
export function jevConfigured(): boolean {
  return Boolean(process.env.TYPESAFE_API_KEY) && !killed();
}

/** Some AI is available at all. */
export function aiConfigured(): boolean {
  return mlConfigured() || jevConfigured();
}
