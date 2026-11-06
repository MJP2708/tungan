// P2-3 (2026-11-06): a submitted evidence link never makes the server fetch
// its own network — not by address, and not by a name pointing at one.
import test from 'node:test';
import assert from 'node:assert/strict';
import { checkEvidenceLink } from '../lib/evidence/check-link.ts';

function fakeFetch() {
  const calls: string[] = [];
  const impl = (async (url: string) => {
    calls.push(String(url));
    return { status: 200 };
  }) as unknown as typeof fetch;
  return { calls, impl };
}
const resolvesTo = (...addresses: string[]) => async () => addresses.map((address) => ({ address }));

test('a name that points at a private address is refused before any request', async () => {
  const { calls, impl } = fakeFetch();
  const res = await checkEvidenceLink('https://127.0.0.1.nip.io/admin', { fetchImpl: impl, lookupImpl: resolvesTo('127.0.0.1') });
  assert.equal(res.ok, false);
  assert.equal(calls.length, 0);
});

test('one private address among public ones is enough to refuse', async () => {
  const { calls, impl } = fakeFetch();
  const res = await checkEvidenceLink('https://mixed.example/x', {
    fetchImpl: impl,
    lookupImpl: resolvesTo('93.184.216.34', '10.0.0.5'),
  });
  assert.equal(res.ok, false);
  assert.equal(calls.length, 0);
});

test('IPv6 loopback and mapped addresses count as private', async () => {
  for (const addr of ['::1', '::ffff:192.168.1.1', 'fd00::1']) {
    const { calls, impl } = fakeFetch();
    const res = await checkEvidenceLink('https://v6.example/', { fetchImpl: impl, lookupImpl: resolvesTo(addr) });
    assert.equal(res.ok, false, addr);
    assert.equal(calls.length, 0, addr);
  }
});

test('a public name is checked as before', async () => {
  const { calls, impl } = fakeFetch();
  const res = await checkEvidenceLink('https://drive.google.com/file/d/x', { fetchImpl: impl, lookupImpl: resolvesTo('142.250.0.1') });
  assert.equal(res.ok, true);
  assert.equal(calls.length, 1);
});

test('a literal private address is still refused without a lookup', async () => {
  const { calls, impl } = fakeFetch();
  const res = await checkEvidenceLink('http://192.168.1.1/', {
    fetchImpl: impl,
    lookupImpl: async () => { throw new Error('should not be asked'); },
  });
  assert.equal(res.ok, false);
  assert.equal(calls.length, 0);
});
