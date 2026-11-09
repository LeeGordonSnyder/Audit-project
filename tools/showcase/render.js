// Renders each <section class="frame"> in frames/style.html to out/<id>.png
// at 1920×1080.   node tools/showcase/render.js
const { chromium } = require('/opt/node-tools/node_modules/playwright');
const fs = require('fs');
const path = require('path');
const OUT = path.join(__dirname, 'out');
fs.mkdirSync(OUT, { recursive: true });
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  page.on('pageerror', (e) => console.log('pageerror', e.message));
  await page.goto('file://' + path.join(__dirname, 'frames', 'style.html'));
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(500);
  for (const id of await page.$$eval('section.frame', (els) => els.map((e) => e.id))) {
    await page.locator('#' + id).screenshot({ path: path.join(OUT, id + '.png') });
    console.log('frame', id);
  }
  await browser.close();
})();
