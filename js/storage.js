"use strict";

const STORAGE = {
  master: "audit.productMaster.v1",
  tagMap: "audit.styleTagMap.v1",
  auditLog: "audit.auditEntries.v1",
  session: "audit.session.v1",
  webhookUrl: "audit.webhookUrl.v1",
};

// Baked-in default so the app works with zero setup. Settings can still
// override this (e.g. if the sheet is ever redeployed to a new URL).
const DEFAULT_WEBHOOK_URL =
  "https://script.google.com/macros/s/AKfycbz_Xhbfp_Cpko5kBIsNik8dhXLNrQ5D2DKpjmqMZpVAxUPyNkgVHi-7417HQQrFJpIr/exec";

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
// upsertProductMaster()'s merge logic.
function sheetRowToMasterItem(row) {
  return {
    sku: row.sku || "",
    upc: row.upc || "",
    dept: row.dept || "",
    style: row.style || "",
    color: row.color || "",
    size: row.size || "",
    description: row.description || "",
  };
}

function combinedDescription(item) {
  const parts = [item.description];
  const colorSize = [item.color, item.size].filter(Boolean).join(" / ");
  if (colorSize) parts.push(colorSize);
  return parts.join(" — ");
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
