// Shared helpers for the real-backend end-to-end run. LOCAL Postgres only:
// it refuses any database URL that is not on localhost, so it can never be
// pointed at production by accident. See tools/e2e/README.md.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import { launch } from '../visual/pw.mjs';
const require = createRequire(new URL('../../package.json', import.meta.url));
const pg = require('pg');
export const BASE = process.env.E2E_BASE ?? 'http://localhost:3108';
const DB = process.env.E2E_DATABASE_URL ?? 'postgres://postgres:e2e@localhost:55433/tungan_e2e';
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(DB)) throw new Error('refusing: E2E_DATABASE_URL is not a local database');
export const pool = new pg.Pool({ connectionString: DB });
export const q = async (sql, args = []) => (await pool.query(sql, args)).rows;
export const OUT = process.env.OUT ?? '/tmp/tungan-e2e';
fs.mkdirSync(OUT, { recursive: true });

/** One signed-in person in their own browser (a phone by default). */
export async function person(browser, token, width = 390) {
  const ctx = await browser.newContext({
    viewport: { width, height: 844 }, deviceScaleFactor: 1, isMobile: width < 761, hasTouch: width < 761,
    locale: 'th-TH', timezoneId: 'Asia/Bangkok',
  });
  await ctx.addCookies([{ name: 'tungan_session', value: token, url: BASE }]);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('dialog', (d) => { errors.push('native dialog: ' + d.message()); void d.dismiss(); });
  page.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 500) errors.push(`${r.status()} ${r.request().method()} ${new URL(r.url()).pathname}`); });
  return { ctx, page, errors };
}

const results = [];
/** Run one check; on failure keep going and save a screenshot. */
export async function step(name, page, fn) {
  try {
    await fn();
    results.push(['ok', name]);
    console.log('ok  ', name);
  } catch (e) {
    results.push(['FAIL', name, e.message.split('\n')[0]]);
    console.log('FAIL', name, '—', e.message.split('\n')[0]);
    if (page) await page.screenshot({ path: `${OUT}/fail-${name.replace(/[^\w]+/g, '_').slice(0, 40)}.png` }).catch(() => {});
  }
}
export function summary() {
  const fails = results.filter((r) => r[0] === 'FAIL');
  console.log(`\n${results.length - fails.length}/${results.length} passed`);
  return fails.length;
}
export const expect = (cond, msg) => { if (!cond) throw new Error(msg); };
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export { launch };
