// Touch targets under 44×44px on each page and in the task sheet.
import { launch, BASE } from './pw.mjs';
import { fixturePage } from './fixtures.mjs';

function small() {
  const out = [];
  for (const el of document.querySelectorAll('button, a[href], [role="button"], [role="radio"], [role="switch"], input:not([type=hidden]):not([aria-hidden=true]), [role="combobox"]')) {
    // A switch draws small on purpose; what must reach 44px is the area that
    // actually takes the tap, which it extends with an ::after.
    const after = getComputedStyle(el, '::after');
    const grow = (v) => Math.abs(parseFloat(v) || 0);
    const pad = el.getAttribute('role') === 'switch'
      ? { x: grow(after.insetInlineStart), y: grow(after.insetBlockStart) }
      : { x: 0, y: 0 };
    const box = el.getBoundingClientRect();
    const r = { width: box.width + pad.x * 2, height: box.height + pad.y * 2, top: box.top, bottom: box.bottom };
    if (r.width < 4 || r.height < 4) continue; // visually hidden helpers
    if (getComputedStyle(el).visibility === 'hidden') continue;
    // Half a pixel of tolerance: a 44px control measures 43.99 after layout.
    if (r.height < 43.5 || r.width < 43.5) {
      out.push(`${(el.getAttribute('aria-label') || el.textContent || el.tagName).trim().slice(0, 20)} ${Math.round(r.width)}x${Math.round(r.height)}`);
    }
  }
  return [...new Set(out)];
}
const browser = await launch();
const { page } = await fixturePage(browser, BASE, { width: 360, height: 800 });
const views = [['home'], ['LINE'], ['งาน'], ['เตือน'], ['ตั้งค่า'], ['AI']];
for (const [label] of views) {
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  if (label === 'ตั้งค่า' || label === 'AI') {
    await page.getByRole('button', { name: 'เมนูทั้งหมด' }).click();
    await page.locator('.navigation-grid button', { hasText: label }).first().click();
  } else if (label !== 'home') {
    await page.locator('nav.mobile-nav button', { hasText: label }).first().click();
  }
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
