import test from 'node:test';
import assert from 'node:assert/strict';
import { isSafeHttpUrl } from '../lib/url.ts';

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
