import 'server-only';

/**
 * Our own model (decided 2026-10-02): a separate inference service that only
 * this app's server calls. Users never reach it; they only use ทันงาน.
 *
 * Not built yet. Until both variables exist, every AI feature is off and the
 * product runs on its rules — which is also how it must behave when the
 * service is down, out of allowance, or switched off.
 *
 *   ML_SERVICE_URL    base URL of the inference service (server-only)
 *   ML_SERVICE_TOKEN  shared secret the service checks (server-only)
 *   AI_KILL_SWITCH=1  turns every model call off, whatever else is set
 */
export function aiConfigured(): boolean {
  return (
    Boolean(process.env.ML_SERVICE_URL && process.env.ML_SERVICE_TOKEN) &&
    process.env.AI_KILL_SWITCH !== '1'
  );
}
