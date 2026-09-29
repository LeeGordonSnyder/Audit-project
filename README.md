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
immediately when it happens. Every **Needs Adjustment** entry has its own
**Resolve** button — tapping it flips that entry's status on the ConsolLog
sheet and drops it off this list (same "qualifier" idea as Processed on
ConsolMaster above), without deleting the row itself. The row stays in the
sheet permanently either way — ConsolLog is a full history, same as the
Audit Dashboard's log — Resolve just stops the app from treating it as
something still needing attention. **🔄 Refresh from Sheet** pulls both
ConsolMaster and ConsolLog, so a Resolve done on another device shows up
here too.

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
section (with live feedback right in the camera view), and you close the
camera yourself when done (**Done Scanning**).

A barcode that isn't in the expected shipment list at all — never pasted
from MAO — stops the scan and opens a small **Box Not in Expected
Shipments** prompt instead of just showing an error: the barcode is
already filled in, so you only need to type the **PO #**. Saving adds it
to ReceivingLog (with no expected date, since MAO never gave one) and
drops it straight into holding, same as any other scan — tap **Scan
Boxes** again to keep going.

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
import itself, only reads it. Any row with Gender **"U"** (Unisex) is
dropped entirely on read — those are accessories stocked and restocked
straight from the floor, never from the back, so they never belong in
Check Floor, Replen, or the 86 Board; they simply never enter the app's
local data (see `isFloorRestockAccessoryGender` in `js/storage.js`), the
same as if they'd never been pasted at all. Each remaining row shows a
**Needed** / **Not Needed** button. Above the list, **Add a Product**
searches the catalog (SKU, UPC,
description, style — same matching Tag Lookup and the Audit Dashboard's
lookup use) for anything that wasn't on the "items sold" export — tapping
a result appends it as a new blank row here, for the same Needed/Not
Needed decision as anything pasted from MAO.

Right below that, **"Not in the catalog either?"** is for the person
actually checking the floor — they'll often spot something missing that's
neither on the sold list nor findable by search (sold the day before,
mis-scanned, whatever). Type a description, tap **Pick a Size…**, and
check every size that's actually needed (or type one under **Other**) —
same multi-select as the Needed picker below, because that's exactly what
this is standing in for. There's no real SKU for a hand-typed item, so the
app generates one behind the scenes (`MANUAL-...`) purely to key it
through the same sku+size matching every other Floor Replen action uses —
gender, category, and color are left blank, same as a catalog "Add a
Product," since nothing in the matching or lifecycle logic (Check Floor →
Replen → 86 Board) ever keys off those fields, only sku+size. Tapping
**Add** does two things: one immediate request (`floorrestockadd`, the
same one "Add a Product" uses) creates the row with the first size you
picked as its own size, then the Needed decision itself — including any
extra sizes beyond that first one — is staged into **Check Floor —
Holding** below, exactly like ticking Needed on any real row. It only
actually reaches the sheet when you tap **Update**, batched together with
whatever else is staged at that point — indistinguishable, once synced,
from a row that had been on the items sold list all along.

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

## Feedback

**💬 Leave Feedback!** sits in the header, above the tabs, so it's reachable
from anywhere in the app regardless of which tab is open. Tap it, type
whatever's on your mind, and tap **Submit** — it's appended as one row to
the **Feedback** sheet tab with your initials (from sign-in) and today's
date attached automatically. It's one-way: the app never reads Feedback
back, it's meant to be reviewed directly in the sheet.

## The Google Sheet backend

One spreadsheet with eight tabs:

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
  created automatically by the script. Rows are never deleted by the app —
  a "Needs Adjustment" row's STATUS column can flip to "Resolved" (via the
  Consolidation Log's Resolve button), but the row itself is permanent,
  same as AuditLog.
- **ReceivingLog** — one row per expected box, created automatically by the
  script and fully app-managed (unlike ConsolMaster, nothing here needs
  hand-editing). Columns: `barcode / po / expectedDate /
  physicallyReceivedDate / physicallyReceivedBy / receivedIntoMaoDate /
  receivedIntoMaoBy / updatedAt`. The barcode is written with a leading
  apostrophe (Sheets' force-literal-text escape) so a long digit string
  never renders in scientific notation — it'd be unscannable straight off
  the sheet otherwise. The apostrophe itself never shows up or gets stored;
  reading the cell back gives the plain digits.
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
  A row with GENDER "U" is filtered out entirely on the app's side when
  it's read (accessories stocked straight from the floor, not the back) —
  the sheet itself is untouched, so it's still there if the export is ever
  re-read some other way.
- **Feedback** — every note submitted from the header's **Leave Feedback!**
  button, created automatically by the script if it doesn't already exist.
  Columns: `id / date / initials / feedback / timestamp`. Fully app-managed
  and write-only from the app's side — nothing here needs hand-editing, and
  the app never reads it back. If you already created a tab named
  "Feedback" yourself, leave it completely empty (no header row) so the
  script writes this exact header the first time someone submits — a
  pre-existing header row in a different order won't be read from, but new
  rows will still be appended positionally underneath it, out of alignment
  with whatever's already there.

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
     if (body.type === "receivingimportbatch") return handleReceivingImportBatch(body);
     if (body.type === "receivingstatus") return handleReceivingStatusPost(body);
     if (body.type === "checkfloorupdate") return handleCheckFloorUpdate(body);
     if (body.type === "floorpickupdate") return handleFloorPickUpdate(body);
     if (body.type === "floor86restock") return handleFloor86Restock(body);
     if (body.type === "floorrestockadd") return handleFloorRestockAdd(body);
     if (body.type === "replenmanualadd") return handleReplenManualAdd(body);
     if (body.type === "staffadd") return handleStaffAdd(body);
     if (body.type === "feedback") return handleFeedbackPost(body);
     if (body.type === "auditbatch") return handleAuditBatchPost(body);
     if (body.type === "consollogresolve") return handleConsolLogResolve(body);
     return handleAuditPost(body);
   }

   // Short cache absorbs near-simultaneous refreshes from multiple devices
   // (two staff both tapping Refresh around the same time) without re-reading
   // the sheet twice. 10 seconds is short enough that any change is visible
   // everywhere well inside the time it'd take someone to notice and refresh
   // again -- if that staleness window is ever unwanted, delete the cache
   // lookup/put below and just `return jsonResponse(computeDoGetResult(sheetParam));`.
   const DOGET_CACHE_SECONDS = 10;

   function doGet(e) {
     const sheetParam = (e.parameter.sheet || "auditlog").toLowerCase();

     const cache = CacheService.getScriptCache();
     const cacheKey = "doGet:" + sheetParam;
     const cached = cache.get(cacheKey);
     if (cached) {
       return ContentService.createTextOutput(cached).setMimeType(ContentService.MimeType.JSON);
     }

     const result = computeDoGetResult(sheetParam);
     const json = JSON.stringify(result);
     try {
       cache.put(cacheKey, json, DOGET_CACHE_SECONDS);
     } catch (err) {
       // A single sheet's JSON can exceed CacheService's ~100KB per-key limit
       // on a big FloorRestock/ProductMaster export -- caching is a pure
       // speed bonus, so just skip it rather than fail the request.
     }
     return jsonResponse(result);
   }

   function computeDoGetResult(sheetParam) {
     // The staff roster (login gate dropdown) is a plain list of strings from
     // one column, not row objects, so it doesn't fit the two shared shapes
     // below -- handled separately. See getStaffInitialsList().
     if (sheetParam === "staff") {
       return getStaffInitialsList();
     }

     // AuditLog, ConsolLog, and ReceivingLog are fully app-managed -- only
     // this app ever writes to them, always at fixed column positions (see
     // the *_HEADER arrays below). Read them back by POSITION, not by
     // matching the header row's text -- renaming a header for readability
     // (e.g. "date" -> "DATE", or two columns both renamed "RECEIVER") can
     // never silently break a read again.
     const positionalSheets = {
       auditlog: ["AuditLog", AUDIT_HEADER],
       consollog: ["ConsolLog", CONSOL_LOG_HEADER],
       receiving: ["ReceivingLog", RECEIVING_HEADER],
     };
     if (positionalSheets[sheetParam]) {
       const [name, keys] = positionalSheets[sheetParam];
       return sheetToObjectsByPosition(getOrCreateSheet(name, keys), keys);
     }

     // ProductMaster and ConsolMaster are hand-edited directly in Sheets --
     // their header text IS the contract, matched by name (see
     // sheetRowToMasterItem / sheetRowToConsolItem on the app side).
     const sheetsByParam = {
       master: ["ProductMaster", MASTER_HEADER],
       consolmaster: ["ConsolMaster", CONSOL_MASTER_HEADER],
       floorrestock: ["FloorRestock", FLOOR_RESTOCK_HEADER],
     };
     const [name, header] = sheetsByParam[sheetParam] || sheetsByParam.master;
     return sheetToObjects(getOrCreateSheet(name, header));
   }

   const AUDIT_HEADER = ["id", "date", "initials", "sku", "upc", "style", "description", "expected", "counted", "variance", "result", "timestamp"];
   const MASTER_HEADER = ["sku", "upc", "dept", "style", "color", "size", "description", "updatedAt"];
   // Defensive fallback only -- ConsolMaster already exists with this exact
   // header row, hand-edited directly in Sheets; the app never creates it.
   const CONSOL_MASTER_HEADER = ["MATERIAL", "COLOR", "STYLE SKU", "ECC GENERIC MATERIAL", "DESTINATION", "TOTAL", "PROCESSED"];
   const CONSOL_LOG_HEADER = ["id", "entryType", "date", "initials", "eccMaterial", "description", "color", "status", "size", "unitsOut", "referenceNumber", "timestamp"];
   const RECEIVING_HEADER = ["barcode", "po", "expectedDate", "physicallyReceivedDate", "physicallyReceivedBy", "receivedIntoMaoDate", "receivedIntoMaoBy", "updatedAt"];
   const FEEDBACK_HEADER = ["id", "date", "initials", "feedback", "timestamp"];
   // Defensive fallback only -- FloorRestock already exists with this exact
   // header row (plus the five trailing columns staff add themselves), and
   // is hand-managed directly in Sheets like ConsolMaster; the app never
   // creates it.
   const FLOOR_RESTOCK_HEADER = ["GENDER", "CLOTHING CATEGORY", "MODEL NAME", "COLOR", "SIZE", "SKU", "QUANTITY SOLD", "ON HAND QUANTITY", "STATUS", "CHECKED BY", "CHECKED DATE", "86", "RESTOCKED"];

   // Memoized per execution -- SpreadsheetApp.getActiveSpreadsheet() is
   // itself an API call, and several handlers touch more than one sheet in a
   // single request, so fetching it once and reusing it removes those
   // redundant lookups. (Nothing to invalidate: a fresh execution gets a
   // fresh module scope, so this can never leak stale state across requests.)
   let _spreadsheet = null;
   function getSpreadsheet() {
     if (!_spreadsheet) _spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
     return _spreadsheet;
   }

   function getOrCreateSheet(name, header) {
     const ss = getSpreadsheet();
     let sheet = ss.getSheetByName(name);
     if (!sheet) sheet = ss.insertSheet(name);
     if (sheet.getLastRow() === 0) sheet.appendRow(header);
     return sheet;
   }

   function handleAuditPost(entry) {
     const sheet = getOrCreateSheet("AuditLog", AUDIT_HEADER);
     // Parse as local midnight (not UTC) so the date doesn't shift a day when displayed,
     // and write real Date objects -- plain strings don't reliably become real Sheets
     // dates, which breaks date-based formulas like the Overdue section's MAXIFS.
     const auditDate = entry.date ? new Date(entry.date + "T00:00:00") : "";
     const timestamp = entry.timestamp ? new Date(entry.timestamp) : "";
     const row = AUDIT_HEADER.map((key) => {
       if (key === "date") return auditDate;
       if (key === "timestamp") return timestamp;
       return entry[key];
     });
     sheet.appendRow(row);

     // A nonzero variance means the physical count didn't match expected --
     // push it into the shared Mark In (over) or Mark Out (under) queue so a
     // supervisor can action it. Column 14 (N) = Mark In, column 21 (U) =
     // Mark Out, both 6 columns wide -- adjust if your sections start
     // elsewhere.
     const variance = Number(entry.variance);
     if (variance !== 0) {
       const adjRow = [auditDate, entry.upc, entry.description, Math.abs(variance), "", ""];
       appendToSection(sheet, variance > 0 ? 14 : 21, 6, adjRow);
     }

     return jsonResponse({ ok: true });
   }

   // Batched version of handleAuditPost for "Save to Sheet": the client used
   // to POST one entry at a time in a sequential loop, each its own full
   // round trip -- a busy day's worth of unsynced counts could mean dozens of
   // requests, one at a time. One request for the whole batch turns that into
   // a single append (plus, at most, two more for any Mark In/Out rows).
   function handleAuditBatchPost(body) {
     const entries = body.entries || [];
     if (entries.length === 0) return jsonResponse({ ok: true, saved: 0 });

     const sheet = getOrCreateSheet("AuditLog", AUDIT_HEADER);
     const rows = [];
     const markInRows = [];
     const markOutRows = [];

     entries.forEach((entry) => {
       const auditDate = entry.date ? new Date(entry.date + "T00:00:00") : "";
       const timestamp = entry.timestamp ? new Date(entry.timestamp) : "";
       rows.push(
         AUDIT_HEADER.map((key) => {
           if (key === "date") return auditDate;
           if (key === "timestamp") return timestamp;
           return entry[key];
         })
       );

       const variance = Number(entry.variance);
       if (variance !== 0) {
         const adjRow = [auditDate, entry.upc, entry.description, Math.abs(variance), "", ""];
         (variance > 0 ? markInRows : markOutRows).push(adjRow);
       }
     });

     sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, AUDIT_HEADER.length).setValues(rows);
     appendRowsToSection(sheet, 14, 6, markInRows);
     appendRowsToSection(sheet, 21, 6, markOutRows);

     return jsonResponse({ ok: true, saved: entries.length });
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
   // ProductMaster -- completely independent of the product columns in A:H,
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
   // count of existing entries, in case of gaps) so a new entry always lands
   // right after the existing roster.
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

   // Appends one row to the Feedback sheet -- fully app-managed, positional,
   // same pattern as AuditLog/ConsolLog. Write-only: nothing ever reads this
   // back through doGet.
   function handleFeedbackPost(body) {
     const sheet = getOrCreateSheet("Feedback", FEEDBACK_HEADER);
     const date = body.date ? new Date(body.date + "T00:00:00") : new Date();
     const timestamp = body.timestamp ? new Date(body.timestamp) : new Date();
     sheet.appendRow([body.id || "", date, body.initials || "", body.feedback || "", timestamp]);
     return jsonResponse({ ok: true });
   }

   // Row index (1-based) of a ReceivingLog row by barcode, or -1. Scoped to
   // just the barcode column via TextFinder instead of reading every column
   // of every row into memory -- this is only used by the single-item import
   // path; the batch paths below read the barcode column once for the whole
   // batch instead of calling this per item.
   function findReceivingRowIndex(sheet, barcode) {
     const lastRow = sheet.getLastRow();
     if (lastRow < 2) return -1;
     const match = sheet.getRange(2, 1, lastRow - 1, 1).createTextFinder(String(barcode)).matchEntireCell(true).findNext();
     return match ? match.getRow() : -1;
   }

   // Cheap to call every time; harmless if already set. Bounded to the
   // sheet's actual used rows plus a little headroom, instead of
   // getMaxRows() -- on a sheet whose grid has been extended far past its
   // real data (common after repeated pastes/deletes), reformatting all the
   // way to getMaxRows() on every single call could itself take longer than
   // the write it's protecting.
   function ensurePlainTextColumn(sheet, col) {
     const rows = Math.max(sheet.getLastRow() + 20, 100);
     sheet.getRange(1, col, rows, 1).setNumberFormat("@");
   }

   function handleReceivingImportPost(item) {
     const sheet = getOrCreateSheet("ReceivingLog", RECEIVING_HEADER);
     ensurePlainTextColumn(sheet, 1); // barcode
     ensurePlainTextColumn(sheet, 2); // po
     const rowIndex = findReceivingRowIndex(sheet, item.barcode);
     const now = new Date().toISOString();
     // A leading apostrophe is Sheets' own escape for "force literal text" --
     // it's stripped from the stored/displayed value (getValue() reads back
     // the plain digits, no apostrophe), so nothing downstream needs to
     // change. Without it, a long digit string can still get auto-detected
     // as a NUMBER and rendered in scientific notation, unscannable directly
     // off the sheet.
     const barcodeText = "'" + item.barcode;
     if (rowIndex === -1) {
       sheet.appendRow([barcodeText, item.po || "", item.expectedDate || "", "", "", "", "", now]);
     } else {
       sheet.getRange(rowIndex, 2, 1, 2).setValues([[item.po || "", item.expectedDate || ""]]);
       sheet.getRange(rowIndex, 8).setValue(now);
     }
     return jsonResponse({ ok: true });
   }

   // Same as handleReceivingImportPost, but for a whole pasted shipment list
   // in one request instead of one request per box. The paste-import flow
   // used to fire one sequential doPost per box (a big shipment could easily
   // be 50-100+), each doing its own full-column scan -- that's what made a
   // big import feel slow. This reads the barcode column once, matches/
   // updates everything in memory (including de-duping a barcode that
   // appears twice in the same paste, so the second occurrence updates the
   // first instead of creating a second row), and writes in at most two
   // batched calls total.
   function handleReceivingImportBatch(body) {
     const items = body.items || [];
     if (items.length === 0) return jsonResponse({ ok: true, added: 0, updated: 0 });

     const sheet = getOrCreateSheet("ReceivingLog", RECEIVING_HEADER);
     ensurePlainTextColumn(sheet, 1);
     ensurePlainTextColumn(sheet, 2);

     const lastRow = sheet.getLastRow();
     const existing = lastRow > 1 ? sheet.getRange(2, 1, lastRow - 1, RECEIVING_HEADER.length).getValues() : [];
     const rowByBarcode = new Map(); // barcode -> index into `existing`
     existing.forEach((row, i) => rowByBarcode.set(String(row[0]), i));

     const dirty = new Set();
     const newRows = [];
     const newRowByBarcode = new Map(); // barcode -> index into `newRows`, for dupes within this same paste

     const now = new Date().toISOString();
     let added = 0;
     let updated = 0;

     items.forEach((item) => {
       const barcode = String(item.barcode);

       if (rowByBarcode.has(barcode)) {
         const i = rowByBarcode.get(barcode);
         existing[i][1] = item.po || "";
         existing[i][2] = item.expectedDate || "";
         existing[i][7] = now;
         dirty.add(i);
         updated++;
         return;
       }

       if (newRowByBarcode.has(barcode)) {
         const i = newRowByBarcode.get(barcode);
         newRows[i][1] = item.po || "";
         newRows[i][2] = item.expectedDate || "";
         newRows[i][7] = now;
         return;
       }

       newRows.push(["'" + barcode, item.po || "", item.expectedDate || "", "", "", "", "", now]);
       newRowByBarcode.set(barcode, newRows.length - 1);
       added++;
     });

     dirty.forEach((i) => {
       sheet.getRange(i + 2, 1, 1, RECEIVING_HEADER.length).setValues([existing[i]]);
     });
     if (newRows.length > 0) {
       sheet.getRange(lastRow + 1, 1, newRows.length, RECEIVING_HEADER.length).setValues(newRows);
     }

     return jsonResponse({ ok: true, added: added, updated: updated });
   }

   // Marks a batch of scanned boxes "physical" (physicallyReceived*, cols
   // D:E) or "mao" (receivedIntoMao*, cols F:G) in one request -- the app
   // sends every barcode from its holding list together instead of one
   // request per box. Reads the barcode column once for the whole batch
   // instead of re-scanning it per barcode.
   function handleReceivingStatusPost(body) {
     const sheet = getOrCreateSheet("ReceivingLog", RECEIVING_HEADER);
     const date = body.date ? new Date(body.date + "T00:00:00") : new Date();
     const initials = body.initials || "";
     const dateCol = body.status === "mao" ? 6 : 4;

     const lastRow = sheet.getLastRow();
     if (lastRow < 2) return jsonResponse({ ok: true, updated: 0 });
     const barcodeColumn = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
     const rowByBarcode = new Map();
     barcodeColumn.forEach((r, i) => rowByBarcode.set(String(r[0]), i + 2));

     let updated = 0;
     (body.barcodes || []).forEach((barcode) => {
       const rowIndex = rowByBarcode.get(String(barcode));
       if (!rowIndex) return;
       sheet.getRange(rowIndex, dateCol, 1, 2).setValues([[date, initials]]);
       updated++;
     });
     return jsonResponse({ ok: true, updated: updated });
   }

   // Column lookup shared by every FloorRestock handler -- previously each
   // one repeated its own block of findColumnIndex calls.
   function getFloorRestockColumns(headerRow) {
     return {
       sku: findColumnIndex(headerRow, "SKU"),
       size: findColumnIndex(headerRow, "SIZE"),
       gender: findColumnIndex(headerRow, "GENDER"),
       category: findColumnIndex(headerRow, "CLOTHING CATEGORY"),
       desc: findColumnIndex(headerRow, "MODEL NAME"),
       color: findColumnIndex(headerRow, "COLOR"),
       status: findColumnIndex(headerRow, "STATUS"),
       checkedBy: findColumnIndex(headerRow, "CHECKED BY"),
       checkedDate: findColumnIndex(headerRow, "CHECKED DATE"),
       flag86: findColumnIndex(headerRow, "86"),
       restocked: findColumnIndex(headerRow, "RESTOCKED"),
     };
   }

   // Loads FloorRestock's header + full body ONCE so a handler that processes
   // several decisions in one request (Check Floor Update, Replen Update, 86
   // Board Restocked) can find and patch every matching row purely in memory,
   // then write back only what actually changed in a couple of batched
   // calls -- replacing what used to be a full-sheet read PER decision (the
   // old findFloorRestockRow re-fetched the whole sheet every single call)
   // and a separate API round trip per cell written.
   //
   // sku+size alone is NOT a stable key: the same product can sell out, get
   // restocked, and sell out again, leaving multiple rows sharing a sku+size
   // at different points in the blank -> Needed -> Picked/Out of Stock ->
   // Restocked lifecycle. find()'s statePredicate scopes every match to the
   // row actually in the expected state, same as before.
   function loadFloorRestock() {
     const sheet = getOrCreateSheet("FloorRestock", FLOOR_RESTOCK_HEADER);
     const headerRow = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
     const lastRow = sheet.getLastRow();
     const body = lastRow > 1 ? sheet.getRange(2, 1, lastRow - 1, headerRow.length).getValues() : [];
     const cols = getFloorRestockColumns(headerRow);
     const dirty = new Set();
     const appended = [];

     return {
       sheet,
       headerRow,
       body,
       cols,
       find(sku, size, statePredicate) {
         for (let i = 0; i < body.length; i++) {
           const row = body[i];
           if (cols.sku === -1 || String(row[cols.sku - 1]) !== String(sku)) continue;
           if (cols.size !== -1 && String(row[cols.size - 1]) !== String(size)) continue;
           const state = {
             status: cols.status !== -1 ? String(row[cols.status - 1] || "").trim() : "",
             flag86: cols.flag86 !== -1 ? String(row[cols.flag86 - 1] || "").trim() : "",
             restocked: cols.restocked !== -1 ? String(row[cols.restocked - 1] || "").trim() : "",
           };
           if (statePredicate && !statePredicate(state)) continue;
           return i;
         }
         return -1;
       },
       patch(index) {
         dirty.add(index);
       },
       appendRow(row) {
         appended.push(row);
       },
       // Writes only what actually changed: one setValues() per patched row
       // (their positions in the sheet generally aren't contiguous, so they
       // can't be merged into a single call) plus one more for every appended
       // row together -- never rewrites rows nothing touched.
       save() {
         dirty.forEach((i) => {
           sheet.getRange(i + 2, 1, 1, headerRow.length).setValues([body[i]]);
         });
         if (appended.length > 0) {
           sheet.getRange(lastRow + 1, 1, appended.length, headerRow.length).setValues(appended);
         }
       },
     };
   }

   // Commits every staged Check Floor decision in one request. body.decisions
   // is an array of { sku, size, status: "Needed"|"Not Needed", sizes: [...] }.
   // FloorRestock is hand-managed (like ConsolMaster), so its columns are
   // found by name, not a fixed position -- staff must have added the
   // Status/Checked By/Checked Date/86/Restocked columns themselves. A
   // "Needed" decision also appends one new FloorRestock row for every size
   // checked *besides* the row's own size -- those become Replen queue
   // entries for sizes that were never actually sold (Quantity Sold/On Hand
   // left blank so they're easy to spot as placeholders). Only matches a row
   // with a still-blank Status -- that's what makes a fresh re-paste of the
   // same sku+size (after an earlier sale of it already ran the whole
   // lifecycle) land on the new row, not the old one.
   function handleCheckFloorUpdate(body) {
     const decisions = body.decisions || [];
     if (decisions.length === 0) return jsonResponse({ ok: true, updated: 0 });

     const fr = loadFloorRestock();
     const cols = fr.cols;
     const timestamp = new Date();
     let updated = 0;

     decisions.forEach((d) => {
       const idx = fr.find(d.sku, d.size, (s) => s.status === "");
       if (idx === -1) return;
       if (cols.status === -1 || cols.checkedBy === -1 || cols.checkedDate === -1) return;

       const row = fr.body[idx];
       row[cols.status - 1] = d.status || "";
       row[cols.checkedBy - 1] = body.initials || "";
       row[cols.checkedDate - 1] = timestamp;
       fr.patch(idx);
       updated++;

       if (d.status === "Needed") {
         const ownSize = cols.size !== -1 ? row[cols.size - 1] : "";
         const extraSizes = (d.sizes || []).filter((size) => String(size) !== String(ownSize));
         extraSizes.forEach((size) => {
           const newRow = new Array(fr.headerRow.length).fill("");
           if (cols.gender !== -1) newRow[cols.gender - 1] = row[cols.gender - 1];
           if (cols.category !== -1) newRow[cols.category - 1] = row[cols.category - 1];
           if (cols.desc !== -1) newRow[cols.desc - 1] = row[cols.desc - 1];
           if (cols.color !== -1) newRow[cols.color - 1] = row[cols.color - 1];
           if (cols.size !== -1) newRow[cols.size - 1] = size;
           newRow[cols.sku - 1] = d.sku;
           newRow[cols.status - 1] = "Needed";
           newRow[cols.checkedBy - 1] = body.initials || "";
           newRow[cols.checkedDate - 1] = timestamp;
           fr.appendRow(newRow);
         });
       }
     });

     fr.save();
     return jsonResponse({ ok: true, updated: updated });
   }

   // Appends one new FloorRestock row for a product that wasn't on the MAO
   // "items sold" export -- staff found it via the catalog lookup on Check
   // Floor. Quantity Sold/On Hand and Status are all left blank, so it lands
   // in the normal Check Floor list for a Needed/Not Needed decision, exactly
   // like a pasted row. Only needs the header row (for column positions),
   // never the sheet's full body -- a blind append, same as before.
   function handleFloorRestockAdd(body) {
     const sheet = getOrCreateSheet("FloorRestock", FLOOR_RESTOCK_HEADER);
     const headerRow = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
     const cols = getFloorRestockColumns(headerRow);
     if (cols.sku === -1) {
       return jsonResponse({ ok: false, error: "FloorRestock is missing a SKU column." });
     }

     const newRow = new Array(headerRow.length).fill("");
     if (cols.gender !== -1) newRow[cols.gender - 1] = body.gender || "";
     if (cols.desc !== -1) newRow[cols.desc - 1] = body.description || "";
     if (cols.color !== -1) newRow[cols.color - 1] = body.color || "";
     if (cols.size !== -1) newRow[cols.size - 1] = body.size || "";
     newRow[cols.sku - 1] = body.sku || "";

     sheet.appendRow(newRow);
     return jsonResponse({ ok: true });
   }

   // No longer called by the app -- manual Floor Replen entries moved into
   // the Check Floor / holding flow (floorrestockadd + checkfloorupdate)
   // instead, so they commit together with everything else staged there.
   // Left in place (routed but unreachable from the current app) rather
   // than pulled out, purely to avoid a redeploy with zero functional
   // effect -- safe to delete next time you're already editing this file.
   //
   // Adds one manually-typed product straight to Replen (Status "Needed") in
   // a single call. Idempotent by body.sku: the client generates a fresh
   // synthetic SKU per submission, so it can only already exist here if this
   // exact request got retried after already succeeding (postToSheet retries
   // anything it thinks failed, and Apps Script's doPost can be slow enough
   // to look dropped even when it isn't) -- in that case this just no-ops
   // instead of appending a duplicate row. A cheap TextFinder scoped to just
   // the SKU column checks that without reading the sheet's full body into
   // memory, since a fresh sku can only ever match zero or one row.
   function handleReplenManualAdd(body) {
     const sheet = getOrCreateSheet("FloorRestock", FLOOR_RESTOCK_HEADER);
     const headerRow = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
     const cols = getFloorRestockColumns(headerRow);
     if (cols.sku === -1 || cols.status === -1) {
       return jsonResponse({ ok: false, error: "FloorRestock is missing a SKU or Status column." });
     }

     const lastRow = sheet.getLastRow();
     const alreadyExists =
       lastRow >= 2 &&
       sheet.getRange(2, cols.sku, lastRow - 1, 1).createTextFinder(String(body.sku)).matchEntireCell(true).findNext() !== null;
     if (alreadyExists) {
       return jsonResponse({ ok: true, added: false, reason: "already exists" });
     }

     const newRow = new Array(headerRow.length).fill("");
     if (cols.desc !== -1) newRow[cols.desc - 1] = body.description || "";
     if (cols.size !== -1) newRow[cols.size - 1] = body.size || "";
     newRow[cols.sku - 1] = body.sku || "";
     newRow[cols.status - 1] = "Needed";
     if (cols.checkedBy !== -1) newRow[cols.checkedBy - 1] = body.initials || "";
     if (cols.checkedDate !== -1) newRow[cols.checkedDate - 1] = new Date();

     sheet.appendRow(newRow);
     return jsonResponse({ ok: true, added: true });
   }

   // Commits a batch of picking decisions in one request. body.decisions is
   // an array of { sku, size, action: "picked"|"outOfStock" } -- sets Status
   // to "Picked" or "Out of Stock" on the matching FloorRestock row, and Out
   // of Stock also stamps that row's 86 column so it shows on the 86 Board.
   // Only matches a row whose Status is still "Needed".
   function handleFloorPickUpdate(body) {
     const timestamp = new Date();
     const decisions = body.decisions || [];
     const fr = loadFloorRestock();
     const cols = fr.cols;
     let updated = 0;

     decisions.forEach((d) => {
       const idx = fr.find(d.sku, d.size, (s) => s.status === "Needed");
       if (idx === -1) return;
       const row = fr.body[idx];
       const status = d.action === "picked" ? "Picked" : "Out of Stock";
       if (cols.status !== -1) row[cols.status - 1] = status;
       if (d.action === "outOfStock" && cols.flag86 !== -1) row[cols.flag86 - 1] = timestamp;
       fr.patch(idx);
       updated++;
     });

     fr.save();
     return jsonResponse({ ok: true, updated: updated });
   }

   // Closes out one or more 86 Board entries as restocked. body.items is an
   // array of { sku, size } -- stamps the matching FloorRestock row's
   // RESTOCKED column, which is what drops it off the 86 Board. Only matches
   // a row that's actually still on the board (86 set, RESTOCKED still blank).
   function handleFloor86Restock(body) {
     const timestamp = new Date();
     const items = body.items || [];
     const fr = loadFloorRestock();
     const cols = fr.cols;
     let updated = 0;

     items.forEach((it) => {
       const idx = fr.find(it.sku, it.size, (s) => s.flag86 !== "" && s.restocked === "");
       if (idx === -1 || cols.restocked === -1) return;
       fr.body[idx][cols.restocked - 1] = timestamp;
       fr.patch(idx);
       updated++;
     });

     fr.save();
     return jsonResponse({ ok: true, updated: updated });
   }

   // Looks up a header's column by name (1-based) instead of a hardcoded
   // index, so it keeps working if a hand-managed sheet's columns are ever
   // reordered.
   function findColumnIndex(headerRow, name) {
     const idx = headerRow.findIndex((h) => (h || "").toString().trim().toUpperCase() === name.toUpperCase());
     return idx === -1 ? -1 : idx + 1;
   }

   // Flags every given ECC Generic Material row PROCESSED on ConsolMaster in
   // one pass -- previously called once per item in a box, each doing its
   // own header lookup and TextFinder scan; this reads the header and the
   // ECC column once for the whole batch.
   function markConsolProcessedBatch(eccMaterials) {
     const targets = (eccMaterials || []).filter(Boolean);
     if (targets.length === 0) return;

     const sheet = getSpreadsheet().getSheetByName("ConsolMaster");
     if (!sheet || sheet.getLastRow() < 2) return;
     const headerRow = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
     const eccCol = findColumnIndex(headerRow, "ECC GENERIC MATERIAL");
     const processedCol = findColumnIndex(headerRow, "PROCESSED");
     if (eccCol === -1 || processedCol === -1) return;

     const wanted = new Set(targets.map(String));
     const eccValues = sheet.getRange(2, eccCol, sheet.getLastRow() - 1, 1).getValues();
     eccValues.forEach((r, i) => {
       if (wanted.has(String(r[0]))) sheet.getRange(i + 2, processedCol).setValue("Processed");
     });
   }

   // Single-material convenience wrapper, for the one call site (a mark-out
   // batch is always for one style/ECC material at a time) that doesn't have
   // a list to begin with.
   function markConsolProcessed(eccMaterial) {
     markConsolProcessedBatch([eccMaterial]);
   }

   function consolLogRow(fields) {
     return CONSOL_LOG_HEADER.map((key) => (key in fields ? fields[key] : ""));
   }

   // Appends a whole batch of ConsolLog rows in one call, instead of one
   // appendRow() (and its own sheet lookup) per row.
   function appendConsolLogRows(rows) {
     if (rows.length === 0) return;
     const sheet = getOrCreateSheet("ConsolLog", CONSOL_LOG_HEADER);
     sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, CONSOL_LOG_HEADER.length).setValues(rows);
   }

   // Closes a Packed Box: logs every item as Completed under one packing slip
   // reference number, flags each Processed on ConsolMaster, and adds one
   // closure record -- all from a single request, all in one batched write.
   function handleConsolBoxClose(body) {
     const date = body.date ? new Date(body.date + "T00:00:00") : new Date();
     const timestamp = new Date();
     const items = body.items || [];

     const logRows = items.map((item) =>
       consolLogRow({
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
       })
     );
     logRows.push(
       consolLogRow({
         id: Utilities.getUuid(),
         entryType: "packout",
         date: date,
         timestamp: timestamp,
         initials: body.initials || "",
         unitsOut: items.length,
         referenceNumber: body.referenceNumber || "",
       })
     );
     appendConsolLogRows(logRows);

     markConsolProcessedBatch(items.map((item) => item.eccMaterial));

     return jsonResponse({ ok: true, processed: items.length });
   }

   // "Needs Adjustment" for one or more sizes of the same style, submitted
   // together in one request (body.items = [{ upc, size, units,
   // productDescription }, ...]): logs each in the consolidation log, pushes
   // each chosen UPC/units into the AuditLog's existing shared Mark Out
   // section (same queue regular audit shrink uses -- this assumes Mark Out
   // starts at column U (21), 6 columns wide: Date, UPC, Description, Units
   // to Remove, Lead Initials, Date Complete), and flags the ConsolMaster row
   // Processed once at the end.
   function handleConsolMarkoutBatch(body) {
     const date = body.date ? new Date(body.date + "T00:00:00") : new Date();
     const items = body.items || [];
     const auditSheet = getOrCreateSheet("AuditLog", AUDIT_HEADER);

     const logRows = items.map((item) =>
       consolLogRow({
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
       })
     );
     appendConsolLogRows(logRows);

     const markOutRows = items.map((item) => [date, item.upc || "", item.productDescription || "", item.units || 0, "", ""]);
     appendRowsToSection(auditSheet, 21, 6, markOutRows);

     markConsolProcessed(body.eccMaterial);

     return jsonResponse({ ok: true, items: items.length });
   }

   // Marks one ConsolLog "Needs Adjustment" entry Resolved. The row itself
   // stays (ConsolLog is a permanent history, like AuditLog) -- this only
   // flips its STATUS so the app can stop treating it as something still
   // needing attention. Scoped to the id column via TextFinder, same
   // approach as findReceivingRowIndex, since a single lookup by a unique id
   // never needs the whole row body read into memory. Only actually flips a
   // row that's still "Needs Adjustment" -- already-Resolved or a
   // mismatched entryType (e.g. a "packout" row's id, sent by mistake) is a
   // safe no-op rather than corrupting an unrelated row.
   function handleConsolLogResolve(body) {
     const sheet = getOrCreateSheet("ConsolLog", CONSOL_LOG_HEADER);
     const lastRow = sheet.getLastRow();
     if (lastRow < 2) return jsonResponse({ ok: false, error: "ConsolLog is empty." });

     const match = sheet.getRange(2, 1, lastRow - 1, 1).createTextFinder(String(body.id)).matchEntireCell(true).findNext();
     if (!match) return jsonResponse({ ok: false, error: "Entry not found." });

     const rowIndex = match.getRow();
     const statusCol = CONSOL_LOG_HEADER.indexOf("status") + 1;
     const currentStatus = sheet.getRange(rowIndex, statusCol).getValue();
     if (currentStatus !== "Needs Adjustment") {
       return jsonResponse({ ok: true, resolved: false, reason: "not in Needs Adjustment state" });
     }

     sheet.getRange(rowIndex, statusCol).setValue("Resolved");
     return jsonResponse({ ok: true, resolved: true });
   }

   // Appends within one section of a sheet that has several independent
   // sections side by side (so plain appendRow(), which looks at the whole
   // sheet's last row, can't be used). Finds the section's own last used row
   // with one manual scan, then writes every row in `rowsValues` in a single
   // call, instead of a full section re-scan per row.
   //
   // NOTE: an earlier version of this used getNextDataCell(DOWN) from the
   // header cell to avoid a full-column read. Don't do that -- it has the
   // same gotcha as pressing Ctrl+Down in the Sheets UI: starting from a
   // filled cell (the header) with an EMPTY cell right below it and no more
   // data anywhere further down that column, it jumps to the sheet's
   // absolute last row instead of stopping just past the header -- so the
   // new row gets written hundreds of rows down, off-screen, and looks like
   // nothing happened. A manual scan is the reliable way to do this;
   // getLastRow() (not getMaxRows()) keeps the read reasonably tight without
   // that failure mode.
   function appendRowsToSection(sheet, startCol, numCols, rowsValues) {
     if (!rowsValues || rowsValues.length === 0) return;
     const numRows = Math.max(sheet.getLastRow(), 1);
     const values = sheet.getRange(1, startCol, numRows, numCols).getValues();
     let lastRow = 0;
     for (let i = 0; i < values.length; i++) {
       if (values[i].some((v) => v !== "")) lastRow = i + 1;
     }
     sheet.getRange(lastRow + 1, startCol, rowsValues.length, numCols).setValues(rowsValues);
   }

   // Single-row convenience wrapper -- handleAuditPost only ever has one
   // Mark In/Out row to push per count.
   function appendToSection(sheet, startCol, numCols, rowValues) {
     appendRowsToSection(sheet, startCol, numCols, [rowValues]);
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

   // Same idea as sheetToObjects(), but keyed by a fixed array of names (the
   // sheet's actual column ORDER) instead of whatever text is currently in
   // row 1 -- see the note on doGet() above for why.
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
   of `handleAuditPost` (an `ensureDashboardHeaders`, an `onEdit` trigger),
   those are unaffected by anything above — this version just changed how
   `appendToSection` itself is implemented internally (it's now a thin
   wrapper over a new `appendRowsToSection`, which batches multiple rows
   into one write; several handlers depend on `appendRowsToSection`
   existing, so paste in the whole block above rather than keeping an
   older standalone `appendToSection` in isolation).

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
  that has a connection. **A box added manually** via the Receiving Log's
  "Box Not in Expected Shipments" prompt follows the same pattern — it
  lands in holding locally right away regardless of connection, and just
  tries to share to the sheet in the background.
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
  tab, same as ConsolMaster, and only read on boot/refresh. **Add a
  Product** (Check Floor's catalog lookup) is the one exception — it does
  push a new row, immediately, same reliability as adding a new catalog
  product from the Audit Dashboard.
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
hand. Batch operations (Receiving's bulk import, Save to Sheet, Check
Floor/Replen Update, and the rest) send the whole batch as a single
request rather than one request per item — see **Performance** below —
which also means they're all-or-nothing: if a batch still fails after its
retries, none of it synced rather than some of it, and everything involved
stays queued locally to try again on the next tap. Nothing already in
local storage is ever lost either way, just delayed.

**Why a "Marking out…" status can outlast the sheet update:** the row
write happens partway through the Apps Script function and is visible in
the Sheet immediately, but the browser has no way to know that — it only
finds out once the *entire* function finishes (every write it does, plus
building the response) and the HTTP response makes it back. So there's an
inherent gap between "visible in the sheet" and "the app's request
resolves." That gap grows with how much work the script does per request
and with Apps Script's own execution/cold-start overhead, which the app
has no control over — see **Performance** below for what keeps that
per-request work as small as possible.

## Performance

Every write handler in `Code.gs` follows the same rule: read the sheet at
most once per request, no matter how many rows the request touches, and
write back only what actually changed. Earlier versions of a few handlers
didn't — `handleCheckFloorUpdate`/`handleFloorPickUpdate`/
`handleFloor86Restock` used to re-read the *entire* FloorRestock sheet
once *per decision* in the batch (checking off 15 items at once meant 15
full-sheet reads), and `handleReceivingStatusPost` did the same per
barcode. They now read FloorRestock/ReceivingLog exactly once per request
(via `loadFloorRestock()` or a plain column read), match everything in
memory, and write only the rows that changed.

Two flows on the client used to make one sequential network request *per
item* instead of one request for the whole batch: pasting a Receiving
shipment (one request per box — a big shipment could be 50-100+ round
trips) and **Save to Sheet** on the Audit Dashboard (one request per
unsynced count). Both now send everything in a single request
(`receivingimportbatch` / `auditbatch`), which is almost always the
biggest visible speedup of all this, since network round-trip latency (not
the Sheet read/write itself) dominates when a flow was making many
requests back to back.

Also: `ensurePlainTextColumn` used to reformat all the way to
`getMaxRows()` (which can be far larger than the sheet's real data after
repeated pastes/deletes) on every single receiving write — now bounded to
the actual used range plus a little headroom. `getSpreadsheet()` is
memoized per execution so handlers that touch more than one sheet (e.g.
closing a Packed Box, which touches ConsolLog and ConsolMaster) don't
re-fetch the spreadsheet object for each one.

`doGet` also caches its JSON response for 10 seconds
(`DOGET_CACHE_SECONDS`) so two staff refreshing around the same time don't
both trigger a full sheet read — the tradeoff is that a change can take up
to that long to show up for someone who refreshes right after someone
else's write. If that staleness is ever unwanted, delete the cache
get/put in `doGet` (the comment right above it says exactly what to
remove) and it'll always read live.

None of this changes what any request sends or what shape its response
has, except the two new batch endpoints above — every other request/
response contract in this file is unchanged.

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
