# Store Audit Tool

An offline-friendly web app for store associates: look up security-tag
placement by style, and run physical inventory counts against a shared
catalog. It installs to the home screen like an app via Safari's "Add to
Home Screen." There's no backend to run — the catalog and audit log both
live in one Google Sheet, read and written directly from the browser via a
small Apps Script.

## The five tabs

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
For HQ-driven consolidation events. **The HQ export itself is pasted
directly into the "ConsolMaster" tab of the Google Sheet, not into the
app** — that keeps it in clean, native Excel columns for reliable
referencing instead of round-tripping through a text paste box. The app
only ever reads that sheet: tap **🔄 Refresh from Sheet** after pasting a
new list in to pull it into the app. ConsolMaster's columns are **Material,
Color, Style SKU, ECC Generic Material, Destination, Total, Processed** —
matching is by **ECC Generic Material** (unique per style/colour), and
**Style SKU** must match a style already in Product Master for the
Needs Adjustment flow below to find its sizes.

Every item shows a **Status** dropdown:

- **Completed** — moves it into the **Packed Box** section below (it's a
  physical item that's actually going in the box being packed right now).
- **Needs Adjustment** — something showed in MAO during consolidation that
  couldn't be found physically. Opens a picker of every size/colour Product
  Master has on file for that item's Style SKU — pick the specific
  size/colour and how many units, and it's pushed straight to the
  **AuditLog's shared Mark Out section** by UPC, the same queue a
  discrepant physical count feeds. (Marking product *in* isn't needed here
  — anything actually on hand gets consolidated through the normal process
  anyway.)

The **Packed Box** is where Completed items collect while you're physically
packing them — a lightweight, per-device staging area. Made a mistake? Tap
**Remove** to send an item back to the list above. Once the box is actually
packed, tap **📷 Scan Packing Slip — Close Box** and scan its barcode/QR
(its reference number) — that logs every item currently in the box as
Completed under that reference number, plus one closure record, all in a
single request. The box then clears itself, ready for the next one. If the
request fails (no connection), the box's contents are untouched — just scan
again once you're back online.

Both actions — closing a box and marking an item out — also flag that row
**Processed** back on the ConsolMaster sheet. **Processed is the qualifier
for whether a line still shows on the website** — once set, the item drops
off the Items to Consolidate list (checked again on refresh, and updated
locally the instant the action succeeds).

The **Consolidation Log** below lists every status change and box closure —
there's nothing to manually sync here, every action pushes to the sheet
immediately when it happens.

### 5. Receiving Log
For incoming shipments. Paste the MAO shipment export — ETA, Package,
Origin, Receipt Type, For, Carrier, PO # (repeating, no blank line between
blocks) — into the paste box and tap **Import / Update**. Only **ETA**
(expected date), **Package** (the barcode), and **PO #** are kept; the rest
are ignored. This pushes straight to the shared "ReceivingLog" sheet tab,
keyed by barcode — pasting the same box again just refreshes its PO/ETA.

Tap **📷 Scan Boxes** to start scanning — unlike the other scan buttons in
this app, **this camera stays open across multiple scans** instead of
closing after one, since you're usually working through a stack of boxes.
Each recognized barcode drops that box into the **Scanned — Holding**
section at the bottom (with live feedback right in the camera view), and
you close the camera yourself when done (**Done Scanning**).

No camera handy — working from a computer instead of a phone? Check the
box(es) next to the relevant rows in the Expected Boxes table and tap
**Add Selected to Holding** — it's the same effect as scanning them, and
the header checkbox selects/deselects everything currently shown.

Once one or more boxes are held, tap either:

- **Mark Physically Received** — the box arrived and is on the shelf.
- **Mark Received into MAO** — the box has been processed into the
  inventory system.

Both push to the sheet in one request, tagged with the current session's
Date/Initials (the same fields used on the Audit Dashboard). These are two
independent steps that typically happen at different times (and possibly by
different people) — a box can be marked Physically Received now and Received
into MAO later, by scanning it again in a second session. **A box only
disappears from the Expected Boxes list once it's been marked Received into
MAO** — being physically received alone just adds an "On shelf" note next to
it, since it's still awaiting the MAO step.

## The Google Sheet backend

One spreadsheet with five tabs:

- **AuditLog** — every count logged from every device, created automatically
  by the script. Plus, layered on top by hand in the sheet itself: Mark
  In / Mark Out sections, Supervisor Initials + auto date-stamp via an
  `onEdit` trigger, and an Overdue section built from Sheets formulas — see
  the sheet directly for those, they aren't part of the base `Code.gs`
  below. Consolidation mark-outs land in the same Mark Out section as
  regular audit shrink.
- **ProductMaster** — the shared catalog, created automatically by the
  script. Its header row has since been hand-edited to
  `SKU / UPC / DEPT / STYLE SKU / COLOR / SIZE / DESCRIPTION / UPDATED AT`
  — the app reads those exact column names.
- **ConsolMaster** — **not created or written by the app at all.** Paste the
  HQ export straight into this tab yourself, with header row `MATERIAL /
  COLOR / STYLE SKU / ECC GENERIC MATERIAL / DESTINATION / TOTAL /
  PROCESSED`. The app only reads it, and only ever writes the PROCESSED
  column (via the backend, when a box closes or an item is marked out).
- **ConsolLog** — every consolidation status change and box closure,
  created automatically by the script.
- **ReceivingLog** — one row per expected box, created automatically by the
  script and fully app-managed (unlike ConsolMaster, nothing here needs
  hand-editing). Columns: `barcode / po / expectedDate /
  physicallyReceivedDate / physicallyReceivedBy / receivedIntoMaoDate /
  receivedIntoMaoBy / updatedAt`.

Setup, if you're starting fresh or need to redeploy:

1. Create a Google Sheet (or use an existing one).
2. Extensions → Apps Script, replace everything in `Code.gs` with:

   ```javascript
   function doPost(e) {
     const body = JSON.parse(e.postData.contents);
     if (body.type === "master") return handleMasterPost(body);
     if (body.type === "consolboxclose") return handleConsolBoxClose(body);
     if (body.type === "consolmarkout") return handleConsolMarkout(body);
     if (body.type === "receivingimport") return handleReceivingImportPost(body);
     if (body.type === "receivingstatus") return handleReceivingStatusPost(body);
     return handleAuditPost(body);
   }

   function doGet(e) {
     const sheetParam = (e.parameter.sheet || "auditlog").toLowerCase();

     // AuditLog, ConsolLog, and ReceivingLog are fully app-managed — only
     // this app ever writes to them, always at fixed column positions (see
     // the *_HEADER arrays below). Read them back by POSITION, not by
     // matching the header row's text — renaming a header for readability
     // (e.g. "date" -> "DATE", or two columns both renamed "RECEIVER") can
     // never silently break a read again.
     const positionalSheets = {
       auditlog: ["AuditLog", AUDIT_HEADER],
       consollog: ["ConsolLog", CONSOL_LOG_HEADER],
       receiving: ["ReceivingLog", RECEIVING_HEADER],
     };
     if (positionalSheets[sheetParam]) {
       const [name, keys] = positionalSheets[sheetParam];
       return jsonResponse(sheetToObjectsByPosition(getOrCreateSheet(name, keys), keys));
     }

     // ProductMaster and ConsolMaster are hand-edited directly in Sheets —
     // their header text IS the contract, matched by name (see
     // sheetRowToMasterItem / sheetRowToConsolItem on the app side).
     const sheetsByParam = {
       master: ["ProductMaster", MASTER_HEADER],
       consolmaster: ["ConsolMaster", CONSOL_MASTER_HEADER],
     };
     const [name, header] = sheetsByParam[sheetParam] || sheetsByParam.master;
     return jsonResponse(sheetToObjects(getOrCreateSheet(name, header)));
   }

   const AUDIT_HEADER = ["id", "date", "initials", "sku", "upc", "style", "description", "expected", "counted", "variance", "result", "timestamp"];
   const MASTER_HEADER = ["sku", "upc", "dept", "style", "color", "size", "description", "updatedAt"];
   // Defensive fallback only — ConsolMaster already exists with this exact
   // header row, hand-edited directly in Sheets; the app never creates it.
   const CONSOL_MASTER_HEADER = ["MATERIAL", "COLOR", "STYLE SKU", "ECC GENERIC MATERIAL", "DESTINATION", "TOTAL", "PROCESSED"];
   const CONSOL_LOG_HEADER = ["id", "entryType", "date", "initials", "eccMaterial", "description", "color", "status", "size", "unitsOut", "referenceNumber", "timestamp"];
   const RECEIVING_HEADER = ["barcode", "po", "expectedDate", "physicallyReceivedDate", "physicallyReceivedBy", "receivedIntoMaoDate", "receivedIntoMaoBy", "updatedAt"];

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
     // Plain appendRow() is fine here — columns A:L are the main log and
     // nothing else shares that row space, unlike the Mark In/Out sections
     // further right. What actually matters in this function is the
     // variance block below: if you're pasting this over an existing
     // handleAuditPost, make sure that block survives — it's easy to lose
     // by copying just the "write the log row" half of this function,
     // which silently stops discrepant counts from ever reaching Mark
     // In/Mark Out.
     sheet.appendRow(row);

     // A nonzero variance means the physical count didn't match expected —
     // push it into the shared Mark In (over) or Mark Out (under) queue so
     // a supervisor can action it. Column 14 (N) = Mark In, column 21 (U)
     // = Mark Out, both 6 columns wide — adjust if your sections start
     // elsewhere.
     const variance = Number(entry.variance);
     if (variance !== 0) {
       const adjRow = [auditDate, entry.upc, entry.description, Math.abs(variance), "", ""];
       appendToSection(sheet, variance > 0 ? 14 : 21, 6, adjRow);
     }

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

   // Row index (1-based) of a ReceivingLog row by barcode, or -1. String()
   // both sides — a long digit-only barcode is exactly the kind of value
   // Sheets auto-types as a number rather than text.
   function findReceivingRow(sheet, barcode) {
     const data = sheet.getDataRange().getValues();
     for (let i = 1; i < data.length; i++) {
       if (String(data[i][0]) === String(barcode)) return i + 1;
     }
     return -1;
   }

   // Upserts one expected box by barcode — only ever touches the
   // expected-shipment facts (po/expectedDate), never the received-status
   // columns, so re-importing a box can't accidentally wipe real status.
   // A 16-digit barcode is exactly the kind of value Sheets auto-detects
   // as a NUMBER on write (even though the app sends it as a string) and
   // then displays in scientific notation once it's long enough — "@" is
   // Sheets' Plain Text format code, which stops that auto-detection for
   // this column entirely. Cheap to call every time; harmless if already set.
   function ensurePlainTextColumn(sheet, col) {
     sheet.getRange(1, col, sheet.getMaxRows(), 1).setNumberFormat("@");
   }

   function handleReceivingImportPost(item) {
     const sheet = getOrCreateSheet("ReceivingLog", RECEIVING_HEADER);
     ensurePlainTextColumn(sheet, 1); // barcode
     ensurePlainTextColumn(sheet, 2); // po
     const rowIndex = findReceivingRow(sheet, item.barcode);
     const now = new Date().toISOString();
     if (rowIndex === -1) {
       sheet.appendRow([item.barcode, item.po || "", item.expectedDate || "", "", "", "", "", now]);
     } else {
       sheet.getRange(rowIndex, 2, 1, 2).setValues([[item.po || "", item.expectedDate || ""]]);
       sheet.getRange(rowIndex, 8).setValue(now);
     }
     return jsonResponse({ ok: true });
   }

   // Marks a batch of scanned boxes "physical" (physicallyReceived*, cols
   // D:E) or "mao" (receivedIntoMao*, cols F:G) in one request — the app
   // sends every barcode from its holding list together instead of one
   // request per box.
   function handleReceivingStatusPost(body) {
     const sheet = getOrCreateSheet("ReceivingLog", RECEIVING_HEADER);
     const date = body.date ? new Date(body.date + "T00:00:00") : new Date();
     const initials = body.initials || "";
     const dateCol = body.status === "mao" ? 6 : 4;
     (body.barcodes || []).forEach((barcode) => {
       const rowIndex = findReceivingRow(sheet, barcode);
       if (rowIndex === -1) return;
       sheet.getRange(rowIndex, dateCol, 1, 2).setValues([[date, initials]]);
     });
     return jsonResponse({ ok: true, updated: (body.barcodes || []).length });
   }

   // Looks up a header's column by name (1-based) instead of a hardcoded
   // index, so it keeps working if ConsolMaster's columns are ever reordered.
   function findColumnIndex(headerRow, name) {
     const idx = headerRow.findIndex((h) => (h || "").toString().trim().toUpperCase() === name.toUpperCase());
     return idx === -1 ? -1 : idx + 1;
   }

   // Flags one ConsolMaster row PROCESSED by ECC Generic Material — this is
   // the only way the app ever writes to ConsolMaster. Uses a TextFinder
   // scoped to just that one column instead of reading the whole sheet's
   // values into memory — keeps this fast as ConsolMaster grows.
   function markConsolProcessed(eccMaterial) {
     const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("ConsolMaster");
     if (!sheet || !eccMaterial || sheet.getLastRow() < 2) return;
     const headerRow = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
     const eccCol = findColumnIndex(headerRow, "ECC GENERIC MATERIAL");
     const processedCol = findColumnIndex(headerRow, "PROCESSED");
     if (eccCol === -1 || processedCol === -1) return;

     const match = sheet
       .getRange(2, eccCol, sheet.getLastRow() - 1, 1)
       .createTextFinder(eccMaterial)
       .matchEntireCell(true)
       .findNext();
     if (match) sheet.getRange(match.getRow(), processedCol).setValue("Processed");
   }

   function appendConsolLogRow(fields) {
     const sheet = getOrCreateSheet("ConsolLog", CONSOL_LOG_HEADER);
     sheet.appendRow(CONSOL_LOG_HEADER.map((key) => (key in fields ? fields[key] : "")));
   }

   // Closes a Packed Box: logs every item as Completed under one packing
   // slip reference number, flags each Processed on ConsolMaster, and adds
   // one closure record — all from a single request.
   function handleConsolBoxClose(body) {
     const date = body.date ? new Date(body.date + "T00:00:00") : new Date();
     const timestamp = new Date();
     const items = body.items || [];

     items.forEach((item) => {
       appendConsolLogRow({
         id: Utilities.getUuid(),
         entryType: "status",
         date: date,
         timestamp: timestamp,
         initials: body.initials || "",
         eccMaterial: item.eccMaterial || "",
         description: item.description || "",
         color: item.color || "",
         status: "Completed",
         referenceNumber: body.referenceNumber || "",
       });
       markConsolProcessed(item.eccMaterial);
     });

     appendConsolLogRow({
       id: Utilities.getUuid(),
       entryType: "packout",
       date: date,
       timestamp: timestamp,
       initials: body.initials || "",
       unitsOut: items.length,
       referenceNumber: body.referenceNumber || "",
     });

     return jsonResponse({ ok: true, processed: items.length });
   }

   // "Needs Adjustment": logs it in the consolidation log, flags the
   // ConsolMaster row Processed, and pushes the chosen UPC/units into the
   // AuditLog's existing shared Mark Out section (same queue regular audit
   // shrink uses) — reuse your own appendToSection helper if the column
   // start differs; this assumes Mark Out starts at column U (21), 6
   // columns wide: Date, UPC, Description, Units to Remove, Lead Initials,
   // Date Complete.
   function handleConsolMarkout(body) {
     const date = body.date ? new Date(body.date + "T00:00:00") : new Date();

     appendConsolLogRow({
       id: Utilities.getUuid(),
       entryType: "status",
       date: date,
       timestamp: new Date(),
       initials: body.initials || "",
       eccMaterial: body.eccMaterial || "",
       description: body.description || "",
       color: body.color || "",
       status: "Needs Adjustment",
       size: body.size || "",
       unitsOut: body.units || 0,
     });

     markConsolProcessed(body.eccMaterial);

     const auditSheet = getOrCreateSheet("AuditLog", AUDIT_HEADER);
     appendToSection(auditSheet, 21, 6, [date, body.upc || "", body.productDescription || "", body.units || 0, "", ""]);

     return jsonResponse({ ok: true });
   }

   // Only needed if your script doesn't already have one from the Mark
   // In/Out dashboard additions — appends within one section of a sheet
   // that has several independent sections side by side (so plain
   // appendRow(), which looks at the whole sheet's last row, can't be used).
   //
   // NOTE: an earlier version of this used getNextDataCell(DOWN) from the
   // header cell to avoid a full-column read. Don't do that — it has the
   // same gotcha as pressing Ctrl+Down in the Sheets UI: starting from a
   // filled cell (the header) with an EMPTY cell right below it and no
   // more data anywhere further down that column, it jumps to the
   // sheet's absolute last row instead of stopping just past the header —
   // so the new row gets written hundreds of rows down, off-screen, and
   // looks like nothing happened. A manual scan is the reliable way to do
   // this; getLastRow() (not getMaxRows()) keeps the read reasonably
   // tight without that failure mode.
   //
   // Also: if you still have an appendToSection with `lastRow + 2` in it
   // from even earlier, that's a separate off-by-one — it leaves one
   // blank row before every entry. This version uses `lastRow + 1`.
   function appendToSection(sheet, startCol, numCols, rowValues) {
     const numRows = Math.max(sheet.getLastRow(), 1);
     const values = sheet.getRange(1, startCol, numRows, numCols).getValues();
     let lastRow = 0;
     for (let i = 0; i < values.length; i++) {
       if (values[i].some((v) => v !== "")) lastRow = i + 1;
     }
     sheet.getRange(lastRow + 1, startCol, 1, numCols).setValues([rowValues]);
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

   // Same idea as sheetToObjects(), but keyed by a fixed array of names
   // (the sheet's actual column ORDER) instead of whatever text is
   // currently in row 1 — see the note on doGet() above for why.
   function sheetToObjectsByPosition(sheet, keys) {
     const values = sheet.getDataRange().getValues();
     if (values.length < 2) return [];
     return values
       .slice(1)
       .filter((row) => row[0] !== "")
       .map((row) => {
         const obj = {};
         keys.forEach((key, i) => (obj[key] = row[i]));
         return obj;
       });
   }

   function jsonResponse(obj) {
     return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
   }
   ```

   If your live script already has the Mark In/Out/Overdue additions on top
   of `handleAuditPost` (an `appendToSection` helper, `ensureDashboardHeaders`,
   an `onEdit` trigger), **keep your own `appendToSection` and skip the one
   above** — the version here is only a fallback for a script that doesn't
   have one yet. Otherwise, add everything shown: the `findColumnIndex`/
   `markConsolProcessed`/`appendConsolLogRow` helpers, the two new handler
   functions, and the `doPost`/`doGet` routing.

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
- **Consolidation actions** (closing a Packed Box, marking an item out) push
  immediately and atomically — there's nothing to manually sync. If the
  request fails, nothing changes (the box stays staged, the item stays
  actionable) so it's always safe to just try again.
- **The consolidation list itself is never written by the app** — it's
  pasted directly into the ConsolMaster sheet, and the app only ever reads
  it (on boot/refresh, or on demand via **🔄 Refresh from Sheet**).

Since the service worker's own cache-first behavior only applies to the
app's own files (HTML/CSS/JS), the Sheet fetch is always live, never served
from a stale cache.

**Reliability:** every request to the Sheet (reads and writes) automatically
retries up to 3 times with a short backoff before giving up — Apps Script
Web Apps occasionally drop or time out an individual request under load,
and this clears most of those without anyone needing to notice or retry by
hand. Batch operations (bulk import, Save to Sheet) also keep going through
the rest of the batch if one entry still fails after its retries, instead
of stopping the whole batch at the first
failure.

**Why a "Marking out…" status can outlast the sheet update:** the row
write happens partway through the Apps Script function and is visible in
the Sheet immediately, but the browser has no way to know that — it only
finds out once the *entire* function finishes (every write it does, plus
building the response) and the HTTP response makes it back. So there's an
inherent gap between "visible in the sheet" and "the app's request
resolves." That gap grows with how much work the script does per request
and with Apps Script's own execution/cold-start overhead, which the app
has no control over. `markConsolProcessed` above keeps its own read small
(a scoped `TextFinder` on just one column instead of the whole sheet), but
a couple of seconds of lag is normal for an Apps Script Web App and not
something a
static client PWA can eliminate entirely.

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
