// Captures step-by-step screenshots of the rebuild for the PDF guides,
// against a mocked backend with realistic sample data (the real sheet is
// never touched). Serve the repo root on :8765 first:
//   python3 -m http.server 8765
//   node tools/guides/shots.js        -> tools/guides/shots/*.png
const { chromium } = require('/opt/node-tools/node_modules/playwright');
const fs = require('fs');
const path = require('path');
const OUT = path.join(__dirname, 'shots');
fs.mkdirSync(OUT, { recursive: true });
const BASE = 'http://localhost:8765/';

const { DATA, MAO_PASTE, RECV_PASTE } = require('./mockdata');

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2.5 });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('pageerror', e.message));
  page.on('dialog', (d) => d.dismiss());
  let keyOk = true;
  await page.route('https://script.google.com/**', async (route) => {
    const req = route.request();
    if (req.method() === 'POST') return route.fulfill({ contentType: 'application/json', body: '{"ok":true}' });
    const u = new URL(req.url());
    if (!keyOk && u.searchParams.get('key') !== 'store-key') return route.fulfill({ contentType: 'application/json', body: '{"ok":false,"error":"Unauthorized"}' });
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(DATA[u.searchParams.get('sheet')] ?? []) });
  });

  const shot = async (name, selector, opts = {}) => {
    await page.waitForTimeout(opts.wait ?? 250);
    const file = path.join(OUT, `${name}.png`);
    if (opts.clip) await page.screenshot({ path: file, clip: opts.clip });
    else if (!selector) await page.screenshot({ path: file });
    else {
      // Sticky header/nav would overlap element crops — hide them unless
      // they're what's being pictured.
      const bars = !/topbar|bottom-nav|update-banner/.test(selector);
      if (bars) await page.addStyleTag({ content: '.topbar,.bottom-nav,.toast{visibility:hidden!important}' }).then((h) => (page._barStyle = h));
      await page.locator(selector).first().screenshot({ path: file });
      if (bars) await page._barStyle.evaluate((el) => el.remove());
    }
    console.log('shot', name);
  };
  const hideToast = () => page.evaluate(() => (document.getElementById('toast').hidden = true));
  const go = async (route) => {
    await page.evaluate((r) => (location.hash = r), route);
    await page.waitForFunction((r) => !document.getElementById('view-' + r.split('/')[0]).hidden, route);
    await page.waitForTimeout(200);
  };
  const clearStatus = () => page.evaluate(() => document.querySelectorAll('.status-msg').forEach((e) => (e.textContent = '')));

  // ---------- Getting started ----------
  await page.goto(BASE + 'manifest.webmanifest');
  await page.evaluate(() => localStorage.clear());
  keyOk = false;
  await page.goto(BASE);
  await page.waitForSelector('#login-gate:not([hidden])');
  await page.waitForTimeout(400);
  await shot('start-01-signin', '#login-gate .modal-inner');
  await page.fill('#login-key', 'store-key');
  await page.selectOption('#login-select', 'LS');
  await shot('start-02-signin-filled', '#login-gate .modal-inner');
  await page.click('#login-continue');
  await page.waitForSelector('#app:not([hidden])');
  keyOk = true;
  await hideToast();
  // loading screen (re-shown for the picture)
  await page.evaluate(() => { document.getElementById('boot-loading').hidden = false; document.getElementById('boot-skip').hidden = false; });
  await shot('start-03-loading', null, { clip: { x: 0, y: 280, width: 390, height: 245 } });
  await page.evaluate(() => (document.getElementById('boot-loading').hidden = true));
  await go('home');
  await shot('start-04-header', '.topbar');
  await shot('start-05-nav', '.bottom-nav');
  await page.click('#settings-btn');
  await shot('start-06-settings', '#settings-modal .modal-inner');
  await page.click('#settings-feedback-btn');
  await page.fill('#feedback-text', 'Could the Replen list sort by department?');
  await shot('start-07-feedback', '#feedback-modal .modal-inner');
  await page.click('#feedback-modal [data-close]');
  await page.click('#change-user-btn');
  await shot('start-08-change-user', '#user-modal .modal-inner');
  await page.click('#user-modal [data-close]');
  await page.evaluate(() => (document.getElementById('update-banner').hidden = false));
  await shot('start-09-update', '#update-banner');
  await page.evaluate(() => (document.getElementById('update-banner').hidden = true));

  // ---------- Home ----------
  await go('home');
  await shot('home-01-overview');
  await shot('home-02-quick', '#view-home .quick-actions');
  await shot('home-03-exceptions', '#home-exceptions');
  await shot('home-04-kpis', '#home-kpis');

  // ---------- Catalog ----------
  await go('catalog');
  await shot('cat-01-empty');
  await page.fill('#catalog-search', 'atom');
  await shot('cat-02-results', '#view-catalog', {});
  await page.click('#catalog-results .result-row >> nth=1');
  await page.waitForSelector('#catalog-detail:not([hidden])');
  await shot('cat-03-detail', '#catalog-detail .product-card');
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot('cat-08-detail-full'); // full phone screen, used by the motion piece
  await page.fill('#catalog-search', 'cerium');
  await page.click('#catalog-results .result-row');
  await page.selectOption('#catalog-tag-select', 'Hood');
  await shot('cat-04-tag', '#catalog-detail .tag-box');
  await page.click('[data-action="save-tag"]');
  await page.waitForTimeout(400);
  await hideToast();
  await page.click('[data-action="catalog-clear"]');
  await page.click('#view-catalog details.panel >> nth=0');
  await page.locator('#view-catalog details.panel >> nth=0').evaluate((d) => (d.open = true));
  await page.fill('#catalog-paste', MAO_PASTE);
  await shot('cat-05-import', '#view-catalog details.panel >> nth=0');
  await page.click('[data-action="catalog-import"]');
  await page.waitForFunction(() => /shared all/.test(document.getElementById('catalog-import-status').textContent));
  await shot('cat-06-imported', '#view-catalog details.panel >> nth=0');
  await page.locator('#view-catalog details.panel >> nth=0').evaluate((d) => (d.open = false));
  await page.locator('#view-catalog details.panel >> nth=1').evaluate((d) => (d.open = true));
  await shot('cat-07-tags', '#view-catalog details.panel >> nth=1');

  // ---------- Counts ----------
  await go('counts');
  await shot('cnt-01-top');
  await page.fill('#count-search', 'gamma');
  await shot('cnt-02-search', '#count-results');
  await page.click('#count-results .result-row');
  await page.fill('#count-expected', '4');
  await page.fill('#count-actual', '4');
  await shot('cnt-03-active', '#count-active-card');
  await page.click('[data-action="count-log"]');
  await shot('cnt-04-logged', '#count-status');
  await page.evaluate(() => handleCountScan('686487000999'));
  await page.fill('#count-add-sku', 'X000008800002');
  await page.fill('#count-add-description', "Kyanite Hoody Women's");
  await page.fill('#count-add-style', 'X000008800');
  await page.fill('#count-add-color', 'Black');
  await page.fill('#count-add-size', 'M');
  await shot('cnt-05-add', '#count-add-card');
  await page.click('[data-action="count-add-cancel"]');
  await clearStatus();
  await page.evaluate(() => window.scrollTo(0, document.querySelector('#view-counts .section-head').offsetTop - 70));
  await shot('cnt-06-list', null);
  await page.click('[data-filter="flagged"]');
  await shot('cnt-07-flagged', '#count-list');
  await page.click('[data-filter="all"]');

  // ---------- Consolidations ----------
  await go('consol');
  await shot('con-01-close', '#view-consol .card');
  await page.fill('#consol-box-ref', '4410093877');
  await page.click('[data-action="consol-close-manual"]');
  await page.waitForSelector('#mao-reminder-modal:not([hidden])');
  await shot('con-02-mao', '#mao-reminder-modal .modal-inner');
  await page.click('#mao-reminder-confirm-btn');
  await page.waitForFunction(() => /closed and logged/.test(document.getElementById('consol-packout-status').textContent));
  await shot('con-03-closed', '#view-consol .card');
  await shot('con-04-items', '#consol-list');
  await page.click('[data-action="consol-inc"][data-ecc="30452"]');
  await page.click('[data-action="consol-inc"][data-ecc="30452"]');
  await page.waitForTimeout(300);
  await shot('con-05-stepper', '#consol-list');
  await page.click('[data-action="consol-stage"][data-ecc="30452"]');
  await page.evaluate(() => window.scrollTo(0, document.querySelector('#consol-holding').offsetTop - 140));
  await shot('con-06-holding', null);
  await page.click('#consol-update-btn');
  await page.waitForFunction(() => /^Updated/.test(document.getElementById('consol-status').textContent));
  await shot('con-07-log', '#consol-log');

  // ---------- Receiving ----------
  await go('receiving');
  await shot('rec-01-top');
  await page.locator('#view-receiving details.panel').evaluate((d) => (d.open = true));
  await page.fill('#recv-paste', RECV_PASTE);
  await shot('rec-02-import', '#view-receiving details.panel');
  await page.click('[data-action="recv-import"]');
  await page.waitForFunction(() => /shared all/.test(document.getElementById('recv-import-status').textContent));
  await page.locator('#view-receiving details.panel').evaluate((d) => (d.open = false));
  // Scanner illustration (no camera in the capture browser)
  await page.evaluate(() => {
    holdBox('8069559026403611'); holdBox('8069559026403612');
    document.getElementById('scanner-modal').hidden = false;
    document.getElementById('scanner-modal-title').textContent = 'Scanning boxes…';
    document.getElementById('scanner-modal-cancel').textContent = 'Done Scanning';
    document.getElementById('scanner-modal-view').innerHTML = '<div style="height:230px;background:linear-gradient(160deg,#30262a,#4a3a40);display:grid;place-items:center"><div style="width:260px;height:130px;border:3px solid #fff;border-radius:6px;opacity:.85"></div></div>';
    setStatus('scanner-modal-feedback', 'Held 8069559026403612 (PO 6390185303). 2 boxes held.', false);
  });
  await shot('rec-03-scanner', '#scanner-modal .scanner-modal-inner');
  await page.evaluate(() => { document.getElementById('scanner-modal').hidden = true; document.getElementById('scanner-modal-view').innerHTML = ''; renderReceiving(); });
  await shot('rec-04-holding', '#recv-holding-section');
  await page.click('#recv-mark-physical-btn');
  await page.waitForFunction(() => /^Marked/.test(document.getElementById('recv-status').textContent));
  await clearStatus();
  await shot('rec-05-awaiting', '#recv-awaiting-section');
  await page.click('[data-action="recv-hold-awaiting"]');
  await clearStatus();
  await shot('rec-06-held-mao', '#recv-holding-section');
  await page.evaluate(() => openAddBoxModal('8069559026499999'));
  await page.fill('#recv-add-po', '6390185320');
  await shot('rec-07-notexpected', '#recv-add-modal .modal-inner');
  await page.click('#recv-add-modal [data-close]');
  await shot('rec-08-expected', '#recv-expected');

  // ---------- Floor Stock ----------
  await go('floor/check');
  await shot('flr-01-check');
  await shot('flr-02-lines', '#floor-check-list');
  const keyOf = (title, color) => page.$$eval('#floor-check-list .line-card', (els, [t, c]) => {
    const el = els.find((e) => e.querySelector('.line-title').textContent === t && e.querySelector('.line-sub').textContent.startsWith(c));
    return el.querySelector('[data-action="floor-needed"]').dataset.key;
  }, [title, color]);
  const blackKey = await keyOf("Atom Hoody Men's", 'Black');
  await page.click(`[data-action="floor-needed"][data-key="${blackKey}"]`);
  await page.click('#floor-needed-sizes label:has(input[value="M"])');
  await page.click('#floor-needed-sizes label:has(input[value="L"])');
  await shot('flr-03-sizes', '#floor-needed-modal .modal-inner');
  await page.click('#floor-needed-save-btn');
  await page.click(`[data-action="floor-not-needed"][data-key="${await keyOf("Cormac Tee Men's", 'White')}"]`);
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot('flr-04-holding', '#floor-panel-check', {});
  await page.fill('#floor-search', 'kyanite fleece');
  await shot('flr-05-add', '#floor-panel-check .search-row', {});
  await page.click('#floor-manual-btn');
  await page.click('#floor-manual-sizes label:has(input[value="S"])');
  await shot('flr-06-manual', '#floor-manual-modal .modal-inner');
  await page.click('#floor-manual-modal [data-close]');
  await page.fill('#floor-search', '');
  await page.evaluate(() => renderFloorSearch());
  await page.click('#floor-check-update');
  await page.waitForFunction(() => /^Updated/.test(document.getElementById('floor-check-status').textContent));
  await go('floor/replen');
  await clearStatus();
  await shot('flr-07-replen', '#floor-replen-list');
  await page.click('[data-action="floor-picked"][data-sku="X000009560003"]');
  await page.click('[data-action="floor-oos"][data-sku="X000005100001"]');
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot('flr-08-replen-holding', null);
  await page.click('#floor-replen-update');
  await page.waitForFunction(() => /^Updated/.test(document.getElementById('floor-replen-status').textContent));
  await go('floor/86');
  await shot('flr-09-86', '#floor-panel-86');

  await browser.close();
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
