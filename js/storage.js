"use strict";

const STORAGE = {
  master: "audit.productMaster.v1",
  tagMap: "audit.styleTagMap.v1",
  auditLog: "audit.auditEntries.v1",
  session: "audit.session.v1",
  webhookUrl: "audit.webhookUrl.v1",
  consolMaster: "audit.consolMaster.v1",
  consolLog: "audit.consolLog.v1",
  consolBox: "audit.consolBox.v1",
  receivingMaster: "audit.receivingMaster.v1",
  receivingHolding: "audit.receivingHolding.v1",
  floorRestock: "audit.floorRestock.v1",
  floorReplen: "audit.floorReplen.v1",
  checkFloorHolding: "audit.checkFloorHolding.v1",
  replenHolding: "audit.replenHolding.v1",
};

// The core sizes offered when flagging an item "Needed" on Check Floor —
// tops (S/M/L) and men's/women's bottoms (30/32/34, 2/4/6) shown together
// since the MAO export doesn't reliably say which an item is; "Other"
// means any size will do to hit the minimum-3-on-floor rule.
const FLOOR_CORE_SIZES = ["S", "M", "L", "30", "32", "34", "2", "4", "6"];

// Baked-in default so the app works with zero setup. Settings can still
// override this (e.g. if the sheet is ever redeployed to a new URL).
const DEFAULT_WEBHOOK_URL =
  "https://script.google.com/macros/s/AKfycbz_Xhbfp_Cpko5kBIsNik8dhXLNrQ5D2DKpjmqMZpVAxUPyNkgVHi-7417HQQrFJpIr/exec";

// The mandatory login screen's roster — add/remove staff initials here as
// the team changes.
const STAFF_INITIALS = ["LS", "SC", "SG", "JV"];

function loadJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw == null ? fallback : JSON.parse(raw);
  } catch (e) {
    return fallback;
  }
}

function saveJSON(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

/* ---------- Manhattan Omni paste parsing ----------
   Expected repeating block, separated by a blank (or whitespace-only) line:

   Atom SL Hoody Men's
   SKUX000009560002
   DeptM
   StyleX000009560
   ColorBlack
   SizeXS
   UPC623555583288
   Available0 / 0
*/
const MANHATTAN_LABELS = [
  ["sku", /^SKU(.+)$/i],
  ["dept", /^Dept(.+)$/i],
  ["style", /^Style(.+)$/i],
  ["color", /^Color(.+)$/i],
  ["size", /^Size(.+)$/i],
  ["upc", /^UPC(.+)$/i],
  // "Available x / x" is intentionally not parsed — expected counts are
  // entirely staff-entered on the Audit Dashboard, not sourced from MAO.
  ["available", /^Available(.+)$/i],
];

function parseManhattanBlock(lines) {
  const item = { description: "", sku: "", dept: "", style: "", color: "", size: "", upc: "" };
  for (const rawLine of lines) {
    const line = rawLine.trim();
    let matched = false;
    for (const [key, re] of MANHATTAN_LABELS) {
      const m = line.match(re);
      if (m) {
        if (key !== "available") {
          item[key] = m[1].trim();
        }
        matched = true;
        break;
      }
    }
    if (!matched && !item.description) {
      item.description = line;
    }
  }
  return item;
}

function parseManhattanPaste(text) {
  const lines = (text || "").split(/\r?\n/);
  const blocks = [];
  let current = [];
  for (const rawLine of lines) {
    if (rawLine.trim() === "") {
      if (current.length) {
        blocks.push(current);
        current = [];
      }
    } else {
      current.push(rawLine);
    }
  }
  if (current.length) blocks.push(current);

  return blocks.map(parseManhattanBlock).filter((item) => item.sku && item.upc);
}

function upsertProductMaster(parsedItems) {
  const master = loadJSON(STORAGE.master, []);
  let added = 0;
  let updated = 0;
  const now = new Date().toISOString();

  for (const item of parsedItems) {
    const idx = master.findIndex((p) => p.sku === item.sku);
    if (idx === -1) {
      // expectedCount is never sourced from Manhattan Omni — it starts unset
      // and is only ever set by an associate confirming it on the Audit Dashboard.
      master.push({ ...item, expectedCount: null, updatedAt: now });
      added++;
    } else {
      // Refresh catalog facts (description/style/color/size/upc), but never
      // touch expectedCount here — that field is user-owned, not MAO-owned.
      master[idx] = { ...master[idx], ...item, updatedAt: now };
      updated++;
    }
  }

  saveJSON(STORAGE.master, master);
  return { added, updated, total: master.length };
}

function setExpectedCount(sku, expectedCount) {
  const master = loadJSON(STORAGE.master, []);
  const idx = master.findIndex((p) => p.sku === sku);
  if (idx === -1) return;
  master[idx].expectedCount = expectedCount;
  master[idx].updatedAt = new Date().toISOString();
  saveJSON(STORAGE.master, master);
}

// Maps a row shape returned by the Sheet's ProductMaster tab into the same
// item shape parseManhattanBlock() produces, so both sources can share
// upsertProductMaster()'s merge logic. The sheet's actual header row is
// "SKU / UPC / DEPT / STYLE SKU / COLOR / SIZE / DESCRIPTION / UPDATED AT"
// (edited directly in Sheets) — fall back to the original lowercase keys
// too, in case a row was ever written before that header existed.
function sheetRowToMasterItem(row) {
  // Sheets auto-types a numeric-looking cell (a UPC barcode, especially) as
  // a number, not text — String()-coerce everything so items compare
  // correctly (===) against scanned/typed strings everywhere else in the
  // app, instead of silently never matching a number-vs-string mismatch.
  return {
    sku: String(row["SKU"] ?? row.sku ?? ""),
    upc: String(row["UPC"] ?? row.upc ?? ""),
    dept: String(row["DEPT"] ?? row.dept ?? ""),
    style: String(row["STYLE SKU"] ?? row.style ?? ""),
    color: String(row["COLOR"] ?? row.color ?? ""),
    size: String(row["SIZE"] ?? row.size ?? ""),
    description: String(row["DESCRIPTION"] ?? row.description ?? ""),
  };
}

function combinedDescription(item) {
  const parts = [item.description];
  const colorSize = [item.color, item.size].filter(Boolean).join(" / ");
  if (colorSize) parts.push(colorSize);
  return parts.join(" — ");
}

/* ---------- HQ consolidation list ----------
   The HQ export is pasted directly into the "ConsolMaster" sheet tab now
   (not through the app) — that keeps it in clean Excel-native columns for
   reliable reference. The app only ever reads this sheet. Its header row
   (edited directly in Sheets) is:

   MATERIAL | COLOR | STYLE SKU | ECC GENERIC MATERIAL | DESTINATION | TOTAL | PROCESSED

   PROCESSED is the qualifier for whether a line still shows on the
   website — any non-blank value there means it's done and gets filtered
   out. The app sets it (via the Apps Script backend) when a Packed Box is
   closed or an item is marked "Needs Adjustment."
*/

function sheetRowToConsolItem(row) {
  return {
    eccMaterial: String(row["ECC GENERIC MATERIAL"] ?? ""),
    description: String(row["MATERIAL"] ?? ""),
    color: String(row["COLOR"] ?? ""),
    styleSku: String(row["STYLE SKU"] ?? ""),
    destination: String(row["DESTINATION"] ?? ""),
    total: Number(row["TOTAL"]) || 0,
    processed: String(row["PROCESSED"] ?? ""),
  };
}

function isConsolProcessed(item) {
  return (item.processed || "").toString().trim() !== "";
}

/* ---------- MAO incoming-shipment paste parsing ----------
   Repeating block, pasted straight out of MAO — no blank-line separator,
   a new block just starts at the next "ETA:" line:

   ETA:  09-16-2026
   Package  8069559026403610
   Origin  9120
   Receipt Type  Package
   For  Store Inventory
   Carrier  UPS
   PO # 6390185302

   Only ETA (expected date), Package (barcode), and PO # are kept — Origin,
   Receipt Type, For, and Carrier are intentionally ignored.
*/
function mmddyyyyToISO(s) {
  const m = (s || "").trim().match(/^(\d{2})-(\d{2})-(\d{4})$/);
  return m ? `${m[3]}-${m[1]}-${m[2]}` : (s || "").trim();
}

function parseReceivingPaste(text) {
  const lines = (text || "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const items = [];
  let current = null;

  for (const line of lines) {
    const etaMatch = line.match(/^ETA:?\s*(.+)$/i);
    if (etaMatch) {
      if (current) items.push(current);
      current = { expectedDate: mmddyyyyToISO(etaMatch[1]), barcode: "", po: "" };
      continue;
    }
    if (!current) continue;

    const packageMatch = line.match(/^Package\s+(.+)$/i);
    if (packageMatch) {
      current.barcode = packageMatch[1].trim();
      continue;
    }

    const poMatch = line.match(/^PO\s*#\s*(.+)$/i);
    if (poMatch) {
      current.po = poMatch[1].trim();
      continue;
    }
    // Origin / Receipt Type / For / Carrier lines fall through, unused.
  }
  if (current) items.push(current);

  return items.filter((item) => item.barcode && item.po);
}

// Keyed by barcode (MAO's "Package" number). Only ever sets the expected-
// shipment facts (po/expectedDate) — the received-status fields are only
// ever set by the server after a successful markHeldReceiving() push, never
// locally guessed, so a re-import can't accidentally clear real status.
function upsertReceivingMaster(items) {
  const master = loadJSON(STORAGE.receivingMaster, []);
  let added = 0;
  let updated = 0;

  for (const item of items) {
    const idx = master.findIndex((p) => p.barcode === item.barcode);
    if (idx === -1) {
      master.push({
        barcode: item.barcode,
        po: item.po,
        expectedDate: item.expectedDate,
        physicallyReceivedDate: "",
        physicallyReceivedBy: "",
        receivedIntoMaoDate: "",
        receivedIntoMaoBy: "",
      });
      added++;
    } else {
      master[idx].po = item.po;
      master[idx].expectedDate = item.expectedDate;
      updated++;
    }
  }

  saveJSON(STORAGE.receivingMaster, master);
  return { added, updated, total: master.length };
}

function sheetRowToReceivingItem(row) {
  // Package/barcode numbers are long digit strings — Sheets will happily
  // auto-type that cell as a number rather than text, so String()-coerce
  // everything the same way ProductMaster's UPC needed to be.
  return {
    barcode: String(row.barcode ?? ""),
    po: String(row.po ?? ""),
    expectedDate: String(row.expectedDate ?? ""),
    physicallyReceivedDate: String(row.physicallyReceivedDate ?? ""),
    physicallyReceivedBy: String(row.physicallyReceivedBy ?? ""),
    receivedIntoMaoDate: String(row.receivedIntoMaoDate ?? ""),
    receivedIntoMaoBy: String(row.receivedIntoMaoBy ?? ""),
  };
}

/* ---------- Floor Restock / Floor Replen / 86 Board ----------
   The MAO "items sold" export is pasted directly into the "FloorRestock"
   sheet tab (same pattern as ConsolMaster — staff paste straight into
   Sheets, the app only reads it). Its header row (staff-managed, matched
   by name so it can be renamed freely) is expected to be, all caps to
   match ProductMaster/ConsolMaster's convention:

   GENDER | CLOTHING CATEGORY | MODEL NAME | COLOR | SIZE | SKU |
   QUANTITY SOLD | ON HAND QUANTITY | STATUS | CHECKED BY | CHECKED DATE

   STATUS/CHECKED BY/CHECKED DATE are the three columns the app itself
   writes (via the backend) when a Check Floor decision is committed —
   staff need to add these three empty columns once when first setting up
   the tab. Status is the qualifier for whether a row still shows in the
   Check Floor section — any non-blank value there means it's done.

   FloorReplen is a completely separate, fully app-managed sheet (like
   ReceivingLog) — one row per size actually needed, created when a Check
   Floor "Needed" decision is committed. Its own status field then tracks
   the picking step (open -> picked or outOfStock) and, for anything
   marked outOfStock, the 86 Board close-out step (-> restocked).
*/
function sheetRowToFloorRestockItem(row) {
  return {
    gender: String(row["GENDER"] ?? ""),
    category: String(row["CLOTHING CATEGORY"] ?? ""),
    description: String(row["MODEL NAME"] ?? ""),
    color: String(row["COLOR"] ?? ""),
    size: String(row["SIZE"] ?? ""),
    sku: String(row["SKU"] ?? ""),
    qtySold: Number(row["QUANTITY SOLD"]) || 0,
    onHand: Number(row["ON HAND QUANTITY"]) || 0,
    status: String(row["STATUS"] ?? ""),
    checkedBy: String(row["CHECKED BY"] ?? ""),
    checkedDate: String(row["CHECKED DATE"] ?? ""),
  };
}

function isFloorRestockChecked(item) {
  return (item.status || "").toString().trim() !== "";
}

function sheetRowToFloorReplenItem(row) {
  return {
    id: String(row.id ?? ""),
    sku: String(row.sku ?? ""),
    description: String(row.description ?? ""),
    color: String(row.color ?? ""),
    size: String(row.size ?? ""),
    status: String(row.status ?? ""),
    checkedBy: String(row.checkedBy ?? ""),
    checkedDate: String(row.checkedDate ?? ""),
    pickedBy: String(row.pickedBy ?? ""),
    pickedDate: String(row.pickedDate ?? ""),
    restockedBy: String(row.restockedBy ?? ""),
    restockedDate: String(row.restockedDate ?? ""),
  };
}

function getTagLocation(style) {
  const map = loadJSON(STORAGE.tagMap, {});
  return map[style] || "";
}

function setTagLocation(style, location) {
  const map = loadJSON(STORAGE.tagMap, {});
  map[style] = location;
  saveJSON(STORAGE.tagMap, map);
}
