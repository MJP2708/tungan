// P0-4 (2026-11-06): no call to LINE may hang. A push that never answers used
// to hold the whole reminder batch until the function was killed.
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.LINE_MESSAGING_CHANNEL_ACCESS_TOKEN ??= 'test-token';

test('a LINE call that never answers is cut off', async () => {
  const { lineFetch, LINE_TIMEOUT_MS } = await import('../lib/line/fetch.ts');
  assert.ok(LINE_TIMEOUT_MS <= 10_000, 'well inside the 60s function limit');
  let aborted = false;
  const hang = ((_url: string, init: { signal: AbortSignal }) =>
    new Promise((_, reject) => {
      init.signal.addEventListener('abort', () => {
        aborted = true;
        reject(new Error('aborted'));
      });
    })) as unknown as typeof fetch;
  const started = Date.now();
  test.mock.timers.enable({ apis: ['setTimeout'] });
  const call = lineFetch('https://api.line.me/v2/bot/message/push', { method: 'POST', body: '{}' }, hang);
  test.mock.timers.tick(LINE_TIMEOUT_MS);
  await assert.rejects(call, /aborted/);
  test.mock.timers.reset();
  assert.ok(aborted);
  assert.ok(Date.now() - started < 1000, 'without actually waiting');
});

test('every call carries the channel token, and a retry key when given', async () => {
  const { lineFetch } = await import('../lib/line/fetch.ts');
  let seen: Record<string, string> = {};
  const record = (async (_url: string, init: { headers: Record<string, string> }) => {
    seen = init.headers;
    return new Response('{}');
  }) as unknown as typeof fetch;
  await lineFetch('https://api.line.me/x', { method: 'POST', body: '{}', headers: { 'X-Line-Retry-Key': 'k' } }, record);
  assert.equal(seen.authorization, 'Bearer test-token');
  assert.equal(seen['X-Line-Retry-Key'], 'k');
});

test('no module calls LINE without the time limit', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      if (fs.statSync(full).isDirectory()) walk(full);
      else if (/\.tsx?$/.test(name) && full !== path.join('lib', 'line', 'fetch.ts')) {
        const src = fs.readFileSync(full, 'utf8');
        // Login calls set their own signal; everything else uses lineFetch.
        if (/api\.line\.me/.test(src) && /\bfetch\(|doFetch\(/.test(src) && !/AbortSignal\.timeout/.test(src)) offenders.push(full);
      }
    }
  };
  walk('lib');
  walk('app');
  assert.deepEqual(offenders, []);
});
