# Store Audit Tool

An offline-friendly web app for store associates: look up security-tag
placement by style, and run physical inventory counts against a shared
catalog. It installs to the home screen like an app via Safari's "Add to
Home Screen." There's no backend to run — the catalog and audit log both
live in one Google Sheet, read and written directly from the browser via a
small Apps Script.

## The four tabs

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

### 4. Consolidations
For HQ-driven consolidation events. Paste the HQ export — copied straight out
of Excel — into the paste box: **Material Description, Colour, Generic
Material, ECC Generic Material, FINAL consolidation Plan, Total**. Tap
**Import / Update** and it's pushed to the shared "ConsolMaster" sheet tab,
same pattern as Product Master. Matching is by **ECC Generic Material**
(unique per style/colour in the HQ export) — sizes aren't tracked here since
consolidation happens regardless of size.

Every item shows a **Status** dropdown:

- **Completed** — moves it into the **Packed Box** section below (it's a
  physical item that's actually going in the box being packed right now).
- **Needs Adjustment** — something showed in MAO during consolidation that
  couldn't be found physically. Prompts for **Size** and **Units to Mark
  Out**, then logs it right away. (Marking product *in* isn't needed here —
  anything actually on hand gets consolidated through the normal process
  anyway.)

The **Packed Box** is where Completed items collect while you're physically
packing them — a lightweight, per-device staging area, not yet logged
anywhere shared. Made a mistake? Tap **Remove** to send an item back to the
list above. Once the box is actually packed, tap **📷 Scan Packing Slip —
Close Box** and scan its barcode/QR (its reference number) — that logs every
item currently in the box as Completed, tagged with that reference number,
plus one closure record, all in one go, and uploads them immediately. The
box then clears itself, ready for the next one. If the upload fails partway
(no connection), whatever didn't go through stays in the box — just scan
again once you're back online.

Every status change is logged with the current Date/Initials (the same
session fields used on the Audit Dashboard) — no separate sign-in step.

The **Consolidation Log** below lists every status change and box closure,
synced to the shared sheet the same way the Audit Dashboard's log is — tap
**Save to Sheet** to push anything not yet synced.

## The Google Sheet backend

One spreadsheet with four tabs, all created automatically by the script the
first time each is used:

- **AuditLog** — every count logged from every device (plus, layered on top
  by hand in the sheet itself: Mark In / Mark Out sections, Supervisor
  Initials + auto date-stamp via an `onEdit` trigger, and an Overdue
  section built from Sheets formulas — see the sheet directly for those,
  they aren't part of the base `Code.gs` below).
- **ProductMaster** — the shared catalog.
- **ConsolMaster** — the pasted HQ consolidation list (Description, Colour,
  Generic Material, ECC Generic Material, Destination, Total), keyed by ECC
  Generic Material.
- **ConsolLog** — every consolidation status change and box closure.

Setup, if you're starting fresh or need to redeploy:

1. Create a Google Sheet (or use an existing one).
2. Extensions → Apps Script, replace everything in `Code.gs` with:

   ```javascript
   function doPost(e) {
     const body = JSON.parse(e.postData.contents);
     if (body.type === "master") return handleMasterPost(body);
     if (body.type === "consolmaster") return handleConsolMasterPost(body);
     if (body.type === "consollog") return handleConsolLogPost(body);
     return handleAuditPost(body);
   }

   function doGet(e) {
     const sheetParam = (e.parameter.sheet || "auditlog").toLowerCase();
     const sheetsByParam = {
       master: ["ProductMaster", MASTER_HEADER],
       consolmaster: ["ConsolMaster", CONSOL_MASTER_HEADER],
       consollog: ["ConsolLog", CONSOL_LOG_HEADER],
       auditlog: ["AuditLog", AUDIT_HEADER],
     };
     const [name, header] = sheetsByParam[sheetParam] || sheetsByParam.auditlog;
     return jsonResponse(sheetToObjects(getOrCreateSheet(name, header)));
   }

   const AUDIT_HEADER = ["id", "date", "initials", "sku", "upc", "style", "description", "expected", "counted", "variance", "result", "timestamp"];
   const MASTER_HEADER = ["sku", "upc", "dept", "style", "color", "size", "description", "updatedAt"];
   const CONSOL_MASTER_HEADER = ["eccMaterial", "description", "color", "genericMaterial", "destination", "total", "updatedAt"];
   const CONSOL_LOG_HEADER = ["id", "entryType", "date", "initials", "eccMaterial", "description", "color", "status", "size", "unitsOut", "referenceNumber", "timestamp"];

   function handleAuditPost(entry) {
     const sheet = getOrCreateSheet("AuditLog", AUDIT_HEADER);
     // Parse as local midnight (not UTC) so the date doesn't shift a day when displayed,
     // and write real Date objects — plain strings don't reliably become real Sheets
     // dates, which breaks date-based formulas like the Overdue section's MAXIFS.
     const auditDate = entry.date ? new Date(entry.date + "T00:00:00") : "";
     const timestamp = entry.timestamp ? new Date(entry.timestamp) : "";
     const row = AUDIT_HEADER.map((key) => {
       if (key === "date") return auditDate;
       if (key === "timestamp") return timestamp;
       return entry[key];
     });
     sheet.appendRow(row);
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

   // Matches ConsolMaster rows by ECC Generic Material — unique per style/colour.
   function handleConsolMasterPost(item) {
     const sheet = getOrCreateSheet("ConsolMaster", CONSOL_MASTER_HEADER);
     const data = sheet.getDataRange().getValues();
     let rowIndex = -1;
     for (let i = 1; i < data.length; i++) {
       if (data[i][0] === item.eccMaterial) { rowIndex = i + 1; break; }
     }
     const row = [item.eccMaterial, item.description || "", item.color || "", item.genericMaterial || "", item.destination || "", item.total || 0, new Date().toISOString()];
     if (rowIndex === -1) sheet.appendRow(row);
     else sheet.getRange(rowIndex, 1, 1, row.length).setValues([row]);
     return jsonResponse({ ok: true });
   }

   function handleConsolLogPost(entry) {
     const sheet = getOrCreateSheet("ConsolLog", CONSOL_LOG_HEADER);
     const consolDate = entry.date ? new Date(entry.date + "T00:00:00") : "";
     const timestamp = entry.timestamp ? new Date(entry.timestamp) : "";
     const row = CONSOL_LOG_HEADER.map((key) => {
       if (key === "date") return consolDate;
       if (key === "timestamp") return timestamp;
       return entry[key];
     });
     sheet.appendRow(row);
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

   If your live script already has the Mark In/Out/Overdue additions on top
   of `handleAuditPost` (via a helper like `appendToSection` instead of plain
   `appendRow`, plus `ensureDashboardHeaders` and an `onEdit` trigger), keep
   those — just add the `CONSOL_MASTER_HEADER`/`CONSOL_LOG_HEADER` constants,
   the two new handler functions, and the `doPost`/`doGet` routing shown
   above; nothing about the audit dashboard sections needs to change.

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
(`localStorage`) — there's no need to share those. Product Master, the audit
log, the consolidation list, and the consolidation log are all backed by the
Sheet and sync automatically:

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

**Reliability:** every request to the Sheet (reads and writes) automatically
retries up to 3 times with a short backoff before giving up — Apps Script
Web Apps occasionally drop or time out an individual request under load,
and this clears most of those without anyone needing to notice or retry by
hand. Batch operations (bulk import, Save to Sheet, the Packed Box upload)
also keep going through the rest of the batch if one entry still fails
after its retries, instead of stopping the whole batch at the first
failure.

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
