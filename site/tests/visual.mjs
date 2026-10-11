import { chromium } from 'playwright';
import fs from 'node:fs/promises';

const browser = await chromium.launch();
try {
  await fs.mkdir('../reports', { recursive: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.goto(process.argv[2] || 'http://127.0.0.1:4322/');
  await page.screenshot({ path: '../reports/site-desktop.png', fullPage: true });
} finally {
  await browser.close();
}
