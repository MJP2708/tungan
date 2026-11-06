// P1-6 (2026-11-06): every response carries the security headers, and the
// CSP lets through what LIFF actually loads (read from the SDK).
import test from 'node:test';
import assert from 'node:assert/strict';
import config, { contentSecurityPolicy, CSP_ENFORCE } from '../next.config.ts';

test('every path gets the headers', async () => {
  const rules = await config.headers!();
  const all = rules.find((r) => r.source === '/(.*)');
  assert.ok(all, 'one rule for every path');
  const names = all.headers.map((h) => h.key);
  for (const name of ['Strict-Transport-Security', 'X-Content-Type-Options', 'Referrer-Policy', 'Permissions-Policy']) {
    assert.ok(names.includes(name), name);
  }
  // Report-only until it has been used inside LINE on a phone.
  assert.ok(names.includes(CSP_ENFORCE ? 'Content-Security-Policy' : 'Content-Security-Policy-Report-Only'));
});

test('the policy allows what LIFF loads, and nothing frames the app', () => {
  for (const host of ['https://static.line-scdn.net', 'https://api.line.me', 'https://*.line-scdn.net', 'https://uts-front.line-apps.com', 'https://liff.line.me']) {
    assert.ok(contentSecurityPolicy.includes(host), host);
  }
  assert.match(contentSecurityPolicy, /frame-ancestors 'none'/);
  assert.match(contentSecurityPolicy, /object-src 'none'/);
  assert.match(contentSecurityPolicy, /report-uri \/api\/csp-report/);
});
