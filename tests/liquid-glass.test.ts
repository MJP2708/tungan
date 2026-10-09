import test from 'node:test';
import assert from 'node:assert/strict';
import { liquidLevel, lensSpec, lensId, lensMap, lensStrength } from '../lib/liquid-glass.ts';

const ANDROID_LINE =
  'Mozilla/5.0 (Linux; Android 14; SM-A546E Build/UP1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/141.0.0.0 Mobile Safari/537.36 Line/15.16.0';
const IPHONE_LINE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Safari Line/15.16.0';
const IPHONE_CHROME =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0 Mobile/15E148 Safari/604.1';
const base = { supportsUrlBackdrop: true, deviceMemory: 8, cores: 8, reducedMotion: false, reducedTransparency: false };

test('LINE on a capable Android refracts', () => {
  assert.equal(liquidLevel({ ...base, userAgent: ANDROID_LINE }), 'refract');
});

test('iPhone (LINE or Chrome, both WebKit) gets frosted glass, not a broken filter', () => {
  assert.equal(liquidLevel({ ...base, userAgent: IPHONE_LINE }), 'frost');
  assert.equal(liquidLevel({ ...base, userAgent: IPHONE_CHROME }), 'frost');
});

test('a low-end phone, missing filter support, or a reduce setting gets frost', () => {
  assert.equal(liquidLevel({ ...base, userAgent: ANDROID_LINE, deviceMemory: 2 }), 'frost');
  assert.equal(liquidLevel({ ...base, userAgent: ANDROID_LINE, cores: 2 }), 'frost');
  assert.equal(liquidLevel({ ...base, userAgent: ANDROID_LINE, supportsUrlBackdrop: false }), 'frost');
  assert.equal(liquidLevel({ ...base, userAgent: ANDROID_LINE, reducedMotion: true }), 'frost');
  assert.equal(liquidLevel({ ...base, userAgent: ANDROID_LINE, reducedTransparency: true }), 'frost');
});

test('lens sizes are rounded so similar surfaces share a filter; radius is clamped', () => {
  const a = lensSpec(361, 63, 999)!;
  const b = lensSpec(359, 65, 999)!;
  assert.equal(lensId(a), lensId(b));
  assert.equal(a.r, Math.min(a.w, a.h) / 2);
  assert.equal(lensSpec(10, 60, 4), null, 'too small to bother');
});

test('the map bends only a feathered band at the rim', () => {
  const s = lensSpec(360, 64, 32)!;
  const { edge, scale } = lensStrength(s);
  assert.ok(edge >= 8 && edge <= 18 && scale > edge);
  const svg = decodeURIComponent(lensMap(s).replace('data:image/svg+xml;utf8,', ''));
  assert.match(svg, /fill="rgb\(128,128,128\)"/, 'a neutral middle');
  assert.match(svg, /width="360" height="64"/);
  assert.ok(!/<script|href="http/.test(svg), 'nothing external, nothing executable');
});
