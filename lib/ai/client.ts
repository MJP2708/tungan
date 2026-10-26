import 'server-only';
import { mlConfigured } from './model.ts';

/**
 * The one door to the writing model (2026-10-25).
 *
 * An OpenAI-compatible chat API at ML_SERVICE_URL with ML_SERVICE_TOKEN:
 * Typhoon's hosted API for now (2026-10-26), our own vLLM server later. It
 * does inference and nothing else: every prompt, rule and permission check
 * stays in this app.
 *
 * One call, one structured answer: the reply must be JSON matching a schema.
 * A server that enforces it (vLLM) is sent `response_format: json_schema`.
 * One that may not (ML_RESPONSE_FORMAT=prompt, for Typhoon's hosted API,
 * whose docs do not list response_format) gets the schema in the
 * instructions instead, and the answer is cleaned of a thinking block or a
 * code fence before it is read. Either way parse* re-checks every field.
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
  if (!mlConfigured()) return { ok: false, reason: 'off' };
  const enforced = process.env.ML_RESPONSE_FORMAT !== 'prompt';
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
          {
            role: 'system',
            content: enforced
              ? call.system
              : `${call.system}\nตอบเป็น JSON เพียงอย่างเดียว ไม่มีข้อความอื่น ตามโครงสร้างนี้: ${JSON.stringify(call.schema)}`,
          },
          { role: 'user', content: call.user },
        ],
        ...(enforced
          ? { response_format: { type: 'json_schema', json_schema: { name: call.task, schema: call.schema, strict: true } } }
          : {}),
      }),
    });
    if (!res.ok) return { ok: false, reason: 'http' };
    const body = (await res.json().catch(() => null)) as
      | { choices?: Array<{ message?: { content?: string } }> }
      | null;
    const content = body?.choices?.[0]?.message?.content;
    if (typeof content !== 'string') return { ok: false, reason: 'bad_output' };
    const data = readJson(content);
    return data === undefined ? { ok: false, reason: 'bad_output' } : { ok: true, data };
  } catch (error) {
    return { ok: false, reason: (error as Error)?.name === 'AbortError' ? 'timeout' : 'http' };
  } finally {
    clearTimeout(timer);
  }
}

/** JSON out of a model's reply: a thinking block and a ```json fence removed,
 *  then the outermost object. Undefined when there is none. */
export function readJson(content: string): unknown {
  const text = content.replace(/<think>[\s\S]*?<\/think>/g, '').replace(/```(?:json)?/g, '').trim();
  for (const candidate of [text, text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)]) {
    try {
      return JSON.parse(candidate);
    } catch {
      // try the next
    }
  }
  return undefined;
}
