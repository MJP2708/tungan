import 'server-only';
import { jevConfigured } from './model.ts';

/**
 * Jev (TypeSafe AI), brought back 2026-10-26 for the quick judgments on a
 * tagged message: is it a task, who is it for, which day did it say. Jev is
 * a System One model — it answers typed questions with probabilities and
 * does not write text, so everything that needs words goes to the writing
 * model (lib/ai/client.ts).
 *
 * POST https://api.typesafe.ai/v1/systemone, Authorization: Bearer
 * TYPESAFE_API_KEY. One call, one answer, no retry loop. A failure is
 * reported as a failure — never read as a "no" — and the caller carries on
 * with what the rules read.
 */

const ENDPOINT = process.env.TYPESAFE_BASE_URL
  ? `${process.env.TYPESAFE_BASE_URL.replace(/\/$/, '')}/v1/systemone`
  : 'https://api.typesafe.ai/v1/systemone';
/** Jev answers in well under a second; past this nobody is helped. */
const TIMEOUT_MS = 6000;

export type JevQuestion =
  | { type: 'noul'; instructions: string; criteria?: { true: string; false: string } }
  | { type: 'choice'; instructions: string; criteria: Record<string, string | null> };

export type JevAnswer =
  | { type: 'noul'; noul: number }
  | { type: 'choice'; choice: string; confidence: number; probabilities: Record<string, number> };

export type JevAnswers = Record<string, JevAnswer>;

export type JevResult = { ok: true; answers: JevAnswers } | { ok: false; reason: 'off' | 'timeout' | 'http' | 'bad_output' };

export async function askJev(
  request: { state: unknown; questions: Record<string, JevQuestion> },
  fetchImpl: typeof fetch = fetch,
): Promise<JevResult> {
  if (!jevConfigured()) return { ok: false, reason: 'off' };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetchImpl(ENDPOINT, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${process.env.TYPESAFE_API_KEY}`,
      },
      body: JSON.stringify({ model: process.env.TYPESAFE_MODEL || 'jev-latest', ...request }),
    });
    if (!res.ok) {
      // 401 bad key, 422 our request is wrong, 429/529 busy. None is worth a
      // retry inside a webhook someone is waiting on.
      console.warn('[ai] jev refused', res.status);
      return { ok: false, reason: 'http' };
    }
    const body = (await res.json().catch(() => null)) as { answers?: JevAnswers } | null;
    return body?.answers && typeof body.answers === 'object'
      ? { ok: true, answers: body.answers }
      : { ok: false, reason: 'bad_output' };
  } catch (error) {
    return { ok: false, reason: (error as Error)?.name === 'AbortError' ? 'timeout' : 'http' };
  } finally {
    clearTimeout(timer);
  }
}
