# Oakridge Ops Suite

An offline-friendly web app for store associates: look up security-tag
placement by style, run physical inventory counts, consolidate product for
HQ, and log incoming shipments — all against a shared catalog. It installs
to the home screen like an app via Safari's "Add to Home Screen." There's
no backend to run — the catalog, audit log, and every other tab's data all
live in one Google Sheet, read and written directly from the browser via a
small Apps Script.

## Signing in

Opening the app always starts with a full-screen **"Who's Working?"**
prompt — pick your initials from the dropdown and tap Continue before
anything else loads. This is deliberately required on every fresh load
(not just once and remembered), specifically so a shared device changing
hands between staff can't keep running under the previous person's
initials. The date is never asked for or editable anywhere — every
action (a count, a consolidation, a receiving scan) is always stamped
with the actual current date automatically. The staff roster lives in
column J of the "ProductMaster" sheet tab (see below) — edit it directly
in Sheets, or tap **+ Add User** on the login screen itself to add a new
person's initials without leaving the app. `STAFF_INITIALS_FALLBACK` in
`js/storage.js` is only a last-resort list for a device that's never
successfully fetched the roster at least once.

## The seven tabs

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

1. Tap **📷 Scan Product to Count** (date/initials are already set from
   signing in).
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
  Master has on file for that item's Style SKU — pick a size/colour, enter
  units, and tap **+ Add Size**; repeat for every size that's actually
  short (it's common for more than one size of a style to need marking
  out) before tapping **Save**, which pushes every added size in one go,
  straight to the **AuditLog's shared Mark Out section** by UPC, the same
  queue a discrepant physical count feeds. (Marking product *in* isn't
  needed here — anything actually on hand gets consolidated through the normal process
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

### 6. Floor Replen
Two sections built around a shared "items sold" export.

**Check Floor** — someone exports the "items sold" list from MAO (Gender,
Clothing Category, Model Name, Color, Size, SKU, Quantity Sold, On Hand
Quantity) and pastes it directly into the **"FloorRestock"** tab of the
Google Sheet, same pattern as ConsolMaster — the app never writes the
import itself, only reads it. Each row shows a **Needed** / **Not Needed**
button:

- **Not Needed** — stages it straight into the holding section below.
- **Needed** — opens a picker of the core sizes (S, M, L, 30, 32, 34, 2, 4,
  6) or **Other** (any size is fine, just keep the minimum-three-on-the-floor
  rule satisfied) — check every size that's actually needed (more than one
  is common) before saving.

Both decisions land in a **holding** list first — nothing hits the sheet
until you tap **Update**, which commits every staged decision in one
request: it writes Status/Checked By/Checked Date back onto the matching
FloorRestock row (a row with any Status set drops off the Check Floor list
— that's the qualifier that keeps the page decluttered) and, for every
"Needed" decision, appends one new FloorRestock row for each *additional*
size checked beyond the row's own (Quantity Sold/On Hand left blank on
those — they were never actually sold, they're purely a Replen placeholder).
The moment Update succeeds, the **Last Floor Check** stamp updates to the
current date/time and your initials — that's the only thing that moves it.

**Replen** is the picking list — every FloorRestock row with Status
"Needed" shows here until it's dealt with. Check off **Picked** once it's
actually placed on the floor, or **Out of Stock** if there's none in the
back — both just update that same row's Status (to "Picked" or "Out of
Stock"), and Out of Stock also stamps the row's 86 column. Like Check
Floor, these stage into a holding list first; tapping **Update** commits
the whole batch in one request. Anything marked Out of Stock disappears
from Replen and reappears on the **86 Board**.

### 7. 86 Board
Every FloorRestock row with 86 set and RESTOCKED still blank, with the
date/time it was marked. Tap **Restocked** once it's actually back on the
floor — that stamps the row's RESTOCKED column immediately and removes it
from the board.

## The Google Sheet backend

One spreadsheet with seven tabs:

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
  — the app reads those exact column names. Column J (10th, with a gap at
  I) is a second, unrelated list bolted onto the same tab: the staff login
  roster, one initials value per row starting at J2 (J1 is its own header
  label). The app reads the whole column and appends to it (via **+ Add
  User** on the login screen), independent of however far the product
  data in A:H extends.
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
- **FloorRestock** — **not created or written by the app at all**, same as
  ConsolMaster, and the *only* sheet behind Floor Replen/86 Board — there is
  no separate app-managed tab for any of it. Paste the MAO "items sold"
  export straight into this tab yourself, then add five empty columns after
  it for the app to write into:
  `GENDER / CLOTHING CATEGORY / MODEL NAME / COLOR / SIZE / SKU / QUANTITY
  SOLD / ON HAND QUANTITY / STATUS / CHECKED BY / CHECKED DATE / 86 /
  RESTOCKED`. The app only reads the first eight columns. STATUS is a single
  lifecycle field the whole feature drives off of: blank (shows in Check
  Floor) → `Not Needed` (done) or `Needed` (shows in Replen) → `Picked`
  (done) or `Out of Stock` (also stamps 86, shows on the 86 Board) →
  eventually RESTOCKED gets stamped too, which clears it off the 86 Board.
  CHECKED BY/CHECKED DATE are only ever touched by a Check Floor decision,
  not by picking/restocking — those two steps don't currently record who
  did them, just the 86/RESTOCKED timestamps. A "Needed" decision that
  checks sizes beyond the row's own size appends one new row per extra
  size (Quantity Sold/On Hand left blank, Status "Needed") — those rows
  are the Replen queue entries for sizes that were never actually sold.

Setup, if you're starting fresh or need to redeploy:

1. Create a Google Sheet (or use an existing one).
2. Extensions → Apps Script, replace everything in `Code.gs` with:

   ```javascript
   function doPost(e) {
     const body = JSON.parse(e.postData.contents);
     if (body.type === "master") return handleMasterPost(body);
     if (body.type === "consolboxclose") return handleConsolBoxClose(body);
     if (body.type === "consolmarkoutbatch") return handleConsolMarkoutBatch(body);
     if (body.type === "receivingimport") return handleReceivingImportPost(body);
     if (body.type === "receivingstatus") return handleReceivingStatusPost(body);
     if (body.type === "checkfloorupdate") return handleCheckFloorUpdate(body);
     if (body.type === "floorpickupdate") return handleFloorPickUpdate(body);
     if (body.type === "floor86restock") return handleFloor86Restock(body);
     if (body.type === "staffadd") return handleStaffAdd(body);
     return handleAuditPost(body);
   }

   function doGet(e) {
     const sheetParam = (e.parameter.sheet || "auditlog").toLowerCase();

     // The staff roster (login gate dropdown) is a plain list of strings
     // from one column, not row objects, so it doesn't fit the two shared
     // shapes below — handled separately. See getStaffInitialsList().
     if (sheetParam === "staff") {
       return jsonResponse(getStaffInitialsList());
     }

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
       floorrestock: ["FloorRestock", FLOOR_RESTOCK_HEADER],
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
   // Defensive fallback only — FloorRestock already exists with this exact
   // header row (plus the five trailing columns staff add themselves), and
   // is hand-managed directly in Sheets like ConsolMaster; the app never
   // creates it.
   const FLOOR_RESTOCK_HEADER = ["GENDER", "CLOTHING CATEGORY", "MODEL NAME", "COLOR", "SIZE", "SKU", "QUANTITY SOLD", "ON HAND QUANTITY", "STATUS", "CHECKED BY", "CHECKED DATE", "86", "RESTOCKED"];

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

   // The staff roster (login gate dropdown) lives in column J (10th) of
   // ProductMaster — completely independent of the product columns in A:H,
   // just a plain list of initials, one per row, starting at J2 (J1 is its
   // own header label, auto-set by handleStaffAdd the first time someone's
   // added). Kept on this tab instead of a new one, same as bolting extra
   // columns onto FloorRestock elsewhere in this app.
   function getStaffInitialsList() {
     const sheet = getOrCreateSheet("ProductMaster", MASTER_HEADER);
     const lastRow = sheet.getLastRow();
     if (lastRow < 2) return [];
     const values = sheet.getRange(2, 10, lastRow - 1, 1).getValues();
     return values.map((r) => String(r[0] || "").trim()).filter(Boolean);
   }

   // Appends one new initials value to column J. Finds the actual last
   // non-blank row within column J specifically (not sheet.getLastRow(),
   // which reflects the much longer product data in A:H, and not just a
   // count of existing entries, in case of gaps) so a new entry always
   // lands right after the existing roster.
   function handleStaffAdd(body) {
     const initials = (body.initials || "").trim();
     if (!initials) return jsonResponse({ ok: false, error: "Missing initials." });

     const sheet = getOrCreateSheet("ProductMaster", MASTER_HEADER);
     if (!sheet.getRange(1, 10).getValue()) sheet.getRange(1, 10).setValue("STAFF INITIALS");

     const existing = getStaffInitialsList();
     if (existing.some((i) => i.toUpperCase() === initials.toUpperCase())) {
       return jsonResponse({ ok: true, added: false, reason: "already exists" });
     }

     const lastRow = sheet.getLastRow();
     let lastUsedRow = 1; // the header row
     if (lastRow >= 2) {
       const colJ = sheet.getRange(2, 10, lastRow - 1, 1).getValues();
       colJ.forEach((r, i) => {
         if (String(r[0] || "").trim() !== "") lastUsedRow = i + 2;
       });
     }

     sheet.getRange(lastUsedRow + 1, 10).setValue(initials);
     return jsonResponse({ ok: true, added: true });
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

   // Finds the FloorRestock row matching sku+size AND currently in the
   // lifecycle state the caller expects (a predicate over its STATUS/86/
   // RESTOCKED values), or null. sku+size alone is NOT a stable key: the
   // same product can sell out, get restocked, and sell out again, leaving
   // multiple rows sharing a sku+size at different points in the
   // blank -> Needed -> Picked/Out of Stock -> Restocked lifecycle.
   // Scoping every match to the row actually in the expected state (e.g.
   // only a row still "Needed" is eligible for a pick decision) stops a
   // stale/older row from getting updated instead of the current one.
   function findFloorRestockRow(sku, size, statePredicate) {
     const sheet = getOrCreateSheet("FloorRestock", FLOOR_RESTOCK_HEADER);
     const headerRow = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
     const skuCol = findColumnIndex(headerRow, "SKU");
     const sizeCol = findColumnIndex(headerRow, "SIZE");
     const statusCol = findColumnIndex(headerRow, "STATUS");
     const col86 = findColumnIndex(headerRow, "86");
     const restockedCol = findColumnIndex(headerRow, "RESTOCKED");
     if (skuCol === -1) return null;
     const data = sheet.getDataRange().getValues();
     for (let i = 1; i < data.length; i++) {
       if (String(data[i][skuCol - 1]) !== String(sku)) continue;
       if (sizeCol !== -1 && String(data[i][sizeCol - 1]) !== String(size)) continue;
       const state = {
         status: statusCol !== -1 ? String(data[i][statusCol - 1] || "").trim() : "",
         flag86: col86 !== -1 ? String(data[i][col86 - 1] || "").trim() : "",
         restocked: restockedCol !== -1 ? String(data[i][restockedCol - 1] || "").trim() : "",
       };
       if (statePredicate && !statePredicate(state)) continue;
       return { sheet, headerRow, rowIndex: i + 1, row: data[i] };
     }
     return null;
   }

   // Commits every staged Check Floor decision in one request. body.decisions
   // is an array of { sku, size, status: "Needed"|"Not Needed", sizes: [...] }.
   // FloorRestock is hand-managed (like ConsolMaster), so its columns are
   // found by name via findColumnIndex, not a fixed position — staff must
   // have added the Status/Checked By/Checked Date/86/Restocked columns
   // themselves. A "Needed" decision also appends one new FloorRestock row
   // for every size checked *besides* the row's own size — those become
   // Replen queue entries for sizes that were never actually sold (Quantity
   // Sold/On Hand left blank so they're easy to spot as placeholders). Only
   // matches a row with a still-blank Status — that's what makes a fresh
   // re-paste of the same sku+size (after an earlier sale of it already
   // ran the whole lifecycle) land on the new row, not the old one.
   function handleCheckFloorUpdate(body) {
     const decisions = body.decisions || [];
     if (decisions.length === 0) return jsonResponse({ ok: true, updated: 0 });

     const timestamp = new Date();
     const newRows = [];
     let updated = 0;

     decisions.forEach((d) => {
       const match = findFloorRestockRow(d.sku, d.size, (s) => s.status === "");
       if (!match) return;
       const { sheet, headerRow, rowIndex, row } = match;
       const skuCol = findColumnIndex(headerRow, "SKU");
       const sizeCol = findColumnIndex(headerRow, "SIZE");
       const genderCol = findColumnIndex(headerRow, "GENDER");
       const categoryCol = findColumnIndex(headerRow, "CLOTHING CATEGORY");
       const descCol = findColumnIndex(headerRow, "MODEL NAME");
       const colorCol = findColumnIndex(headerRow, "COLOR");
       const statusCol = findColumnIndex(headerRow, "STATUS");
       const checkedByCol = findColumnIndex(headerRow, "CHECKED BY");
       const checkedDateCol = findColumnIndex(headerRow, "CHECKED DATE");
       if (statusCol === -1 || checkedByCol === -1 || checkedDateCol === -1) return;

       sheet.getRange(rowIndex, statusCol).setValue(d.status || "");
       sheet.getRange(rowIndex, checkedByCol).setValue(body.initials || "");
       sheet.getRange(rowIndex, checkedDateCol).setValue(timestamp);
       updated++;

       if (d.status === "Needed") {
         const ownSize = sizeCol !== -1 ? row[sizeCol - 1] : "";
         const extraSizes = (d.sizes || []).filter((size) => String(size) !== String(ownSize));
         extraSizes.forEach((size) => {
           const newRow = new Array(headerRow.length).fill("");
           if (genderCol !== -1) newRow[genderCol - 1] = row[genderCol - 1];
           if (categoryCol !== -1) newRow[categoryCol - 1] = row[categoryCol - 1];
           if (descCol !== -1) newRow[descCol - 1] = row[descCol - 1];
           if (colorCol !== -1) newRow[colorCol - 1] = row[colorCol - 1];
           if (sizeCol !== -1) newRow[sizeCol - 1] = size;
           newRow[skuCol - 1] = d.sku;
           newRow[statusCol - 1] = "Needed";
           newRow[checkedByCol - 1] = body.initials || "";
           newRow[checkedDateCol - 1] = timestamp;
           newRows.push(newRow);
         });
       }
     });

     if (newRows.length > 0) {
       const sheet = getOrCreateSheet("FloorRestock", FLOOR_RESTOCK_HEADER);
       sheet.getRange(sheet.getLastRow() + 1, 1, newRows.length, FLOOR_RESTOCK_HEADER.length).setValues(newRows);
     }

     return jsonResponse({ ok: true, updated: updated });
   }

   // Commits a batch of picking decisions in one request. body.decisions is
   // an array of { sku, size, action: "picked"|"outOfStock" } — sets Status
   // to "Picked" or "Out of Stock" on the matching FloorRestock row, and
   // Out of Stock also stamps that row's 86 column so it shows on the
   // 86 Board. Only matches a row whose Status is still "Needed" — see
   // findFloorRestockRow's comment for why sku+size alone isn't enough.
   function handleFloorPickUpdate(body) {
     const timestamp = new Date();
     const decisions = body.decisions || [];
     let updated = 0;
     decisions.forEach((d) => {
       const match = findFloorRestockRow(d.sku, d.size, (s) => s.status === "Needed");
       if (!match) return;
       const statusCol = findColumnIndex(match.headerRow, "STATUS");
       const col86 = findColumnIndex(match.headerRow, "86");
       const status = d.action === "picked" ? "Picked" : "Out of Stock";
       if (statusCol !== -1) match.sheet.getRange(match.rowIndex, statusCol).setValue(status);
       if (d.action === "outOfStock" && col86 !== -1) match.sheet.getRange(match.rowIndex, col86).setValue(timestamp);
       updated++;
     });
     return jsonResponse({ ok: true, updated: updated });
   }

   // Closes out one or more 86 Board entries as restocked. body.items is an
   // array of { sku, size } — stamps the matching FloorRestock row's
   // RESTOCKED column, which is what drops it off the 86 Board. Only
   // matches a row that's actually still on the board (86 set, RESTOCKED
   // still blank) — see findFloorRestockRow's comment for why sku+size
   // alone isn't enough.
   function handleFloor86Restock(body) {
     const timestamp = new Date();
     const items = body.items || [];
     let updated = 0;
     items.forEach((it) => {
       const match = findFloorRestockRow(it.sku, it.size, (s) => s.flag86 !== "" && s.restocked === "");
       if (!match) return;
       const restockedCol = findColumnIndex(match.headerRow, "RESTOCKED");
       if (restockedCol === -1) return;
       match.sheet.getRange(match.rowIndex, restockedCol).setValue(timestamp);
       updated++;
     });
     return jsonResponse({ ok: true, updated: updated });
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

   // "Needs Adjustment" for one or more sizes of the same style, submitted
   // together in one request (body.items = [{ upc, size, units,
   // productDescription }, ...]): logs each in the consolidation log,
   // pushes each chosen UPC/units into the AuditLog's existing shared Mark
   // Out section (same queue regular audit shrink uses — reuse your own
   // appendToSection helper if the column start differs; this assumes Mark
   // Out starts at column U (21), 6 columns wide: Date, UPC, Description,
   // Units to Remove, Lead Initials, Date Complete), and flags the
   // ConsolMaster row Processed once at the end.
   function handleConsolMarkoutBatch(body) {
     const date = body.date ? new Date(body.date + "T00:00:00") : new Date();
     const items = body.items || [];
     const auditSheet = getOrCreateSheet("AuditLog", AUDIT_HEADER);

     items.forEach((item) => {
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
         size: item.size || "",
         unitsOut: item.units || 0,
       });

       appendToSection(auditSheet, 21, 6, [date, item.upc || "", item.productDescription || "", item.units || 0, "", ""]);
     });

     markConsolProcessed(body.eccMaterial);

     return jsonResponse({ ok: true, items: items.length });
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
- **Floor Restock/Replen decisions** (Check Floor's Update, Replen's Update,
  and 86 Board's Restocked) push immediately and atomically, same as
  consolidation actions — if the request fails, nothing staged is lost, so
  it's always safe to just try again. **The FloorRestock import itself is
  never written by the app** either — it's pasted directly into that sheet
  tab, same as ConsolMaster, and only read on boot/refresh.
- **The 🔄 button in the header** (top right, present on every tab) re-pulls
  every sheet-backed tab (Product Master, audit history, ConsolMaster,
  ConsolLog, ReceivingLog, FloorRestock) in one go and re-renders whatever
  tab is currently open — the same fetches boot already does, just
  re-triggerable on demand instead of needing to close the app and log back
  in to force a refresh.
- **Adding a user** (the login screen's **+ Add User**) pushes immediately,
  same as a new catalog product — it needs a connection, since the whole
  point is to land in the shared roster for every device.

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
