// Playwright lives OUTSIDE the repo so it never enters package.json.
// Install once:  npm i --prefix ~/.cache/tungan-visual playwright-core@1.63.0
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

const home = process.env.PW_HOME ?? path.join(os.homedir(), '.cache', 'tungan-visual');
const require = createRequire(path.join(home, 'noop.js'));
const { chromium } = require('playwright-core');

export { chromium };
export const BASE = process.env.BASE ?? 'http://localhost:3107';
/** Chrome binary; defaults to the one Playwright downloaded. */
export const launch = () =>
  chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
