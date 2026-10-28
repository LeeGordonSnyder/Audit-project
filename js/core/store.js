"use strict";

/* ---------- Local storage ----------
   The rebuild runs side by side with the original app (Audit-project),
   and both are expected to be served from the same github.io origin —
   which means they share one localStorage. Every key here is under its
   own "ops2." prefix so this app never reads over, or writes over, the
   original app's "audit.*" data (including any counts that device hasn't
   saved to the sheet yet). The only crossover is READ-ONLY: if this app
   has no Sheet URL / access key of its own yet, it borrows the original
   app's (LEGACY_KEYS) so an already-set-up phone works with zero setup. */
const STORE = {
  master: "ops2.productMaster",
  auditLog: "ops2.auditLog",
  session: "ops2.session",
  webhookUrl: "ops2.webhookUrl",
  apiKey: "ops2.apiKey",
  consolMaster: "ops2.consolMaster",
  consolLog: "ops2.consolLog",
  consolHolding: "ops2.consolHolding",
  receivingMaster: "ops2.receivingMaster",
  receivingHolding: "ops2.receivingHolding",
  floorRestock: "ops2.floorRestock",
  checkFloorHolding: "ops2.checkFloorHolding",
  replenHolding: "ops2.replenHolding",
  staffInitials: "ops2.staffInitials",
  scannerZoom: "ops2.scannerZoom",
  lastSync: "ops2.lastSync",
  floorView: "ops2.floorView",
  deployment: "ops2.deployment",
  deploymentPick: "ops2.deploymentPick", // { initials: name } when two people share initials
};

const LEGACY_KEYS = {
  webhookUrl: "audit.webhookUrl.v1",
  apiKey: "audit.apiKey.v1",
  staffInitials: "audit.staffInitials.v1",
  scannerZoom: "audit.scannerZoom.v1",
};

// Same Apps Script deployment the original app uses — the rebuild talks to
// the exact same backend API, unchanged, so nothing about the original app
// or the sheet has to move for this one to work.
const DEFAULT_WEBHOOK_URL =
  "https://script.google.com/macros/s/AKfycbz_Xhbfp_Cpko5kBIsNik8dhXLNrQ5D2DKpjmqMZpVAxUPyNkgVHi-7417HQQrFJpIr/exec";

const STAFF_INITIALS_FALLBACK = ["LS", "SC", "SG", "JV"];

const TAG_LOCATIONS = ["Hood", "Below Wash Tag", "Through Wash Tag", "Tag Side Pocket", "Left Leg In-seam", "Chest Pocket", "No Hard Tag"];

// Sizes offered when flagging an item "Needed" on Check Floor — tops and
// men's/women's bottoms shown together since the MAO export doesn't say
// which an item is.
const FLOOR_CORE_SIZES = ["S", "M", "L", "30", "32", "34", "2", "4", "6"];

function loadJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw == null ? fallback : JSON.parse(raw);
  } catch (e) {
    return fallback;
  }
}

function saveJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.error("Couldn't save to local storage:", key, e);
  }
}

function loadString(key, legacyKey) {
  try {
    return localStorage.getItem(key) || (legacyKey ? localStorage.getItem(legacyKey) : "") || "";
  } catch (e) {
    return "";
  }
}

function saveString(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch (e) {
    console.error("Couldn't save to local storage:", key, e);
  }
}

/* ---------- Taking over from the original app ----------
   When this app is served at the original app's address (/Audit-project/),
   it replaces it on the store phones. Work the original app had staged on
   the phone but not yet sent to the sheet is carried over once: unsaved
   counts and the Consolidations, Receiving, Check Floor and Replen holding
   lists. Everything else comes from the sheet. The original keys are left
   in place, so going back to the original app loses nothing. Served
   anywhere else (side by side), it never runs, so the same work can't be
   sent twice. */
const LEGACY_WORK = [
  [STORE.auditLog, "audit.auditEntries.v1"],
  [STORE.consolHolding, "audit.consolHolding.v1"],
  [STORE.receivingHolding, "audit.receivingHolding.v1"],
  [STORE.checkFloorHolding, "audit.checkFloorHolding.v1"],
  [STORE.replenHolding, "audit.replenHolding.v1"],
];
const CARRIED_OVER_KEY = "ops2.carriedOver";

function carryOverOriginalAppWork() {
  if (!/\/audit-project\//i.test(location.pathname)) return 0;
  try {
    if (localStorage.getItem(CARRIED_OVER_KEY)) return 0;
  } catch (e) {
    return 0;
  }
  let moved = 0;
  for (const [key, legacyKey] of LEGACY_WORK) {
    let old = loadJSON(legacyKey, []);
    if (!Array.isArray(old)) continue;
    if (key === STORE.auditLog) old = old.filter((e) => e && !e.synced);
    if (!old.length) continue;
    const mine = loadJSON(key, []);
    const have = new Set(mine.map((e) => JSON.stringify(e)));
    const ids = new Set(mine.map((e) => e && e.id).filter(Boolean));
    const add = old.filter((e) => !(e && e.id && ids.has(e.id)) && !have.has(JSON.stringify(e)));
    if (!add.length) continue;
    saveJSON(key, key === STORE.auditLog ? add.concat(mine) : mine.concat(add));
    moved += add.length;
  }
  saveString(CARRIED_OVER_KEY, new Date().toISOString());
  return moved;
}

function currentInitials() {
  return (loadJSON(STORE.session, {}).initials || "").trim();
}

/* ---------- Product catalog ---------- */

function loadMaster() {
  return loadJSON(STORE.master, []);
}

function findProductBySku(sku) {
  return loadMaster().find((p) => p.sku === sku) || null;
}

function findProductByUpc(upc) {
  return loadMaster().find((p) => String(p.upc) === String(upc)) || null;
}

function combinedDescription(item) {
  const parts = [item.description];
  const colorSize = [item.color, item.size].filter(Boolean).join(" / ");
  if (colorSize) parts.push(colorSize);
  return parts.join(" — ");
}

// The one product search every module uses (Catalog, Counts, Floor Stock),
// instead of three copies of the same filter. An exact UPC or SKU hit sorts
// first so a scanned or typed barcode lands on the right product at the top.
function searchProducts(query, limit = 50) {
  const q = normalize(query);
  if (!q) return [];
  const results = [];
  for (const item of loadMaster()) {
    const exact = normalize(item.upc) === q || normalize(item.sku) === q;
    if (
      exact ||
      normalize(item.sku).includes(q) ||
      normalize(item.upc).includes(q) ||
      normalize(item.style).includes(q) ||
      normalize(combinedDescription(item)).includes(q)
    ) {
      results.push({ item, exact });
    }
  }
  results.sort((a, b) => (b.exact - a.exact) || combinedDescription(a.item).localeCompare(combinedDescription(b.item)));
  return results.slice(0, limit).map((r) => r.item);
}

function upsertProductMaster(parsedItems) {
  const master = loadMaster();
  const bySku = new Map(master.map((p, i) => [p.sku, i]));
  let added = 0;
  let updated = 0;
  const now = new Date().toISOString();

  for (const item of parsedItems) {
    const idx = bySku.get(item.sku);
    if (idx == null) {
      // expectedCount is staff-entered on Counts, never sourced from MAO.
      master.push({ ...item, expectedCount: null, updatedAt: now });
      bySku.set(item.sku, master.length - 1);
      added++;
    } else {
      master[idx] = { ...master[idx], ...item, updatedAt: now };
      updated++;
    }
  }

  saveJSON(STORE.master, master);
  return { added, updated, total: master.length };
}

function setExpectedCount(sku, expectedCount) {
  const master = loadMaster();
  const item = master.find((p) => p.sku === sku);
  if (!item) return;
  item.expectedCount = expectedCount;
  item.updatedAt = new Date().toISOString();
  saveJSON(STORE.master, master);
}

// A hard tag applies to a whole style; every row sharing it carries it.
function getTagLocation(style) {
  if (!style) return "";
  const item = loadMaster().find((p) => p.style === style && p.hardTagLocation);
  return item ? item.hardTagLocation : "";
}

function setLocalTagLocation(style, location) {
  const master = loadMaster();
  let changed = false;
  for (const item of master) {
    if (item.style === style) {
      item.hardTagLocation = location;
      changed = true;
    }
  }
  if (changed) saveJSON(STORE.master, master);
}

/* ---------- MAO "View Inventory" paste ----------
   Repeating block separated by a blank line:

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
  ["available", /^Available(.+)$/i], // recognized so it isn't mistaken for a description; never stored
];

function parseManhattanBlock(lines) {
  const item = { description: "", sku: "", dept: "", style: "", color: "", size: "", upc: "" };
  for (const rawLine of lines) {
    const line = rawLine.trim();
    const hit = MANHATTAN_LABELS.find(([, re]) => re.test(line));
    if (hit) {
      if (hit[0] !== "available") item[hit[0]] = line.match(hit[1])[1].trim();
    } else if (!item.description) {
      item.description = line;
    }
  }
  return item;
}

function parseManhattanPaste(text) {
  const blocks = [];
  let current = [];
  for (const rawLine of (text || "").split(/\r?\n/)) {
    if (rawLine.trim() === "") {
      if (current.length) blocks.push(current);
      current = [];
    } else {
      current.push(rawLine);
    }
  }
  if (current.length) blocks.push(current);
  return blocks.map(parseManhattanBlock).filter((item) => item.sku && item.upc);
}

// Sheets auto-types numeric-looking cells (UPCs especially) as numbers —
// String()-coerce so they compare correctly against scanned strings.
function sheetRowToMasterItem(row) {
  return {
    sku: String(row["SKU"] ?? row.sku ?? ""),
    upc: String(row["UPC"] ?? row.upc ?? ""),
    dept: String(row["DEPT"] ?? row.dept ?? ""),
    style: String(row["STYLE SKU"] ?? row.style ?? ""),
    color: String(row["COLOR"] ?? row.color ?? ""),
    size: String(row["SIZE"] ?? row.size ?? ""),
    description: String(row["DESCRIPTION"] ?? row.description ?? ""),
    hardTagLocation: String(row["HARD TAG LOCATION"] ?? row.hardTagLocation ?? ""),
  };
}

/* ---------- Consolidations (ConsolMaster is pasted into the sheet directly) ---------- */

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

/* ---------- MAO "Receive Inventory" paste ----------
   A new block starts at each "ETA:" line; only ETA, Package, and PO # are kept.

   ETA:  09-16-2026
   Package  8069559026403610
   Origin  9120
   ...
   PO # 6390185302
*/
function mmddyyyyToISO(s) {
  const m = (s || "").trim().match(/^(\d{2})-(\d{2})-(\d{4})$/);
  return m ? `${m[3]}-${m[1]}-${m[2]}` : (s || "").trim();
}

function parseReceivingPaste(text) {
  const items = [];
  let current = null;
  for (const line of (text || "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean)) {
    const eta = line.match(/^ETA:?\s*(.+)$/i);
    if (eta) {
      if (current) items.push(current);
      current = { expectedDate: mmddyyyyToISO(eta[1]), barcode: "", po: "" };
      continue;
    }
    if (!current) continue;
    const pkg = line.match(/^Package\s+(.+)$/i);
    if (pkg) {
      current.barcode = pkg[1].trim();
      continue;
    }
    const po = line.match(/^PO\s*#\s*(.+)$/i);
    if (po) current.po = po[1].trim();
  }
  if (current) items.push(current);
  return items.filter((item) => item.barcode && item.po);
}

// Received-status fields are only ever set from the server's response,
// never guessed locally, so a re-import can't clear real status.
function upsertReceivingMaster(items) {
  const master = loadJSON(STORE.receivingMaster, []);
  let added = 0;
  let updated = 0;
  for (const item of items) {
    const existing = master.find((p) => p.barcode === item.barcode);
    if (!existing) {
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
      existing.po = item.po;
      existing.expectedDate = item.expectedDate;
      updated++;
    }
  }
  saveJSON(STORE.receivingMaster, master);
  return { added, updated, total: master.length };
}

function sheetRowToReceivingItem(row) {
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

/* ---------- Floor Stock (one FloorRestock sheet, one STATUS lifecycle) ----------
   blank (Check Floor) -> "Not Needed" (done) | "Needed" (Replen)
   "Needed" -> "Picked" (done) | "Out of Stock" (stamps 86, on the 86 Board)
   86 Board -> RESTOCKED stamped (done)
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
    outOfStock: String(row["86"] ?? ""),
    restocked: String(row["RESTOCKED"] ?? ""),
  };
}

function isFloorChecked(item) {
  return (item.status || "").toString().trim() !== "";
}

function isFloorNeeded(item) {
  return item.status === "Needed";
}

function isFloorOn86(item) {
  return (item.outOfStock || "").toString().trim() !== "" && (item.restocked || "").toString().trim() === "";
}

// GENDER "U" marks an accessory restocked from the floor itself — never
// part of the back-of-house lifecycle, so it's dropped on load.
function isFloorAccessory(gender) {
  return (gender || "").toString().trim().toUpperCase() === "U";
}

// Which of the four lifecycle stages a row is at — drives the one progress
// indicator shown on every Floor Stock line, whichever view it's in.
function floorStage(item) {
  if ((item.restocked || "").toString().trim()) return "restocked";
  if (isFloorOn86(item)) return "out";
  if (item.status === "Picked") return "picked";
  if (item.status === "Not Needed") return "notneeded";
  if (isFloorNeeded(item)) return "needed";
  return "check";
}
