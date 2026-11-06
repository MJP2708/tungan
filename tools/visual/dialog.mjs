// Version 18 dialog fix, checked on the production build (CLAUDE.md): on a
// phone the task-entry dialog has no transform or translate and fits the
// visible viewport; on desktop it is centred by its own class.
// Usage: node tools/visual/dialog.mjs  (against `next start -p 3107`)
import { launch, BASE } from './pw.mjs';
import { fixturePage } from './fixtures.mjs';
const browser = await launch(); let bad = 0;
for (const [w, h] of [[320, 640], [360, 740], [390, 844], [430, 932], [1440, 900]]) {
  const { page } = await fixturePage(browser, BASE, { width: w, height: h });
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /สร้างงาน/ }).first().click();
  const d = page.locator('.task-entry-dialog'); await d.waitFor(); await page.waitForTimeout(500);
  const r = await d.evaluate((el) => { const cs = getComputedStyle(el); const b = el.getBoundingClientRect();
    return { transform: cs.transform, translate: cs.translate, scale: cs.scale, top: b.top, bottom: b.bottom, left: b.left, right: b.right, vw: innerWidth, vh: innerHeight }; });
  const phone = w <= 760;
  const ok = phone ? (r.transform === 'none' && (r.translate === 'none' || r.translate === '0px') && r.top >= -1 && r.bottom <= r.vh + 1 && r.left >= -1 && r.right <= r.vw + 1)
                   : Math.abs((r.left + r.right) / 2 - r.vw / 2) < 2 && r.top >= 0 && r.bottom <= r.vh;
  if (!ok) bad++;
  console.log(ok ? 'ok ' : 'BAD', w, JSON.stringify(r));
}
await browser.close(); console.log(bad ? `${bad} bad` : 'dialog clean'); process.exit(bad ? 1 : 0);
