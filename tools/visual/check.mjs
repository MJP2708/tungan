// Every page and the two entry sheets, at the phone widths from the master
// plan: page overflow, content clipped by a parent, JS errors, native dialogs.
// Usage: node tools/visual/check.mjs   (against `next start -p 3107`)
import fs from 'node:fs';
import { launch, BASE } from './pw.mjs';
import { fixturePage } from './fixtures.mjs';

const OUT = process.env.OUT ?? '/tmp/tungan-visual';
fs.mkdirSync(OUT, { recursive: true });
const WIDTHS = [320, 360, 390, 430];
const PAGES = [
  ['home', null], ['inbox', 'LINE'], ['tasks', 'งาน'], ['reminders', 'เตือน'],
  ['calendar', 'กำหนดส่ง'], ['reports', 'ผลงาน'], ['ai', 'AI'], ['manage', 'ทีม'], ['settings', 'ตั้งค่า'],
];
const PRIMARY = new Set(['LINE', 'งาน', 'เตือน']);

function audit() {
  const vw = document.documentElement.clientWidth;
  const overflow = document.documentElement.scrollWidth - vw;
  const clipped = [];
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height || !el.textContent?.trim()) continue;
    if (el.children.length > 0 && el.tagName !== 'BUTTON') continue;
    const cs = getComputedStyle(el);
    if (cs.textOverflow === 'ellipsis' || cs.visibility === 'hidden') continue;
    let p = el.parentElement;
    while (p && p !== document.body) {
      const s = getComputedStyle(p);
      if (/(hidden|clip)/.test(s.overflowX) && s.textOverflow !== 'ellipsis') {
        const pr = p.getBoundingClientRect();
        if (r.right > pr.right + 2 && pr.width > 40) clipped.push(`${el.tagName.toLowerCase()} "${el.textContent.trim().slice(0, 16)}"`);
        break;
      }
      p = p.parentElement;
    }
  }
  return { overflow, clipped: [...new Set(clipped)].slice(0, 6) };
}

const browser = await launch();
let bad = 0;
for (const width of WIDTHS) {
  const { ctx, page, errors } = await fixturePage(browser, BASE, { width, height: 800 });
  for (const [name, label] of PAGES) {
    await page.goto(BASE + '/', { waitUntil: 'networkidle' });
    if (label) {
      if (PRIMARY.has(label)) await page.locator('nav.mobile-nav button', { hasText: label }).first().click();
      else {
        await page.getByRole('button', { name: 'เมนูทั้งหมด' }).click();
        await page.locator('.navigation-grid button', { hasText: label }).first().click();
      }
    }
    await page.waitForTimeout(350);
    const a = await page.evaluate(audit);
    await page.screenshot({ path: `${OUT}/${width}-${name}.png`, fullPage: true });
    const ok = a.overflow <= 0 && !a.clipped.length;
    if (!ok) bad += 1;
    console.log(`${ok ? 'ok ' : 'BAD'} ${width} ${name.padEnd(10)} overflow=${a.overflow} clipped=${a.clipped.join(' | ') || 0}`);
  }
  if (errors.length) { bad += 1; console.log(`BAD ${width} errors:`, [...new Set(errors)]); }
  await ctx.close();
}
await browser.close();
console.log(bad ? `${bad} problem(s)` : 'all clean', `· screenshots in ${OUT}`);
process.exit(bad ? 1 : 0);
