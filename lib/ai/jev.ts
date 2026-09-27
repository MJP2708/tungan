import 'server-only';

/**
 * Jev (TypeSafe AI), used as a fallback when the rules cannot decide.
 *
 * Jev is a "System One" model: it does not write text, it answers typed
 * questions with probabilities. That is the whole reason it suits this
 * product — the AI scope forbids chat and open-ended generation, and every
 * answer here is a value we already had a place for (who, when, is this a
 * task at all) that a person still confirms.
 *
 * One call, one JSON response, no retry loop and no agent steps. Every
 * failure — no key, kill switch, timeout, 429, malformed body — returns null,
 * and the caller falls back to what the rules produced. The bot must keep
 * working when this does not.
 *
 * POST https://api.typesafe.ai/v1/systemone, Authorization: Bearer <key>.
 */

const ENDPOINT = 'https://api.typesafe.ai/v1/systemone';
const MODEL = 'jev-latest';
/** Jev answers in 70–500ms; past this, the person is waiting for nothing. */
const TIMEOUT_MS = 6000;
/** Well under Jev's 32k state limit, and a LINE message is far smaller. */
const MAX_STATE_CHARS = 4000;

export type JevQuestion =
  | { type: 'noul'; instructions: string; criteria?: { true: string; false: string } }
  | { type: 'choice'; instructions: string; criteria: Record<string, string> };

export type JevAnswer =
  | { type: 'noul'; noul: number }
  | { type: 'choice'; choice: string; confidence?: number; probabilities?: Record<string, number> };

export type JevResult = Record<string, JevAnswer>;

/** Off unless a key exists AND the kill switch is not thrown. */
export function aiConfigured(): boolean {
  return Boolean(process.env.TYPESAFE_API_KEY) && process.env.AI_KILL_SWITCH !== '1';
}

export async function askJev(
  params: { state: string; questions: Record<string, JevQuestion> },
  options: { fetchImpl?: typeof fetch } = {},
): Promise<JevResult | null> {
  const key = process.env.TYPESAFE_API_KEY;
  if (!aiConfigured() || !key) return null;
  if (!Object.keys(params.questions).length) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await (options.fetchImpl ?? fetch)(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      signal: controller.signal,
      body: JSON.stringify({
        model: MODEL,
        state: { message: params.state.slice(0, MAX_STATE_CHARS) },
        questions: params.questions,
      }),
    });
    if (!res.ok) {
      // 401 bad key, 422 our request is wrong, 429/529 busy. None of them are
      // worth retrying inside a webhook the person is waiting on.
      console.warn('[ai] jev refused', res.status);
      return null;
    }
    // Answers come back keyed by the names we chose. Some responses wrap
    // them in `answers`; accept either rather than guess.
    const body = (await res.json()) as { answers?: JevResult } & JevResult;
    const answers = body.answers ?? body;
    return answers && typeof answers === 'object' ? answers : null;
  } catch (error) {
    console.warn('[ai] jev unavailable:', (error as Error).message);
    return null;
  } finally {
    clearTimeout(timer);
  }
}
