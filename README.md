# Store Audit Tool

An offline-friendly web app for store associates: look up security-tag
placement by style, and run physical inventory counts against a shared
catalog. It installs to the home screen like an app via Safari's "Add to
Home Screen." There's no backend to run — the catalog and audit log both
live in one Google Sheet, read and written directly from the browser via a
small Apps Script.

## The three tabs

### 1. Tag Lookup
Scan or search a product to see the security-tag placement assigned to its
**style** (a "hard tag" — one location applies to every color and size under
that style code, e.g. style `X000009560` → "Thigh pocket" for every
Atom SL Hoody variant). Tap **Set / Edit Tag Location** on any result to
assign or change it from a fixed list (Hood, Below Wash Tag, Through Wash
Tag, Tag Side Pocket, Left Leg In-seam, Chest Pocket). A running list of
every assigned style/location pair is shown below the search box.

### 2. Audit Dashboard
The daily driver:

1. Set **Date** and **Initials** once — remembered until changed again.
2. Tap **📷 Scan Product to Count**.
   - **If the UPC is in the catalog**, its description loads and you move
     straight to counting.
   - **If it isn't**, a small form appears right there — SKU, Description,
     Style, Dept, Color, Size — fill in what you know and tap **Add
     Product**. It's saved locally and pushed to the shared catalog sheet
     immediately, so every other device has it too from then on. Then you
     continue straight into counting it.
3. Confirm or correct the **Expected Count** — blank the first time an item
   is ever counted, pre-filled with whatever was last confirmed after that.
4. Enter the **Actual Count** and tap **Log Count**.

Recent entries are listed below, each with a synced/not-synced indicator,
and exportable to CSV. Tap **Save to Sheet** to push everything not yet
synced up to the shared audit log in one batch — that's the record
leadership references for marking product in or out; there's no separate
adjustments queue in the app, the log itself carries expected vs. counted
vs. variance for every entry.

On boot/refresh, the app also pulls in anything saved from *other* devices,
merging it into Recent Entries — so the log reflects every audit done on
every phone, not just this one.

### 3. Product Master
The shared catalog (SKU, UPC, style, dept, color, size, description) — it
lives entirely in the Google Sheet's "ProductMaster" tab, not in this repo.
Every device syncs from it automatically on boot/refresh. Two ways to add to
it:

- **In the moment**, from the Audit Dashboard when a scan doesn't match (see
  above) — this is the normal way staff will add missing items.
- **In bulk**, on this tab: paste a block (or several) copied straight out
  of Manhattan Omni and tap **Import / Update**. Each block looks like:

  ```
  Atom SL Hoody Men's
  SKUX000009560002
  DeptM
  StyleX000009560
  ColorBlack
  SizeXS
  UPC623555583288
  Available0 / 0
  ```

  Matching is always by SKU — pasting the same SKU again never creates a
  duplicate, it just refreshes the catalog details, and pushes the update to
  the shared sheet for everyone.

You can also just edit the "ProductMaster" sheet tab directly in Google
Sheets (paste from Excel, fix a typo, bulk-add a season) — the app reads
whatever's there regardless of how it got in.

**Important:** the `Available x / x` number from Manhattan Omni is ignored
entirely — it's never parsed, stored, or shown anywhere. Expected count is a
separate field, staff-entered per audit on the Audit Dashboard, never
sourced from Manhattan Omni or the catalog.

The local table is filterable (SKU, UPC, style, or description) and
exportable to CSV.

## The Google Sheet backend

One spreadsheet with two tabs, both created automatically by the script the
first time each is used:

- **AuditLog** — every count logged from every device.
- **ProductMaster** — the shared catalog.

Setup, if you're starting fresh or need to redeploy:

1. Create a Google Sheet (or use an existing one).
2. Extensions → Apps Script, replace everything in `Code.gs` with:

   ```javascript
   function doPost(e) {
     const body = JSON.parse(e.postData.contents);
     return body.type === "master" ? handleMasterPost(body) : handleAuditPost(body);
   }

   function doGet(e) {
     const sheetParam = (e.parameter.sheet || "auditlog").toLowerCase();
     return jsonResponse(sheetToObjects(getOrCreateSheet(
       sheetParam === "master" ? "ProductMaster" : "AuditLog",
       sheetParam === "master" ? MASTER_HEADER : AUDIT_HEADER
     )));
   }

   const AUDIT_HEADER = ["id", "date", "initials", "sku", "upc", "style", "description", "expected", "counted", "variance", "result", "timestamp"];
   const MASTER_HEADER = ["sku", "upc", "dept", "style", "color", "size", "description", "updatedAt"];

   function handleAuditPost(entry) {
     const sheet = getOrCreateSheet("AuditLog", AUDIT_HEADER);
     sheet.appendRow(AUDIT_HEADER.map((key) => entry[key]));
     return jsonResponse({ ok: true });
   }

   function handleMasterPost(item) {
     const sheet = getOrCreateSheet("ProductMaster", MASTER_HEADER);
     const data = sheet.getDataRange().getValues();
     let rowIndex = -1;
     for (let i = 1; i < data.length; i++) {
       if (data[i][0] === item.sku) { rowIndex = i + 1; break; }
     }
     const row = [item.sku, item.upc, item.dept || "", item.style || "", item.color || "", item.size || "", item.description || "", new Date().toISOString()];
     if (rowIndex === -1) sheet.appendRow(row);
     else sheet.getRange(rowIndex, 1, 1, row.length).setValues([row]);
     return jsonResponse({ ok: true });
   }

   function getOrCreateSheet(name, header) {
     const ss = SpreadsheetApp.getActiveSpreadsheet();
     let sheet = ss.getSheetByName(name);
     if (!sheet) sheet = ss.insertSheet(name);
     if (sheet.getLastRow() === 0) sheet.appendRow(header);
     return sheet;
   }

   function sheetToObjects(sheet) {
     const values = sheet.getDataRange().getValues();
     if (values.length < 2) return [];
     const header = values[0];
     return values.slice(1).map((row) => {
       const obj = {};
       header.forEach((key, i) => (obj[key] = row[i]));
       return obj;
     });
   }

   function jsonResponse(obj) {
     return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
   }
   ```

3. **Deploy → New deployment → Web app**. "Execute as: Me," "Who has
   access: Anyone." Deploy, copy the URL.
4. Update `DEFAULT_WEBHOOK_URL` in [`js/storage.js`](js/storage.js) to that
   URL, commit, push. Every device picks up the new default automatically —
   nothing to configure per phone. (The Shared Log Settings field on the
   Audit Dashboard still exists as a manual override, for if the URL ever
   changes again without a code push.)

To update the script later: edit `Code.gs`, then **Deploy → Manage
deployments → pencil icon on the existing deployment → New version →
Deploy** — this keeps the same URL, so no app changes are needed.

## Deploying to GitHub Pages

1. Push this repo to GitHub.
2. **Settings → Pages → Build and deployment → Source** → **Deploy from a
   branch** → pick your branch and `/ (root)`. Save.
   - GitHub Pages requires the repository to be **public** on the free plan.
3. Wait ~1 minute, then open the URL GitHub gives you
   (`https://<username>.github.io/<repo-name>/`).

## Installing on the store iPhone

1. Open the GitHub Pages URL in **Safari** (not Chrome).
2. Share icon → **Add to Home Screen** → Add.
3. Launch from the home screen icon — full-screen, no browser chrome, works
   offline after the first load.

If you rename the app again later, remove the old home-screen icon and
re-add it — iOS caches the name/icon from whatever was live at install time.

## Data & offline behavior

Tag assignments and the session (date/initials) are purely local
(`localStorage`) — there's no need to share those. Product Master and the
audit log are backed by the Sheet and sync automatically:

- **On boot/refresh**, the app pulls the latest catalog and audit history
  from the Sheet (needs a signal for that first fetch).
- **After that**, everything works offline from the local cache — scanning,
  counting, and adding new products all work with no connection; they just
  queue up as "not synced" until the next successful sync.
- **Audit log entries** sync only when you tap **Save to Sheet** — deliberately
  manual/batched, not automatic per scan.
- **New/added catalog products** try to push to the Sheet immediately; if
  that fails (offline), they stay local-only until the next import or scan
  that has a connection.

Since the service worker's own cache-first behavior only applies to the
app's own files (HTML/CSS/JS), the Sheet fetch is always live, never served
from a stale cache.

## Roadmap

This is a standalone prototype, not connected to Manhattan (no store-level
API access exists today) — the catalog is staff-maintained because that's
the only access an associate has. If this proves useful, the natural next
step is pitching retail ops on a real Manhattan integration so counts and
tag rules live in the system of record instead of being bridged by hand.

## Local development

No build step. Serve the folder over HTTP (not `file://` — the service
worker and camera access both require it):

```bash
python3 -m http.server 8000
```

Then visit `http://localhost:8000`.
