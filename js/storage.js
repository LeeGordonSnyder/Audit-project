"use strict";

const STORAGE = {
  master: "audit.productMaster.v1",
  tagMap: "audit.styleTagMap.v1",
  auditLog: "audit.auditEntries.v1",
  adjustments: "audit.adjustments.v1",
  session: "audit.session.v1",
};

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
  ["available", /^Available(.+)$/i],
];

function parseManhattanBlock(lines) {
  const item = { description: "", sku: "", dept: "", style: "", color: "", size: "", upc: "", expectedCount: 0 };
  for (const rawLine of lines) {
    const line = rawLine.trim();
    let matched = false;
    for (const [key, re] of MANHATTAN_LABELS) {
      const m = line.match(re);
      if (m) {
        if (key === "available") {
          const nums = m[1].match(/(\d+)\s*\/\s*(\d+)/);
          item.expectedCount = nums ? parseInt(nums[1], 10) : 0;
        } else {
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
      master.push({ ...item, updatedAt: now });
      added++;
    } else {
      master[idx].expectedCount = item.expectedCount;
      master[idx].updatedAt = now;
      updated++;
    }
  }

  saveJSON(STORAGE.master, master);
  return { added, updated, total: master.length };
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
