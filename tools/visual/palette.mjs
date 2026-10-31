// Anything on any screen still painted in a colour the brand retired
// (2026-10-31): the old blue, the old reds, the old amber. Checks every
// element's and pseudo-element's colours, borders, shadows and gradients.
// Usage: node tools/visual/palette.mjs  (AI=1 to include the AI panels)
import { launch, BASE } from './pw.mjs';
import { fixturePage } from './fixtures.mjs';

const RETIRED = ['0, 128, 255', '196, 36, 31', '229, 50, 45', '180, 83, 9'];
const PROPS = ['color', 'backgroundColor', 'backgroundImage', 'borderTopColor', 'borderBottomColor', 'borderLeftColor', 'boxShadow', 'outlineColor', 'fill', 'stroke'];

function scan(retired, props) {
  const out = new Set();
  const look = (el, pseudo) => {
    const cs = getComputedStyle(el, pseudo);
    if (pseudo && cs.content === 'none') return;
    for (const p of props) {
      const v = cs[p];
      if (!v) continue;
      const hit = retired.find((c) => v.includes(`(${c}`));
      if (hit) out.add(`${el.tagName.toLowerCase()}.${String(el.className.baseVal ?? el.className).trim().split(/\s+/).slice(0, 2).join('.')}${pseudo ?? ''} ${p} ${hit}`);
    }
  };
  for (const el of document.querySelectorAll('body, body *')) {
    look(el);
    look(el, '::before');
    look(el, '::after');
  }
  return [...out];
}

const browser = await launch();
const { page } = await fixturePage(browser, BASE, { width: 390, height: 844 });
let bad = 0;
const check = async (name) => {
  await page.waitForTimeout(250);
  const found = await page.evaluate(`(${scan})(${JSON.stringify(RETIRED)}, ${JSON.stringify(PROPS)})`);
  if (found.length) bad += found.length;
  console.log(`${found.length ? 'BAD' : 'ok '} ${name}`);
  for (const f of found.slice(0, 12)) console.log('    ' + f);
};
for (const p of ['', 'inbox', 'tasks', 'reminders', 'mine', 'calendar', 'reports', 'ai', 'manage', 'settings']) {
  await page.goto(`${BASE}/${p ? `?p=${p}` : ''}`, { waitUntil: 'networkidle' });
  await check(p || 'home');
}
await page.goto(`${BASE}/?p=tasks`, { waitUntil: 'networkidle' });
await page.locator('.task-row').first().click();
await page.waitForTimeout(400);
await check('task sheet');
await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
await check('login');
await browser.close();
console.log(bad ? `${bad} leftover(s)` : 'palette clean');
process.exit(bad ? 1 : 0);
