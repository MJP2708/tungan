// The AI panels (2026-10-25), answered from fixtures: press each one at every
// phone width and check the answer fits — no overflow, nothing clipped, no
// JS error — and save a screenshot. Run with AI=1 (and LOCALE=en-US).
import { launch, BASE } from './pw.mjs';
import { fixturePage } from './fixtures.mjs';

const OUT = process.env.OUT ?? '/tmp/tungan-visual';
const overflow = () => {
  const doc = document.documentElement;
  const wide = doc.scrollWidth - doc.clientWidth;
  const clipped = [...document.querySelectorAll('.ai-panel, .ai-panel *, .line-ai-note, .line-ai-note *, .ai-training, .ai-training *')]
    .filter((el) => el.scrollWidth - el.clientWidth > 1 && getComputedStyle(el).overflowX !== 'visible')
    .map((el) => el.className || el.tagName);
  return { wide, clipped };
};
const browser = await launch();
let bad = 0;
for (const width of [320, 360, 390, 430]) {
  const { page, errors, ctx } = await fixturePage(browser, BASE, { width, height: 900 });
  const steps = [
    ['mine', async () => { await page.getByRole('button', { name: /ควรทำอะไรก่อน|What should I do first/ }).click(); await page.locator('.ai-picks li').first().waitFor(); }],
    ['reports', async () => { await page.getByRole('button', { name: /สรุปสัปดาห์นี้|Summarise this week/ }).click(); await page.locator('.ai-highlights').waitFor(); }],
    ['inbox', async () => { await page.locator('.line-ai-note').first().waitFor(); }],
    ['ai', async () => { await page.locator('.ai-training').waitFor(); }],
    ['tasks', async () => {
      await page.locator('.task-row, [data-task-id]').first().click();
      await page.getByRole('button', { name: /สรุปด้วย AI|Summarise with AI/ }).click();
      await page.locator('.ai-panel-inline .ai-panel-text').first().waitFor();
    }],
  ];
  for (const [p, run] of steps) {
    try {
      await page.goto(`${BASE}/?p=${p}`, { waitUntil: 'networkidle' });
      await run();
      const o = await page.evaluate(overflow);
      const ok = o.wide <= 0 && !o.clipped.length && !errors.length;
      if (!ok) bad += 1;
      console.log(`${ok ? 'ok ' : 'BAD'} ${width} ${p.padEnd(8)} overflow=${o.wide} clipped=${JSON.stringify(o.clipped)} ${errors.join(' | ')}`);
      await page.screenshot({ path: `${OUT}/ai-${p}-${width}.png`, fullPage: false });
    } catch (e) {
      bad += 1;
      console.log(`BAD ${width} ${p.padEnd(8)} ${e.message.split('\n')[0]}`);
      await page.screenshot({ path: `${OUT}/ai-${p}-${width}-fail.png` }).catch(() => {});
    }
  }
  await ctx.close();
}
await browser.close();
process.exit(bad ? 1 : 0);
