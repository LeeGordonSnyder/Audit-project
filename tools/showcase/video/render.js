// Renders the showcase. Serve nothing; it loads index.html from disk.
//   node render.js stills 12 40 95 …      -> out/still-<t>.png at those seconds
//   node render.js video [fps] [workers]  -> out/showcase.mp4 (silent)
// Each worker renders a slice of frames and pipes them straight into its own
// ffmpeg, so no frame files pile up; the slices are joined at the end.
const { chromium } = require('/opt/node-tools/node_modules/playwright');
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const OUT = path.join(__dirname, '..', 'out');
fs.mkdirSync(OUT, { recursive: true });
const RECTS = fs.readFileSync(path.join(__dirname, '..', 'screens', 'rects.json'), 'utf8');
const [mode = 'stills', ...args] = process.argv.slice(2);

async function open(browser) {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  page.on('pageerror', (e) => console.log('pageerror', e.message));
  await page.addInitScript(`window.RECTS = ${RECTS};`);
  await page.goto('file://' + path.join(__dirname, 'index.html'));
  await page.evaluate(async () => {
    // warm every screenshot so screen changes never catch an undecoded image
    const names = [...new Set(Object.keys(window.RECTS).concat(['00-signin', '01-home', '12-receiving', '15-receiving-held']))];
    await Promise.all(names.map((n) => { const i = new Image(); i.src = `../screens/${n}.png`; return i.decode().catch(() => {}); }));
    await window.ready;
  });
  return page;
}
async function draw(page, t) {
  await page.evaluate(async (t) => {
    window.renderAt(t);
    await Promise.all([...document.images].filter((i) => i.offsetParent !== null || i.closest('.scene')?.style.display === 'block').map((i) => (i.complete ? null : i.decode().catch(() => {}))));
  }, t);
}

(async () => {
  const browser = await chromium.launch({ args: ['--disable-gpu'] });
  if (mode === 'stills') {
    const page = await open(browser);
    console.log('duration', (await page.evaluate(() => window.DURATION)).toFixed(1), 's');
    for (const a of args) {
      await draw(page, Number(a));
      await page.screenshot({ path: path.join(OUT, `still-${a}.png`) });
      console.log('still', a);
    }
    return browser.close();
  }
  const fps = Number(args[0] || 30), workers = Number(args[1] || 4);
  const probe = await open(browser);
  const total = Math.ceil((await probe.evaluate(() => window.DURATION)) * fps);
  await probe.close();
  console.log(`${total} frames at ${fps} fps, ${workers} workers`);
  const per = Math.ceil(total / workers);
  const t0 = Date.now();
  let done = 0;
  await Promise.all([...Array(workers).keys()].map(async (w) => {
    const from = w * per, to = Math.min(total, from + per);
    const page = await open(browser);
    const seg = path.join(OUT, `seg-${w}.mp4`);
    const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'mjpeg', '-i', '-',
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-r', String(fps), seg], { stdio: ['pipe', 'inherit', 'inherit'] });
    for (let f = from; f < to; f++) {
      await draw(page, f / fps);
      const buf = await page.screenshot({ type: 'jpeg', quality: 95 });
      if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
      if (++done % 300 === 0) console.log(`${done}/${total} frames · ${((Date.now() - t0) / 1000).toFixed(0)}s`);
    }
    ff.stdin.end();
    await new Promise((r) => ff.on('close', r));
    await page.close();
  }));
  const list = path.join(OUT, 'segs.txt');
  fs.writeFileSync(list, [...Array(workers).keys()].map((w) => `file 'seg-${w}.mp4'`).join('\n'));
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', '-movflags', '+faststart', path.join(OUT, 'showcase.mp4')]);
  [...Array(workers).keys()].forEach((w) => fs.unlinkSync(path.join(OUT, `seg-${w}.mp4`)));
  console.log(`done in ${((Date.now() - t0) / 1000).toFixed(0)}s -> out/showcase.mp4`);
  await browser.close();
})();
