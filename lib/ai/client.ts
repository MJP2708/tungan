import 'server-only';
import { aiConfigured } from './model.ts';

/**
 * The one door to the model (2026-10-25).
 *
 * The inference service is our own open Thai model (e.g. Typhoon or Qwen)
 * served by an OpenAI-compatible server such as vLLM, reached only from this
 * server at ML_SERVICE_URL with ML_SERVICE_TOKEN. It does inference and
 * nothing else: every prompt, rule and permission check stays in this app.
 *
 * One call, one structured answer: the reply must be JSON matching a schema
 * (`response_format: json_schema`, which vLLM enforces while generating).
 * Anything else — no service, kill switch, timeout, HTTP error, bad JSON —
 * comes back as `{ ok: false }` and the caller carries on without AI. It never
 * throws, so no feature can break because the model is away.
 */

export type ModelCall = {
  /** Names the schema; also tells a stand-in which answer to give. */
  task: 'read_message' | 'prioritize' | 'summarize';
  system: string;
  user: string;
  schema: Record<string, unknown>;
  maxTokens?: number;
  timeoutMs?: number;
};

export type ModelResult<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; reason: 'off' | 'timeout' | 'http' | 'bad_output' };

export type Fetch = typeof fetch;

export async function callModel(call: ModelCall, fetchImpl: Fetch = fetch): Promise<ModelResult> {
  if (!aiConfigured()) return { ok: false, reason: 'off' };
  const base = String(process.env.ML_SERVICE_URL).replace(/\/$/, '');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), call.timeoutMs ?? 12_000);
  try {
    const res = await fetchImpl(`${base}/v1/chat/completions`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${process.env.ML_SERVICE_TOKEN}`,
      },
      body: JSON.stringify({
        model: process.env.ML_MODEL || 'tungan-th',
        temperature: 0,
        max_tokens: call.maxTokens ?? 600,
        messages: [
          { role: 'system', content: call.system },
          { role: 'user', content: call.user },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: { name: call.task, schema: call.schema, strict: true },
        },
      }),
    });
    if (!res.ok) return { ok: false, reason: 'http' };
    const body = (await res.json().catch(() => null)) as
      | { choices?: Array<{ message?: { content?: string } }> }
      | null;
    const content = body?.choices?.[0]?.message?.content;
    if (typeof content !== 'string') return { ok: false, reason: 'bad_output' };
    try {
      return { ok: true, data: JSON.parse(content) };
    } catch {
      return { ok: false, reason: 'bad_output' };
    }
  } catch (error) {
    return { ok: false, reason: (error as Error)?.name === 'AbortError' ? 'timeout' : 'http' };
  } finally {
    clearTimeout(timer);
  }
}
