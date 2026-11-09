// Renders frames [from, to) of the sequence at FPS into frames/NNNNN.png
const { chromium } = require('/opt/node-tools/node_modules/playwright');
const path = require('path');
const fs = require('fs');
const [from, to, fps = 60, outDir = 'frames'] = process.argv.slice(2).map((v, i) => (i < 3 ? Number(v) : v));
fs.mkdirSync(path.join(__dirname, outDir), { recursive: true });
(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => console.error('pageerror', e.message));
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.error('console', m.text()); });
  await page.goto('http://localhost:8790/index.html');
  await page.waitForFunction(() => window.ready).then(() => page.evaluate(() => window.ready));
  for (let f = from; f < to; f++) {
    await page.evaluate((t) => window.renderAt(t), f / fps);
    await page.screenshot({ path: path.join(__dirname, outDir, String(f).padStart(5, '0') + '.png') });
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
