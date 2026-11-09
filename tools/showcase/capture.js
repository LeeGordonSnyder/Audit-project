// Full-screen iPhone captures of the app for the showcase video, against the
// mocked backend in tools/guides/mockdata.js (the real sheet is never
// touched). Serve the repo root on :8765 first:
//   python3 -m http.server 8765
//   node tools/showcase/capture.js      -> tools/showcase/screens/*.png
const { chromium } = require('/opt/node-tools/node_modules/playwright');
const fs = require('fs');
const path = require('path');
const { DATA, RECV_PASTE } = require('../guides/mockdata');
const OUT = path.join(__dirname, 'screens');
fs.mkdirSync(OUT, { recursive: true });
const BASE = 'http://localhost:8765/';

// iPhone 15 Pro: 393 × 852 points, 3× pixels. The clock is fixed mid-shift
// so the "Your shift today" card shows a "now" marker.
const TZ = 'America/Vancouver';
const today = new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
const offset = new Intl.DateTimeFormat('en-US', { timeZone: TZ, timeZoneName: 'shortOffset' }).formatToParts(new Date()).find((p) => p.type === 'timeZoneName').value; // "GMT-7"
const NOW = new Date(`${today}T11:20:00${offset.replace('GMT', '').replace(/^([+-])(\d)$/, '$10$2')}:00`);
const T = (h, m = 0) => h * 60 + m;
const block = (code, a, b) => ({ code, start: a, end: b });
const CODES = [
  { code: 'FL', label: 'Floor Leader', bg: '#F4A93B', fg: '#000000' },
  { code: 'PROD', label: 'BOH / Product', bg: '#1F6FC1', fg: '#FFFFFF' },
  { code: 'PG', label: 'Product Guide', bg: '#2FAE4E', fg: '#FFFFFF' },
  { code: 'B', label: 'Break', bg: '#D9D9D9', fg: '#C0392B' },
];
const myBlocks = [block('PROD', T(8, 30), T(10)), block('PG', T(10), T(12)), block('B', T(12), T(12, 15)), block('FL', T(12, 15), T(14)), block('B', T(14), T(14, 30)), block('PG', T(14, 30), T(16, 30))];
DATA.deployment = {
  ok: true, codes: CODES,
  deployment: { date: today, label: NOW.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: TZ }), slotMinutes: 15,
    people: [{ name: 'Lane Sutter', initials: 'LS', shift: '8:30a-4:30p', breaks: ['2p', '12p'], start: T(8, 30), end: T(16, 30), blocks: myBlocks }] },
};

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, timezoneId: TZ });
  const page = await ctx.newPage();
  await page.clock.setFixedTime(NOW);
  page.on('pageerror', (e) => console.log('pageerror', e.message));
  page.on('dialog', (d) => d.dismiss());
  await page.route('https://script.google.com/**', async (route) => {
    const req = route.request();
    if (req.method() === 'POST') return route.fulfill({ contentType: 'application/json', body: '{"ok":true}' });
    const sheet = new URL(req.url()).searchParams.get('sheet');
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(DATA[sheet] ?? []) });
  });

  // Where the video's camera zooms on each screen: the element's box in
  // screen points (393 × 852), written to screens/rects.json.
  const FOCUS = {
    '01-home': '#home-shift', '02-home-exceptions': '#home-exceptions .exception',
    '03-catalog-search': '#catalog-results', '04-catalog-detail': '#catalog-detail .tag-box', '05-catalog-assign': '#catalog-detail .tag-box',
    '06-count-active': '#count-active-card', '07-counts-flagged': '#count-list > :first-child', '08-counts-list': '#count-list',
    '09-consol-list': '#consol-list > :nth-child(2)', '10-consol-holding': '#consol-holding', '11-consol-mao': '#mao-reminder-modal .modal-inner',
    '13-receiving-paste': '#view-receiving details.panel', '14-receiving-scan': '#scanner-modal .scanner-modal-inner',
    '16-receiving-awaiting': '#recv-awaiting-section', '17-floor-check': '#floor-check-list > :first-child',
    '18-floor-sizes': '#floor-needed-modal .modal-inner', '19-floor-replen': '#floor-replen-list > :first-child', '20-floor-86': '#floor-panel-86 .line-card',
  };
  const rects = {};
  const measure = async (name) => {
    if (!FOCUS[name]) return;
    const r = await page.locator(FOCUS[name]).first().boundingBox().catch(() => null);
    if (!r) return console.log('  no focus box for', name);
    const y0 = Math.max(0, r.y), y1 = Math.min(852, r.y + r.height);
    rects[name] = { x: Math.round(r.x), y: Math.round(y0), w: Math.round(r.width), h: Math.round(y1 - y0) };
  };
  const shot = async (name, scrollTo) => {
    // clear toasts and status lines first: removing them shifts the page
    await page.evaluate(() => { const t = document.getElementById('toast'); if (t) t.hidden = true; document.querySelectorAll('.status-msg').forEach((e) => (e.textContent = '')); });
    if (scrollTo !== undefined) await page.evaluate((y) => window.scrollTo(0, typeof y === 'number' ? y : document.querySelector(y).getBoundingClientRect().top + window.scrollY - 70), scrollTo);
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(OUT, `${name}.png`) });
    await measure(name);
    console.log('shot', name);
  };
  const go = async (route) => {
    await page.evaluate((r) => (location.hash = r), route);
    await page.waitForFunction((r) => !document.getElementById('view-' + r.split('/')[0]).hidden, route);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(250);
  };

  await page.goto(BASE + 'manifest.webmanifest');
  await page.evaluate(() => { localStorage.clear(); localStorage.setItem('ops2.apiKey', 'store-key'); });
  await page.goto(BASE);
  await page.waitForSelector('#login-gate:not([hidden])');
  await page.selectOption('#login-select', 'LS');
  await shot('00-signin');
  await page.click('#login-continue');
  await page.waitForSelector('#app:not([hidden])');
  await page.waitForTimeout(600);

  // Home
  await go('home');
  await shot('01-home');
  await shot('02-home-exceptions', '#home-exceptions');

  // Product Catalog: search → product detail with its hard-tag location
  await go('catalog');
  await page.fill('#catalog-search', 'atom');
  await shot('03-catalog-search');
  await page.click('#catalog-results .result-row >> nth=1');
  await page.waitForSelector('#catalog-detail:not([hidden])');
  await shot('04-catalog-detail', 0);
  await page.fill('#catalog-search', 'cerium');
  await page.click('#catalog-results .result-row');
  await page.selectOption('#catalog-tag-select', 'Hood');
  await shot('05-catalog-assign', 0);

  // Counts: an active count, then the list with the flagged filter
  await go('counts');
  await page.fill('#count-search', 'gamma');
  await page.click('#count-results .result-row');
  await page.fill('#count-expected', '4');
  await page.fill('#count-actual', '4');
  await shot('06-count-active', 0);
  await page.click('[data-action="count-log"]');
  await page.click('[data-filter="flagged"]');
  await shot('07-counts-flagged', '#view-counts .section-head');
  await page.click('[data-filter="all"]');
  await shot('08-counts-list', '#view-counts .section-head');

  // Consolidations: live list with counts in progress, then the MAO reminder
  await go('consol');
  await page.click('[data-action="consol-inc"][data-ecc="30452"]');
  await page.click('[data-action="consol-inc"][data-ecc="30452"]');
  await shot('09-consol-list', '#consol-list');
  await page.click('[data-action="consol-stage"][data-ecc="30452"]');
  await shot('10-consol-holding', '#consol-holding');
  await go('consol');
  await page.fill('#consol-box-ref', '4410093877');
  await page.click('[data-action="consol-close-manual"]');
  await page.waitForSelector('#mao-reminder-modal:not([hidden])');
  await shot('11-consol-mao');
  await page.click('#mao-reminder-confirm-btn');

  // Receiving: paste expected boxes, scan, then Waiting on MAO
  await go('receiving');
  await shot('12-receiving');
  await page.locator('#view-receiving details.panel').evaluate((d) => (d.open = true));
  await page.fill('#recv-paste', RECV_PASTE);
  await shot('13-receiving-paste', '#view-receiving details.panel');
  await page.click('[data-action="recv-import"]');
  await page.waitForFunction(() => /shared all/.test(document.getElementById('recv-import-status').textContent));
  await page.locator('#view-receiving details.panel').evaluate((d) => (d.open = false));
  await page.evaluate(() => {
    holdBox('8069559026403611'); holdBox('8069559026403612');
    document.getElementById('scanner-modal').hidden = false;
    document.getElementById('scanner-modal-title').textContent = 'Scanning boxes…';
    document.getElementById('scanner-modal-cancel').textContent = 'Done Scanning';
    document.getElementById('scanner-modal-view').innerHTML = '<div style="height:300px;background:linear-gradient(160deg,#30262a,#4a3a40);display:grid;place-items:center"><div style="width:270px;height:140px;border:3px solid #fff;border-radius:8px;opacity:.85"></div></div>';
    setStatus('scanner-modal-feedback', 'Held 8069559026403612 (PO 6390185303). 2 boxes held.', false);
  });
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(OUT, '14-receiving-scan.png') }); await measure('14-receiving-scan'); console.log('shot', '14-receiving-scan');
  await page.evaluate(() => { document.getElementById('scanner-modal').hidden = true; document.getElementById('scanner-modal-view').innerHTML = ''; renderReceiving(); });
  await shot('15-receiving-held', '#recv-holding-section');
  await page.click('#recv-mark-physical-btn');
  await page.waitForFunction(() => /^Marked/.test(document.getElementById('recv-status').textContent));
  await shot('16-receiving-awaiting', '#recv-awaiting-section');

  // Floor Stock: Check Floor, the size picker, Replen, the 86 Board
  await go('floor/check');
  await shot('17-floor-check');
  const key = await page.$$eval('#floor-check-list .line-card', (els) => {
    const el = els.find((e) => e.querySelector('.line-title').textContent === "Atom Hoody Men's" && e.querySelector('.line-sub').textContent.startsWith('Black'));
    return el.querySelector('[data-action="floor-needed"]').dataset.key;
  });
  await page.click(`[data-action="floor-needed"][data-key="${key}"]`);
  await page.click('#floor-needed-sizes label:has(input[value="M"])');
  await page.click('#floor-needed-sizes label:has(input[value="L"])');
  await shot('18-floor-sizes');
  await page.click('#floor-needed-save-btn');
  await page.click('#floor-check-update');
  await page.waitForFunction(() => /^Updated/.test(document.getElementById('floor-check-status').textContent));
  await go('floor/replen');
  await shot('19-floor-replen');
  await go('floor/86');
  await shot('20-floor-86');

  fs.writeFileSync(path.join(OUT, 'rects.json'), JSON.stringify(rects, null, 1));
  await browser.close();
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
