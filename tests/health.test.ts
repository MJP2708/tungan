// P2-4 (2026-11-06): /api/health tells the public only whether it is ready.
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.CRON_SECRET = 'health-test-secret';
delete process.env.DATABASE_URL;

test('without the cron secret: ready, and nothing about activity', async () => {
  const { healthReport } = await import('../lib/health.ts');
  assert.deepEqual(Object.keys((await healthReport(false)).body), ['ready']);
});

test('with it: the full picture', async () => {
  const { healthReport } = await import('../lib/health.ts');
  const { body } = await healthReport(true);
  for (const key of ['ready', 'env', 'database', 'remindersLastSentAt', 'webhookUnprocessed', 'oaQuotaUsed']) {
    assert.ok(key in body, key);
  }
});

test('only the exact secret, as a bearer header, counts', async () => {
  const { hasCronSecret } = await import('../lib/auth/cron-secret.ts');
  const req = (auth?: string) => new Request('https://x.test/api/health', auth ? { headers: { authorization: auth } } : {});
  assert.equal(hasCronSecret(req('Bearer health-test-secret')), true);
  assert.equal(hasCronSecret(req('Bearer health-test-secreT')), false);
  assert.equal(hasCronSecret(req('health-test-secret')), false);
  assert.equal(hasCronSecret(req()), false);
});
