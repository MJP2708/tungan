// Light text that no longer sits on anything dark: what a glass override
// (a translucent white fill laid over a dark chip) produces. It caught
// "ปิดงานแล้ว" turning white-on-white on 2026-10-01.
// Every screen, phone and desktop, plus the task sheet.
// Usage: node tools/visual/contrast.mjs   (against `next start -p 3107`)
import { launch, BASE } from './pw.mjs';
import { fixturePage } from './fixtures.mjs';
const PAGES = ['home','inbox','tasks','calendar','reports','reminders','ai','manage','settings'];
function scan() {
  const rgb = (s) => (s.match(/[\d.]+/g) || []).map(Number);
  const isLight = ([r, g, b]) => r > 200 && g > 200 && b > 200;
  const colourStops = () => /rgba?\((\d+), (\d+), (\d+)(?:, ([\d.]+))?\)/g;
  const hasDarkBg = (el) => {
    for (let n = el; n && n !== document.documentElement; n = n.parentElement) {
      const cs = getComputedStyle(n);
      const [r, g, b, a = 1] = rgb(cs.backgroundColor);
      if (a > 0.5) return r + g + b < 360;
      const img = cs.backgroundImage;
      if (img && img !== 'none') {
        const re = colourStops();
        let m, dark = false;
        while ((m = re.exec(img))) { const al = m[4] === undefined ? 1 : +m[4]; if (al > 0.5 && +m[1] + +m[2] + +m[3] < 240) dark = true; }
        if (dark) return true;
      }
    }
    return false;
  };
  const bad = [];
  for (const el of document.querySelectorAll('body *')) {
    if (!el.childNodes.length || ![...el.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim())) continue;
    const r = el.getBoundingClientRect(); if (!r.width || !r.height) continue;
    const cs = getComputedStyle(el); if (cs.visibility === 'hidden' || +cs.opacity === 0) continue;
    if (!isLight(rgb(cs.color))) continue;
    if (!hasDarkBg(el)) bad.push(`${el.tagName.toLowerCase()}.${[...el.classList].join('.')} "${el.textContent.trim().slice(0, 20)}"`);
  }
  return [...new Set(bad)];
}
const browser = await launch();
let total = 0;
for (const width of [390, 1280]) {
  const { ctx, page } = await fixturePage(browser, BASE, { width, height: 900 });
  for (const p of PAGES) {
    await page.goto(BASE + (p === 'home' ? '/' : `/?p=${p}`), { waitUntil: 'networkidle' });
    await page.waitForTimeout(300);
    const bad = await page.evaluate(scan);
    if (bad.length) { total += bad.length; console.log(`BAD ${width} ${p}:`, bad.join(' | ')); }
  }
  await page.goto(BASE + '/?p=tasks', { waitUntil: 'networkidle' });
  await page.locator('button').filter({ hasText: 'ใบเสนอราคา' }).first().click();
  await page.waitForTimeout(500);
  const bad = await page.evaluate(scan);
  if (bad.length) { total += bad.length; console.log(`BAD ${width} sheet:`, bad.join(' | ')); }
  await ctx.close();
}
await browser.close();
console.log(total ? `${total} unreadable` : 'no light-on-light text');
process.exit(total ? 1 : 0);
