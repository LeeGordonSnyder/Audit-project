/* ============================================================================
   Oakridge Product Suite — Code.gs (the main Apps Script file)

   The whole of Code.gs, ready to paste over the one in Extensions → Apps
   Script. It already has the hooks for the two add-ons, which live in their
   own files in the same project: Deployment.gs (daily deployment) and
   Todos.gs (team to-do list). See backend/README.md.

   Not in this file: anything added by hand to the live script, such as an
   onEdit function that stamps Supervisor Initials on AuditLog. Keep those
   when you paste this in.
   ========================================================================== */
"use strict";

// Every request -- GET or POST -- must carry this shared secret, checked
// before anything else runs (before the doGet cache lookup, before any
// sheet is touched). Set it once under Project Settings -> Script
// Properties, name "ACCESS_KEY" -- never paste the real value into this
// file, since Code.gs isn't tracked in git the way the rest of the app
// is, but this whole block gets copy-pasted around (into README.md, into
// chat, etc.) and a hardcoded secret here would travel right along with
// it. Give the same value to staff to paste into the app's own Shared
// Log Settings -> Access Key field. Script Properties missing or blank
// means every request is rejected -- fails closed, not open.
function isAuthorized(key) {
  const expected = PropertiesService.getScriptProperties().getProperty("ACCESS_KEY");
  return !!expected && key === expected;
}

function doPost(e) {
  const body = JSON.parse(e.postData.contents);
  if (!isAuthorized(body.key)) return jsonResponse({ ok: false, error: "Unauthorized" });
  if (String(body.type).indexOf("todo") === 0) return handleTodoPost(body); // Todos.gs
  if (body.type === "master") return handleMasterPost(body);
  if (body.type === "consolboxclose") return handleConsolBoxClose(body);
  if (body.type === "consolupdate") return handleConsolUpdate(body);
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
  if (body.type === "consolcountupdate") return handleConsolCountUpdate(body);
  if (body.type === "tagassign") return handleTagAssign(body);
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
  if (!isAuthorized(e.parameter.key)) return jsonResponse({ ok: false, error: "Unauthorized" });

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
  if (sheetParam === "deployment") return getDeploymentForApp(); // Deployment.gs
  if (sheetParam === "todos") return getTodosForApp(); // Todos.gs
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
const CONSOL_LOG_HEADER = ["id", "entryType", "date", "initials", "eccMaterial", "description", "color", "status", "size", "actualCount", "referenceNumber", "timestamp"];
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
  const lastRow = findLastRowInColumns(sheet, 1, AUDIT_HEADER.length);
  sheet.getRange(lastRow + 1, 1, 1, row.length).setValues([row]);

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

  const lastRow = findLastRowInColumns(sheet, 1, AUDIT_HEADER.length);
  sheet.getRange(lastRow + 1, 1, rows.length, AUDIT_HEADER.length).setValues(rows);
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
  if (rowIndex === -1) {
    const lastRow = findLastRowInColumns(sheet, 1, MASTER_HEADER.length);
    sheet.getRange(lastRow + 1, 1, 1, row.length).setValues([row]);
  } else {
    sheet.getRange(rowIndex, 1, 1, row.length).setValues([row]);
  }
  return jsonResponse({ ok: true });
}

// Assigns one hard-tag location to every ProductMaster row sharing a
// style -- a hard tag is a per-style attribute (one location applies to
// every color/size variant), but ProductMaster is one row per SKU, so
// every matching row needs the same value written. Reads the STYLE SKU
// column once, writes only the matched cells (column I, hand-added by
// staff, found by name like every other bolted-on column in this app).
function handleTagAssign(body) {
  const style = String(body.style || "").trim();
  if (!style) return jsonResponse({ ok: false, error: "Missing style." });

  const sheet = getOrCreateSheet("ProductMaster", MASTER_HEADER);
  const headerRow = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const styleCol = findColumnIndex(headerRow, "STYLE SKU");
  const tagCol = findColumnIndex(headerRow, "HARD TAG LOCATION");
  if (styleCol === -1 || tagCol === -1) {
    return jsonResponse({ ok: false, error: "ProductMaster is missing a STYLE SKU or HARD TAG LOCATION column." });
  }

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return jsonResponse({ ok: true, updated: 0 });

  const styleValues = sheet.getRange(2, styleCol, lastRow - 1, 1).getValues();
  let updated = 0;
  styleValues.forEach((r, i) => {
    if (String(r[0]) === style) {
      sheet.getRange(i + 2, tagCol).setValue(body.location || "");
      updated++;
    }
  });

  return jsonResponse({ ok: true, updated: updated });
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
  const row = [body.id || "", date, body.initials || "", body.feedback || "", timestamp];
  const lastRow = findLastRowInColumns(sheet, 1, FEEDBACK_HEADER.length);
  sheet.getRange(lastRow + 1, 1, 1, row.length).setValues([row]);
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
    const row = [barcodeText, item.po || "", item.expectedDate || "", "", "", "", "", now];
    const lastRow = findLastRowInColumns(sheet, 1, RECEIVING_HEADER.length);
    sheet.getRange(lastRow + 1, 1, 1, row.length).setValues([row]);
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
    const appendRow = findLastRowInColumns(sheet, 1, RECEIVING_HEADER.length);
    sheet.getRange(appendRow + 1, 1, newRows.length, RECEIVING_HEADER.length).setValues(newRows);
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
        // Scoped to FLOOR_RESTOCK_HEADER's own columns, not headerRow.length --
        // headerRow spans the sheet's current full width, which can include
        // staff-added tracking columns (e.g. a checkbox) far to the right
        // whose formatting extends further down than any real product row,
        // inflating getLastRow() the same way it did for Feedback. See
        // findLastRowInColumns above.
        const appendRow = findLastRowInColumns(sheet, 1, FLOOR_RESTOCK_HEADER.length);
        sheet.getRange(appendRow + 1, 1, appended.length, headerRow.length).setValues(appended);
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

  // Scoped to FLOOR_RESTOCK_HEADER's own columns, not headerRow.length --
  // see the matching note in loadFloorRestock()'s save() above.
  const lastRow = findLastRowInColumns(sheet, 1, FLOOR_RESTOCK_HEADER.length);
  sheet.getRange(lastRow + 1, 1, 1, newRow.length).setValues([newRow]);
  return jsonResponse({ ok: true });
}

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

function consolLogRow(fields) {
  return CONSOL_LOG_HEADER.map((key) => (key in fields ? fields[key] : ""));
}

// Appends a whole batch of ConsolLog rows in one call, instead of one
// appendRow() (and its own sheet lookup) per row.
function appendConsolLogRows(rows) {
  if (rows.length === 0) return;
  const sheet = getOrCreateSheet("ConsolLog", CONSOL_LOG_HEADER);
  const lastRow = findLastRowInColumns(sheet, 1, CONSOL_LOG_HEADER.length);
  sheet.getRange(lastRow + 1, 1, rows.length, CONSOL_LOG_HEADER.length).setValues(rows);
}

// Registers who closed a box, and when -- deliberately just the reference
// number, initials, and date, nothing about what's inside it. The
// reference number alone is enough to look the box's contents up in MAO,
// so this never touches ConsolMaster and is completely independent of
// handleConsolUpdate below.
function handleConsolBoxClose(body) {
  const date = body.date ? new Date(body.date + "T00:00:00") : new Date();
  appendConsolLogRows([
    consolLogRow({
      id: Utilities.getUuid(),
      entryType: "packout",
      date: date,
      timestamp: new Date(),
      initials: body.initials || "",
      referenceNumber: body.referenceNumber || "",
    }),
  ]);
  return jsonResponse({ ok: true });
}

// Commits every staged Consolidation decision (currently only "Actioned" --
// see handleConsolCountUpdate below for how shortages are tracked now) in
// one request. body.decisions is an array of { eccMaterial, description,
// color, status }. Logs one ConsolLog row per decision and flags every
// item Processed on ConsolMaster -- batched into a handful of calls
// regardless of how many decisions are in the request.
//
// This used to also take a "Needs Adjustment" status with a per-size
// items[] breakdown, pushing each size into AuditLog's shared Mark Out
// queue. That's gone -- a line's ACTUAL COUNT (tracked live by
// handleConsolCountUpdate) against its ConsolMaster TOTAL is what shows a
// shortage now, so there's nothing left here to mark out.
function handleConsolUpdate(body) {
  const decisions = body.decisions || [];
  if (decisions.length === 0) return jsonResponse({ ok: true, updated: 0 });

  const date = body.date ? new Date(body.date + "T00:00:00") : new Date();
  const timestamp = new Date();

  const logRows = decisions.map((d) =>
    consolLogRow({
      id: Utilities.getUuid(),
      entryType: "status",
      date: date,
      timestamp: timestamp,
      initials: body.initials || "",
      eccMaterial: d.eccMaterial || "",
      description: d.description || "",
      color: d.color || "",
      status: d.status || "Actioned",
    })
  );

  appendConsolLogRows(logRows);
  markConsolProcessedBatch(decisions.map((d) => d.eccMaterial));

  return jsonResponse({ ok: true, updated: decisions.length });
}

// Pushes the running "actual count" for one consolidation line straight to
// the sheet -- unlike every other Holding/Update flow in this app, there's
// no staging here: every tap of -/+ (or a typed value) on the
// Consolidations page calls this immediately, so ConsolLog's ACTUAL COUNT
// column (J -- repurposed from the old per-size "units to remove" field
// Needs Adjustment used to write, see CONSOL_LOG_HEADER) always reflects
// what's currently on screen, on any device, within one request.
//
// One row per ECC Generic Material tracks this (entryType "count",
// distinct from the "status"/"packout" history rows elsewhere in this
// sheet) -- a repeat call overwrites that SAME row's count/initials/
// timestamp in place instead of appending a new row per tap, which would
// flood the sheet with one row per click. The row's id is deterministic
// ("count-<eccMaterial>") specifically so the first create and every later
// overwrite agree on which row that is, and so a client that optimistically
// creates its own local copy before this request even returns stays in
// sync once a refresh pulls the sheet's copy back down -- same id either
// way, nothing to de-duplicate.
function handleConsolCountUpdate(body) {
  const eccMaterial = String(body.eccMaterial || "").trim();
  if (!eccMaterial) return jsonResponse({ ok: false, error: "Missing eccMaterial." });

  const sheet = getOrCreateSheet("ConsolLog", CONSOL_LOG_HEADER);
  const actualCount = Number(body.actualCount) || 0;
  const timestamp = new Date();

  const lastRow = sheet.getLastRow();
  let rowIndex = -1;
  if (lastRow >= 2) {
    const entryTypeCol = CONSOL_LOG_HEADER.indexOf("entryType") + 1;
    const eccCol = CONSOL_LOG_HEADER.indexOf("eccMaterial") + 1;
    const types = sheet.getRange(2, entryTypeCol, lastRow - 1, 1).getValues();
    const eccs = sheet.getRange(2, eccCol, lastRow - 1, 1).getValues();
    for (let i = 0; i < types.length; i++) {
      if (types[i][0] === "count" && String(eccs[i][0]) === eccMaterial) {
        rowIndex = i + 2;
        break;
      }
    }
  }

  if (rowIndex === -1) {
    const row = consolLogRow({
      id: "count-" + eccMaterial,
      entryType: "count",
      date: timestamp,
      timestamp: timestamp,
      initials: body.initials || "",
      eccMaterial: eccMaterial,
      description: body.description || "",
      color: body.color || "",
      actualCount: actualCount,
    });
    const appendRow = findLastRowInColumns(sheet, 1, CONSOL_LOG_HEADER.length);
    sheet.getRange(appendRow + 1, 1, 1, row.length).setValues([row]);
  } else {
    sheet.getRange(rowIndex, CONSOL_LOG_HEADER.indexOf("initials") + 1).setValue(body.initials || "");
    sheet.getRange(rowIndex, CONSOL_LOG_HEADER.indexOf("actualCount") + 1).setValue(actualCount);
    sheet.getRange(rowIndex, CONSOL_LOG_HEADER.indexOf("timestamp") + 1).setValue(timestamp);
  }

  return jsonResponse({ ok: true, actualCount: actualCount });
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

// Finds the last used row (1-based, 0 if none) within a fixed column
// range only, ignoring content anywhere outside it. appendRow() and
// sheet.getLastRow() both look at the sheet's ENTIRE width -- a hand-added
// column further right (a staff tracking checkbox, a note column, a
// second section of a dashboard sheet) with content or formatting
// extending down the sheet makes those think there's real data much
// further down than the columns this app actually manages, so a new row
// lands far below where anyone would think to look for it -- exactly the
// same gotcha as pressing Ctrl+Down in the Sheets UI, or the old
// getNextDataCell(DOWN) approach this replaced: starting from a filled
// header cell with an empty cell right below it and no more data further
// down THAT column, it jumps to the sheet's absolute last row instead of
// stopping just past the header. Scanning just the relevant columns
// avoids all of that regardless of what's off to the side. Bounded by
// getLastRow() (not getMaxRows()) to keep the read reasonably tight.
function findLastRowInColumns(sheet, startCol, numCols) {
  const numRows = Math.max(sheet.getLastRow(), 1);
  const values = sheet.getRange(1, startCol, numRows, numCols).getValues();
  let lastRow = 0;
  for (let i = 0; i < values.length; i++) {
    if (values[i].some((v) => v !== "")) lastRow = i + 1;
  }
  return lastRow;
}

// Appends within one section of a sheet that has several independent
// sections side by side (so plain appendRow(), which looks at the whole
// sheet's last row, can't be used) -- see findLastRowInColumns above.
function appendRowsToSection(sheet, startCol, numCols, rowsValues) {
  if (!rowsValues || rowsValues.length === 0) return;
  const lastRow = findLastRowInColumns(sheet, startCol, numCols);
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
