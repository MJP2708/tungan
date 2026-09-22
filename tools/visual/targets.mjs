// Touch targets under 44×44px on each page and in the task sheet.
import { launch, BASE } from './pw.mjs';
import { fixturePage } from './fixtures.mjs';

function small() {
  const out = [];
  for (const el of document.querySelectorAll('button, a[href], [role="button"], [role="radio"], input:not([type=hidden]):not([aria-hidden=true]), [role="combobox"]')) {
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) continue; // visually hidden helpers
    if (getComputedStyle(el).visibility === 'hidden') continue;
    if (r.height < 44 || r.width < 44) {
      out.push(`${(el.getAttribute('aria-label') || el.textContent || el.tagName).trim().slice(0, 20)} ${Math.round(r.width)}x${Math.round(r.height)}`);
    }
  }
  return [...new Set(out)];
}
const browser = await launch();
const { page } = await fixturePage(browser, BASE, { width: 360, height: 800 });
const views = [['home'], ['LINE'], ['งาน'], ['เตือน']];
for (const [label] of views) {
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  if (label !== 'home') await page.locator('nav.mobile-nav button', { hasText: label }).first().click();
  await page.waitForTimeout(300);
  console.log(label.padEnd(6), JSON.stringify(await page.evaluate(small)));
}
await page.locator('nav.mobile-nav button', { hasText: 'งาน' }).first().click();
await page.getByText('ออกแบบป้ายหน้างาน').first().click();
await page.waitForTimeout(500);
console.log('sheet ', JSON.stringify(await page.evaluate(small)));
await page.keyboard.press('Escape');
await page.goto(BASE + '/', { waitUntil: 'networkidle' });
await page.getByRole('button', { name: /สร้างงาน/ }).first().click();
await page.waitForTimeout(500);
console.log('create', JSON.stringify(await page.evaluate(small)));
await browser.close();
