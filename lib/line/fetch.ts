import 'server-only';

/**
 * Every call to LINE's API goes through here: the channel token, and a time
 * limit. Without one, a LINE call that hangs holds the whole reminder batch
 * (or the webhook's after() work) until the function is killed.
 */
export const LINE_TIMEOUT_MS = 8000;

export function accessToken() {
  const token = process.env.LINE_MESSAGING_CHANNEL_ACCESS_TOKEN;
  if (!token) throw new Error('LINE_MESSAGING_CHANNEL_ACCESS_TOKEN is not configured');
  return token;
}

export async function lineFetch(
  url: string,
  init: { method: 'GET' | 'POST'; body?: string; headers?: Record<string, string> },
  fetchImpl?: typeof fetch,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LINE_TIMEOUT_MS);
  try {
    return await (fetchImpl ?? fetch)(url, {
      method: init.method,
      headers: {
        ...(init.body ? { 'content-type': 'application/json' } : {}),
        authorization: `Bearer ${accessToken()}`,
        ...init.headers,
      },
      body: init.body,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}
