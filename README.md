# Security Tag Lookup

A small offline-friendly web app for store associates: scan or search a SKU to
see the correct security-tag placement and any HQ-issued exceptions, and log
inventory tag audits as you go. No backend required — it runs entirely as
static files and installs to the home screen like an app via Safari's
"Add to Home Screen."

## Features

- **Lookup** — search by SKU, description, or category. Use the camera button
  to scan a barcode, or a Bluetooth/USB handheld scanner (it types into the
  search box like a keyboard). HQ exceptions are called out separately from
  the standard tag placement.
- **Audit Log** — a quick form (associate name, SKU, pass/fail/missing,
  notes) that saves locally on the device — works with no signal — and can
  optionally sync each entry to a Google Sheet.
- **Works offline** once loaded once, via a service worker + home-screen
  install.

## Deploying to GitHub Pages

1. Push this repo to GitHub (already the case if you're reading this from the repo).
2. In the repo: **Settings → Pages → Build and deployment → Source**, choose
   **Deploy from a branch**, branch `main`, folder `/ (root)`. Save.
3. Wait a minute, then open the URL GitHub shows you
   (`https://<username>.github.io/<repo-name>/`).

## Installing on the store iPhone

1. Open the GitHub Pages URL in **Safari** (must be Safari, not Chrome, for
   Add to Home Screen to create a full app-like icon).
2. Tap the Share icon → **Add to Home Screen** → Add.
3. Launch it from the home screen icon going forward — it opens full-screen,
   no browser chrome, and works offline after the first load.

## Updating the SKU data

Edit [`data/skus.json`](data/skus.json). Each entry:

```json
{
  "sku": "24259-000123",
  "description": "Beta AR Jacket - Men's",
  "category": "Outerwear - Hardshell",
  "tagLocation": "Inside left hem, through interior pocket loop",
  "exceptionNotes": "",
  "updated": "2026-06-01"
}
```

Leave `exceptionNotes` as an empty string when there's no HQ exception —
non-empty notes are shown as a highlighted warning box in the app. Commit and
push; the change goes live on GitHub Pages within a minute or two. The app
also caches the file locally, so already-installed phones pick up the change
the next time they have a signal (tap **Settings → Reload Data** to force it
immediately).

The sample data in this repo is placeholder — replace it with a real SKU
export before using this in-store.

## Optional: syncing audit entries to a Google Sheet

Audit entries always save on-device first, so logging works with the store
Wi-Fi down. To also mirror entries into a shared Google Sheet:

1. Create a Google Sheet. Add a header row: `timestamp | associate | sku | description | result | notes`.
2. In the Sheet, go to **Extensions → Apps Script**, delete the placeholder
   code, and paste:

   ```javascript
   function doPost(e) {
     const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
     const entry = JSON.parse(e.postData.contents);
     sheet.appendRow([
       entry.timestamp,
       entry.associate,
       entry.sku,
       entry.description,
       entry.result,
       entry.notes,
     ]);
     return ContentService.createTextOutput("OK");
   }
   ```

3. **Deploy → New deployment → Web app**. Set "Execute as" to yourself and
   "Who has access" to "Anyone" (required for the app to reach it without a
   Google login prompt on the store phone). Deploy, and copy the Web App URL.
4. In the app, open **Settings**, paste the URL into "Google Sheet Webhook
   URL", and tap Save.

New audit entries will POST to that URL going forward; entries logged while
offline are retried automatically the next time the app is opened online.
(This uses a fire-and-forget `no-cors` request, so the app can't confirm the
row landed — spot-check the Sheet occasionally. The CSV export button on the
Audit Log tab is always available as a reliable manual backup.)

## Roadmap

This is a standalone prototype, not connected to Manhattan (no store-level
API access exists today). If it proves useful, the natural next step is
pitching retail ops on a real Manhattan integration so tag rules and audit
logs live in the system of record instead of a spreadsheet.

## Local development

No build step. Serve the folder over HTTP (not `file://`, since the service
worker and camera access require it) and open it, e.g.:

```bash
python3 -m http.server 8000
```

Then visit `http://localhost:8000`.
