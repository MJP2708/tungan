import test from 'node:test';
import assert from 'node:assert/strict';
import { isPrivateHost, isSafeHttpUrl } from '../lib/url.ts';

/**
 * Which links we will store and render.
 *
 * This rule used to exist in four places. These tests pin the answer so that
 * consolidating it did not quietly change which schemes get through.
 */

test('ordinary links are accepted', () => {
  for (const url of [
    'https://drive.google.com/file/d/abc/view',
    'http://example.com',
    'https://example.com:8443/path?q=1#x',
    'https://xn--12c4bxa.com/งาน',
  ]) {
    assert.equal(isSafeHttpUrl(url), true, url);
  }
});

test('schemes that are dangerous in an href are refused', () => {
  // Both of these parse perfectly well as URLs, which is exactly why the
  // check has to be an allowlist of schemes rather than a parse attempt.
  for (const url of [
    'javascript:alert(1)',
    // eslint-disable-next-line no-script-url
    'JavaScript:alert(1)',
    'data:text/html;base64,PHNjcmlwdD4=',
    'file:///etc/passwd',
    'ftp://example.com/x',
    'vbscript:msgbox(1)',
  ]) {
    assert.equal(isSafeHttpUrl(url), false, url);
  }
});

test('things that are not URLs at all are refused, not thrown on', () => {
  for (const url of ['', '   ', 'example.com', 'not a url', '//example.com', 'http://']) {
    assert.equal(isSafeHttpUrl(url), false, JSON.stringify(url));
  }
});

test('the link checker never fetches private or internal hosts', () => {
  for (const h of ['localhost', '127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '[::1]', 'fd00::1', 'fe80::1', 'metadata.internal']) {
    assert.equal(isPrivateHost(h), true, h);
  }
  for (const h of ['drive.google.com', '172.32.0.1', '8.8.8.8', 'example.com']) {
    assert.equal(isPrivateHost(h), false, h);
  }
});
