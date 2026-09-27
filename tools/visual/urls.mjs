// Screens and the address bar: a link opens the screen it names, the phone's
// Back button steps back one screen instead of closing the app, a reload
// stays put, and the chosen start page is the one that opens.
// Usage: node tools/visual/urls.mjs   (against `next start -p 3107`)
import { launch, BASE } from './pw.mjs';
import { fixturePage } from './fixtures.mjs';

const browser = await launch();
const { ctx, page, errors } = await fixturePage(browser, BASE, { width: 390, height: 844 });
const where = async () => ({
  page: await page.locator('main.app-main').getAttribute('data-page'),
  url: new URL(page.url()).pathname + new URL(page.url()).search,
});
let bad = 0;
const check = async (label, expect) => {
  await page.waitForTimeout(300);
  const got = await where();
  const ok = got.page === expect.page && got.url === expect.url;
  if (!ok) bad += 1;
  console.log(`${ok ? 'ok ' : 'BAD'} ${label.padEnd(42)} page=${got.page} url=${got.url}`);
};

await page.goto(BASE + '/?p=reminders', { waitUntil: 'networkidle' });
await check('a link opens เตือนฉัน', { page: 'reminders', url: '/?p=reminders' });

await page.locator('nav.mobile-nav button', { hasText: 'งาน' }).first().click();
await check('tapping งาน moves the address', { page: 'tasks', url: '/?p=tasks' });

await page.goBack();
await check('Back returns to เตือนฉัน', { page: 'reminders', url: '/?p=reminders' });

await page.goForward();
await check('Forward returns to งาน', { page: 'tasks', url: '/?p=tasks' });

await page.reload({ waitUntil: 'networkidle' });
await check('a reload stays on งาน', { page: 'tasks', url: '/?p=tasks' });

await page.locator('nav.mobile-nav button', { hasText: 'วันนี้' }).first().click();
await check('วันนี้ keeps the bare address', { page: 'home', url: '/' });

await page.goto(BASE + '/?p=nonsense', { waitUntil: 'networkidle' });
await check('an unknown screen falls back to วันนี้', { page: 'home', url: '/?p=nonsense' });

// The start page preference, which nothing ever applied.
await page.goto(BASE + '/', { waitUntil: 'networkidle' });
await page.evaluate(() => {
  const key = Object.keys(localStorage).find((k) => k.includes('setting'));
  const saved = JSON.parse(localStorage.getItem(key) ?? '{}');
  localStorage.setItem(key, JSON.stringify({ ...saved, startPage: 'calendar' }));
});
await page.goto(BASE + '/', { waitUntil: 'networkidle' });
await check('the chosen start page opens, and shows', { page: 'calendar', url: '/?p=calendar' });

await page.goto(BASE + '/?p=inbox&task=t-1', { waitUntil: 'networkidle' });
await check('a task link keeps the screen it asked for', { page: 'inbox', url: '/?p=inbox' });

// A task sheet is a step of its own, so Back closes it instead of leaving
// the screen behind it.
const sheet = page.locator('.task-detail');
await page.goto(BASE + '/?p=tasks', { waitUntil: 'networkidle' });
await page.locator('.task-card, [class*="task-row"], button').filter({ hasText: 'ใบเสนอราคา' }).first().click();
await page.waitForTimeout(400);
console.log(`${await sheet.isVisible() ? 'ok ' : 'BAD'} a task opens its sheet`);
if (!(await sheet.isVisible())) bad += 1;

await page.goBack();
await page.waitForTimeout(400);
const closed = !(await sheet.isVisible());
if (!closed) bad += 1;
console.log(`${closed ? 'ok ' : 'BAD'} Back closes the sheet, not the screen`);
await check('and leaves งาน where it was', { page: 'tasks', url: '/?p=tasks' });

await page.locator('.task-card, [class*="task-row"], button').filter({ hasText: 'ใบเสนอราคา' }).first().click();
await page.waitForTimeout(400);
await page.locator('.task-detail [data-slot="sheet-close"]').first().click();
await page.waitForTimeout(500);
const closedByX = !(await sheet.isVisible());
if (!closedByX) bad += 1;
console.log(`${closedByX ? 'ok ' : 'BAD'} closing with X leaves no step that reopens it`);
await check('and Back still goes to the screen before', { page: 'tasks', url: '/?p=tasks' });
// Two sheet steps were pushed and both taken back, so the next Back is the
// screen visited before งาน — the history has no leftovers.
await page.goBack();
await check('Back then leaves งาน for the screen before', { page: 'inbox', url: '/?p=inbox' });

if (errors.length) { bad += 1; console.log('BAD page errors:', [...new Set(errors)]); }
await ctx.close();
await browser.close();
console.log(bad ? `${bad} problem(s)` : 'all clean');
process.exit(bad ? 1 : 0);
