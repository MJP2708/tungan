// Viewport screenshots of the main screens for eyeballing a design change.
import fs from 'node:fs';
import { launch, BASE } from './pw.mjs';
import { fixturePage } from './fixtures.mjs';

const OUT = process.env.OUT ?? '/tmp/tungan-visual';
fs.mkdirSync(OUT, { recursive: true });
const browser = await launch();
const { page } = await fixturePage(browser, BASE, { width: 390, height: 844 });
await page.goto(BASE + '/', { waitUntil: 'networkidle' });
await page.screenshot({ path: `${OUT}/s-home.png` });
await page.evaluate(() => window.scrollTo(0, 600));
await page.waitForTimeout(200);
await page.screenshot({ path: `${OUT}/s-home-scrolled.png` });
await page.locator('nav.mobile-nav button', { hasText: 'งาน' }).first().click();
await page.waitForTimeout(300);
await page.screenshot({ path: `${OUT}/s-tasks.png` });
await page.getByText('ออกแบบป้ายหน้างาน').first().click();
await page.waitForTimeout(500);
await page.screenshot({ path: `${OUT}/s-sheet.png` });
await page.keyboard.press('Escape');
await page.locator('nav.mobile-nav button', { hasText: 'LINE' }).first().click();
await page.waitForTimeout(300);
await page.screenshot({ path: `${OUT}/s-inbox.png` });
const login = await (await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })).newPage();
await login.goto(BASE + '/login', { waitUntil: 'networkidle' });
await login.screenshot({ path: `${OUT}/s-login.png` });
await browser.close();
console.log('screenshots in', OUT);
