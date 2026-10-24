"use strict";

/* ---------- Floor Stock ----------
   Check Floor, Replen, and the 86 Board as three views of one lifecycle on
   one sheet (FloorRestock), each line carrying the same progress strip:
   Check → Needed → Picked | Out of Stock → Restocked.
   Check Floor and Replen decisions stage in Holding and push on Update;
   Restocked on the 86 Board pushes immediately, as before.

   Check Floor works per style + color, not per size: when something sells,
   whoever's checking walks to that style on the floor and sees for
   themselves which sizes are missing, so every sold size of the same
   style/color collapses into one line. The sheet still keeps one row per
   sold size (the backend and the original app depend on that), so a line's
   decision is translated back into per-row decisions on Update — see
   planCheckFloor(). Replen is grouped the same way for reading, but picking
   stays per size, since that's what someone actually pulls from the back. */

let floorSub = "check";
let floorNeededTarget = null; // group key being sized in the Needed modal
let floorManualDescription = "";

const FLOOR_SUBS = ["check", "replen", "86"];

function loadRestock() {
  return loadJSON(STORE.floorRestock, []);
}

// sku+size isn't unique over time (sell out, restock, sell out again), so
// every match also checks the row is at the right lifecycle stage.
function findRestockRow(restock, sku, size, predicate) {
  return restock.find((p) => p.sku === sku && p.size === size && predicate(p)) || null;
}

function floorGroupKey(item) {
  return `${normalize(item.description)}|${normalize(item.color)}`;
}

// Groups rows by style + color, keeping first-seen description/color text.
function groupFloorRows(rows) {
  const groups = new Map();
  for (const row of rows) {
    const key = floorGroupKey(row);
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { key, description: row.description, color: row.color, rows: [], qtySold: 0 }));
    g.rows.push(row);
    g.qtySold += Number(row.qtySold) || 0;
  }
  return [...groups.values()].sort((a, b) => a.description.localeCompare(b.description) || a.color.localeCompare(b.color));
}

function checkFloorGroups(restock) {
  return groupFloorRows(restock.filter((r) => !isFloorChecked(r)));
}

/* ---------- Holding ----------
   Check Floor holding is one entry per style/color line:
     { key, description, color, status, sizes }
   Replen holding stays one entry per sized row: { sku, size, ..., action } */

function loadCheckHolding() {
  // Entries staged by the earlier per-size version carry sku/size instead
  // of a group key — fold them into the line they belong to.
  return loadJSON(STORE.checkFloorHolding, []).map((h) => (h.key ? h : { ...h, key: floorGroupKey(h) }));
}

function isCheckGroupHeld(key) {
  return loadCheckHolding().some((h) => h.key === key);
}

function isReplenHeld(sku, size) {
  return loadJSON(STORE.replenHolding, []).some((h) => h.sku === sku && h.size === size);
}

function stageCheckGroup(key, status, sizes) {
  const group = checkFloorGroups(loadRestock()).find((g) => g.key === key);
  if (!group || isCheckGroupHeld(key)) return;
  const holding = loadCheckHolding();
  holding.push({ key, description: group.description, color: group.color, status, sizes });
  saveJSON(STORE.checkFloorHolding, holding);
  renderFloor();
}

function stageReplenRow(entry) {
  if (isReplenHeld(entry.sku, entry.size)) return;
  const holding = loadJSON(STORE.replenHolding, []);
  holding.push(entry);
  saveJSON(STORE.replenHolding, holding);
  renderFloor();
}

function unstageFloor(el) {
  if (el.dataset.which === "check") {
    saveJSON(STORE.checkFloorHolding, loadCheckHolding().filter((h) => h.key !== el.dataset.key));
  } else {
    saveJSON(
      STORE.replenHolding,
      loadJSON(STORE.replenHolding, []).filter((h) => !(h.sku === el.dataset.sku && h.size === el.dataset.size))
    );
  }
  renderFloor();
}

/* ---------- Sub-view switching ---------- */

function setFloorSub(sub) {
  floorSub = FLOOR_SUBS.includes(sub) ? sub : "check";
  saveJSON(STORE.floorView, floorSub);
  document.querySelectorAll("#floor-tabs [data-sub]").forEach((b) => {
    const on = b.dataset.sub === floorSub;
    b.classList.toggle("active", on);
    b.setAttribute("aria-selected", on ? "true" : "false");
  });
  FLOOR_SUBS.forEach((s) => (document.getElementById(`floor-panel-${s}`).hidden = s !== floorSub));
}

/* ---------- Line rendering ---------- */

function floorLine(item, buttons) {
  return `
    <div class="line-card">
      <div class="line-main">
        <div class="line-title">${escapeHtml(item.description)}${item.size ? ` <span class="size-tag">${escapeHtml(item.size)}</span>` : ""}</div>
        <div class="line-sub">${escapeHtml(item.color || "")}${item.color ? " · " : ""}<span class="mono">${escapeHtml(item.sku)}</span>${
    item.qtySold || item.onHand ? ` · sold ${item.qtySold} · on hand ${item.onHand}` : ""
  }</div>
        ${floorStageStrip(item)}
      </div>
      <div class="line-controls">${buttons}</div>
    </div>`;
}

function holdingRows(which, rows, labelFn) {
  if (!rows.length) return `<p class="hint">Nothing staged.</p>`;
  return rows
    .map((h) => {
      const ids =
        which === "check"
          ? `data-key="${escapeHtml(h.key)}"`
          : `data-sku="${escapeHtml(h.sku)}" data-size="${escapeHtml(h.size)}"`;
      const sizeTag = which === "replen" && h.size ? ` <span class="size-tag">${escapeHtml(h.size)}</span>` : "";
      return `
      <div class="list-row static">
        <span>${escapeHtml(h.description)}${h.color ? " — " + escapeHtml(h.color) : ""}${sizeTag}<br>
          <span class="hint">${escapeHtml(labelFn(h))}</span></span>
        <button type="button" class="btn secondary small" data-action="floor-unstage" data-which="${which}" ${ids}>Remove</button>
      </div>`;
    })
    .join("");
}

function renderFloorCounts(restock) {
  const nCheck = checkFloorGroups(restock).length;
  const nReplen = restock.filter(isFloorNeeded).length;
  const n86 = restock.filter(isFloorOn86).length;
  document.getElementById("floor-n-check").textContent = nCheck || "";
  document.getElementById("floor-n-replen").textContent = nReplen || "";
  document.getElementById("floor-n-86").textContent = n86 || "";

  const checked = restock.filter((i) => i.checkedDate);
  const el = document.getElementById("floor-last-check");
  if (!checked.length) {
    el.textContent = "Floor not checked yet.";
  } else {
    const latest = checked.reduce((a, b) => (new Date(a.checkedDate) > new Date(b.checkedDate) ? a : b));
    el.textContent = `Last checked ${new Date(latest.checkedDate).toLocaleString([], {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    })} by ${latest.checkedBy || "—"}`;
  }
}

function renderCheckPanel(restock) {
  const holding = loadCheckHolding();
  document.getElementById("floor-check-holding-count").textContent = holding.length ? `${holding.length} staged` : "";
  document.getElementById("floor-check-update").disabled = !holding.length;
  document.getElementById("floor-check-holding").innerHTML = holdingRows("check", holding, (h) =>
    h.status === "Needed" ? `Needed · sizes ${h.sizes.join(", ")}` : "Not needed"
  );

  const filter = normalize(document.getElementById("floor-check-filter").value);
  const groups = checkFloorGroups(restock);
  const remaining = groups.filter((g) => !isCheckGroupHeld(g.key));
  const shown = remaining.filter(
    (g) => !filter || [g.description, g.color, ...g.rows.map((r) => r.sku)].some((f) => normalize(f).includes(filter))
  );
  document.getElementById("floor-check-count").textContent = `${shown.length} of ${plural(remaining.length, "style")} to check`;

  const el = document.getElementById("floor-check-list");
  el.innerHTML = shown.length
    ? shown
        .map((g) => {
          const key = escapeHtml(g.key);
          return `
          <div class="line-card">
            <div class="line-main">
              <div class="line-title">${escapeHtml(g.description)}</div>
              <div class="line-sub">${escapeHtml(g.color || "—")}${g.qtySold ? ` · ${g.qtySold} sold` : ""}</div>
            </div>
            <div class="line-controls">
              <button type="button" class="btn primary small" data-action="floor-needed" data-key="${key}">Needed</button>
              <button type="button" class="btn secondary small" data-action="floor-not-needed" data-key="${key}">Not needed</button>
            </div>
          </div>`;
        })
        .join("")
    : `<p class="no-results">${
        restock.length === 0
          ? "No sold items — paste MAO's Items Sold export into the FloorRestock sheet, then tap ↻."
          : remaining.length === 0
          ? "Everything's been checked."
          : "No items match that filter."
      }</p>`;
}

function renderReplenPanel(restock) {
  const holding = loadJSON(STORE.replenHolding, []);
  document.getElementById("floor-replen-holding-count").textContent = holding.length ? `${holding.length} staged` : "";
  document.getElementById("floor-replen-update").disabled = !holding.length;
  document.getElementById("floor-replen-holding").innerHTML = holdingRows("replen", holding, (h) =>
    h.action === "picked" ? "Picked" : "Out of stock → 86 Board"
  );

  const remaining = restock.filter((i) => isFloorNeeded(i) && !isReplenHeld(i.sku, i.size));
  const groups = groupFloorRows(remaining);
  document.getElementById("floor-replen-count").textContent = `${plural(remaining.length, "size")} across ${plural(groups.length, "style")}`;
  document.getElementById("floor-replen-list").innerHTML = groups.length
    ? groups
        .map((g) => {
          const oldest = Math.max(...g.rows.map((r) => daysAgo(r.checkedDate) ?? 0));
          const stale = oldest >= FLOOR_NEEDED_STALE_DAYS;
          const sizes = g.rows
            .map((r) => {
              const ids = `data-sku="${escapeHtml(r.sku)}" data-size="${escapeHtml(r.size)}"`;
              return `
              <div class="size-row">
                <span class="size-tag">${escapeHtml(r.size || "Any")}</span>
                <span class="size-row-actions">
                  <button type="button" class="btn primary small" data-action="floor-picked" ${ids}>Picked</button>
                  <button type="button" class="btn secondary small" data-action="floor-oos" ${ids}>Out of stock</button>
                </span>
              </div>`;
            })
            .join("");
          return `
          <div class="line-card stacked">
            <div class="line-main">
              <div class="line-title">${escapeHtml(g.description)}</div>
              <div class="line-sub">${escapeHtml(g.color || "—")}${stale ? ` · <span class="age">needed ${escapeHtml(formatAge(oldest))}</span>` : ""}</div>
            </div>
            <div class="size-rows">${sizes}</div>
          </div>`;
        })
        .join("")
    : `<p class="no-results">Nothing to pick right now.</p>`;
}

function render86Panel(restock) {
  const out = restock.filter(isFloorOn86).sort((a, b) => new Date(b.outOfStock) - new Date(a.outOfStock));
  document.getElementById("floor-86-count").textContent = `${plural(out.length, "item")} out of stock`;
  document.getElementById("floor-86-list").innerHTML = out.length
    ? out
        .map((i) =>
          floorLine(
            { ...i, color: `${i.color}${i.color ? " · " : ""}86'd ${formatDay(i.outOfStock)}` },
            `<button type="button" class="btn primary small" data-action="floor-restocked" data-sku="${escapeHtml(i.sku)}" data-size="${escapeHtml(
              i.size
            )}">Restocked</button>`
          )
        )
        .join("")
    : `<p class="no-results">Nothing on the 86 Board.</p>`;
}

function renderFloor() {
  const restock = loadRestock();
  renderFloorCounts(restock);
  renderCheckPanel(restock);
  renderReplenPanel(restock);
  render86Panel(restock);
}

/* ---------- Check Floor: Needed modal (pick sizes) ---------- */

function sizeCheckboxes(containerId, cls, otherId, otherLabel) {
  document.getElementById(containerId).innerHTML =
    FLOOR_CORE_SIZES.map(
      (s) => `<label class="size-check"><input type="checkbox" class="${cls}" value="${escapeHtml(s)}"><span>${escapeHtml(s)}</span></label>`
    ).join("") + `<label class="size-check"><input type="checkbox" id="${otherId}"><span>${escapeHtml(otherLabel)}</span></label>`;
}

function openNeededModal(key) {
  const group = checkFloorGroups(loadRestock()).find((g) => g.key === key);
  if (!group) return;
  floorNeededTarget = key;
  document.getElementById("floor-needed-label").textContent = `${group.description}${group.color ? " — " + group.color : ""}`;
  sizeCheckboxes("floor-needed-sizes", "floor-needed-size", "floor-needed-other", "Other (any size)");
  setStatus("floor-needed-status", "", false);
  openModal("floor-needed-modal");
}

function saveNeededModal() {
  if (!floorNeededTarget) return;
  const wrap = document.getElementById("floor-needed-sizes");
  const picked = [...wrap.querySelectorAll(".floor-needed-size:checked")].map((cb) => cb.value);
  const sizes = document.getElementById("floor-needed-other").checked ? ["Other"] : picked;
  if (!sizes.length) {
    setStatus("floor-needed-status", "Pick at least one size, or Other.", true);
    return;
  }
  const key = floorNeededTarget;
  floorNeededTarget = null;
  closeModal("floor-needed-modal");
  stageCheckGroup(key, "Needed", sizes);
}

/* Translates staged style/color decisions into the backend's per-row
   decisions (each one { sku, size, status, sizes } against a blank-status
   row, exactly what the original app sends):
   - Not needed: every sold row in the line → "Not Needed".
   - Needed with sizes S: a sold row whose size is in S → "Needed"; every
     other sold row → "Not Needed" (it was looked at, and isn't needed).
     Sizes in S with no sold row ride along as extras on one Needed row —
     the backend appends one new "Needed" row per extra. If no sold row's
     size was picked at all, a blank row is added first (floorrestockadd)
     to carry them, so nothing gets marked Needed in a size nobody picked.
   Returns { adds, decisions }. */
function planCheckFloor(holding, restock) {
  const groups = new Map(checkFloorGroups(restock).map((g) => [g.key, g]));
  const adds = [];
  const decisions = [];
  for (const h of holding) {
    const g = groups.get(h.key);
    if (!g) continue;
    if (h.status !== "Needed") {
      g.rows.forEach((r) => decisions.push({ sku: r.sku, size: r.size, status: "Not Needed", sizes: [] }));
      continue;
    }
    const wanted = h.sizes.map(String);
    const covered = new Set();
    let carrier = null;
    for (const r of g.rows) {
      const size = String(r.size);
      if (wanted.includes(size) && !covered.has(size)) {
        covered.add(size);
        const d = { sku: r.sku, size: r.size, status: "Needed", sizes: [] };
        if (!carrier) carrier = d;
        decisions.push(d);
      } else {
        decisions.push({ sku: r.sku, size: r.size, status: "Not Needed", sizes: [] });
      }
    }
    const missing = wanted.filter((s) => !covered.has(s));
    if (!missing.length) continue;
    if (carrier) {
      carrier.sizes = [carrier.size, ...missing];
    } else {
      const base = g.rows[0];
      adds.push({ sku: base.sku, size: missing[0], description: base.description, color: base.color, gender: base.gender });
      decisions.push({ sku: base.sku, size: missing[0], status: "Needed", sizes: missing });
    }
  }
  return { adds, decisions };
}

async function commitCheckFloor(btn) {
  const holding = loadCheckHolding();
  if (!holding.length || !requireOnline("floor-check-status", "updated")) return;
  const initials = currentInitials();
  const date = todayISO();
  setStatus("floor-check-status", `Updating ${plural(holding.length, "style")}…`, false);

  await withBusy(btn, async () => {
    try {
      const { adds, decisions } = planCheckFloor(holding, loadRestock());
      // Carrier rows first, mirrored locally as each lands, so a failure
      // partway leaves this device matching the sheet.
      for (const a of adds) {
        await api.floorRestockAdd(a);
        const restock = loadRestock();
        restock.push(blankRestockRow(a));
        saveJSON(STORE.floorRestock, restock);
      }
      await api.checkFloorUpdate({ initials, date, decisions });

      // Mirror the server, in order: stamp the first blank row matching
      // each decision; a Needed decision appends a row per extra size.
      const restock = loadRestock();
      const nowIso = new Date().toISOString();
      for (const d of decisions) {
        const row = findRestockRow(restock, d.sku, d.size, (p) => !isFloorChecked(p));
        if (!row) continue;
        row.status = d.status;
        row.checkedBy = initials;
        row.checkedDate = nowIso;
        if (d.status === "Needed") {
          for (const size of d.sizes.filter((s) => String(s) !== String(row.size))) {
            restock.push({ ...row, size, qtySold: 0, onHand: 0, status: "Needed", outOfStock: "", restocked: "" });
          }
        }
      }
      saveJSON(STORE.floorRestock, restock);
      saveJSON(STORE.checkFloorHolding, []);
      renderFloor();
      updateExceptionBadge();
      setStatus("floor-check-status", `Updated ${plural(holding.length, "style")}. Needed sizes are on Replen now.`, false);
    } catch (e) {
      renderFloor();
      setStatus("floor-check-status", "Couldn't reach the sheet — items stay staged. Try again.", true);
    }
  });
}

/* ---------- Check Floor: add a product that isn't on the sold list ---------- */

async function addCatalogProductToCheck(sku) {
  const item = findProductBySku(sku);
  if (!item) return;
  const restock = loadRestock();
  if (checkFloorGroups(restock).some((g) => g.key === floorGroupKey(item))) {
    setStatus("floor-lookup-status", `${item.description} — ${item.color} is already on the Check Floor list.`, true);
    return;
  }
  if (!requireOnline("floor-lookup-status", "added")) return;
  setStatus("floor-lookup-status", "Adding…", false);
  try {
    await api.floorRestockAdd({ sku: item.sku, size: item.size, description: item.description, color: item.color });
    restock.push(blankRestockRow({ sku: item.sku, size: item.size, description: item.description, color: item.color }));
    saveJSON(STORE.floorRestock, restock);
    document.getElementById("floor-search").value = "";
    renderFloorSearch();
    renderFloor();
    setStatus("floor-lookup-status", `Added ${combinedDescription(item)} to Check Floor.`, false);
  } catch (e) {
    setStatus("floor-lookup-status", "Couldn't reach the sheet — try again.", true);
  }
}

function blankRestockRow(fields) {
  return {
    gender: "",
    category: "",
    description: "",
    color: "",
    size: "",
    sku: "",
    qtySold: 0,
    onHand: 0,
    status: "",
    checkedBy: "",
    checkedDate: "",
    outOfStock: "",
    restocked: "",
    ...fields,
  };
}

function renderFloorSearch() {
  const q = document.getElementById("floor-search").value.trim();
  renderProductResults(document.getElementById("floor-results"), q, { action: "floor-add-product", actionLabel: "Add" });
  const manual = document.getElementById("floor-manual-btn");
  manual.hidden = !q;
  manual.textContent = `Not in the catalog? Add "${q}" by hand…`;
}

// Not on the sold list or in the catalog at all: whatever's typed in the
// search becomes the description, with a synthetic SKU so it flows through
// the same sku+size lifecycle as every other row. Staged as Needed.
function openManualModal() {
  const description = document.getElementById("floor-search").value.trim();
  if (!description) return;
  floorManualDescription = description;
  document.getElementById("floor-manual-label").textContent = description;
  sizeCheckboxes("floor-manual-sizes", "floor-manual-size", "floor-manual-other", "Other");
  const other = document.getElementById("floor-manual-other-size");
  other.value = "";
  other.hidden = true;
  document.getElementById("floor-manual-other").addEventListener("change", (e) => {
    other.hidden = !e.target.checked;
    if (e.target.checked) other.focus();
  });
  setStatus("floor-manual-status", "", false);
  openModal("floor-manual-modal");
}

async function saveManualEntry() {
  const sizes = [...document.querySelectorAll(".floor-manual-size:checked")].map((cb) => cb.value);
  const otherSize = document.getElementById("floor-manual-other-size").value.trim();
  if (document.getElementById("floor-manual-other").checked && otherSize) sizes.push(otherSize);
  if (!sizes.length) {
    setStatus("floor-manual-status", "Pick at least one size, or enter one under Other.", true);
    return;
  }
  if (!requireOnline("floor-manual-status", "added")) return;

  const description = floorManualDescription;
  const sku = "MANUAL-" + uid();
  const ownSize = sizes[0];
  closeModal("floor-manual-modal");
  setStatus("floor-lookup-status", "Adding…", false);
  try {
    await api.floorRestockAdd({ sku, size: ownSize, description, color: "" });
    const restock = loadRestock();
    restock.push(blankRestockRow({ sku, size: ownSize, description }));
    saveJSON(STORE.floorRestock, restock);
    stageCheckGroup(floorGroupKey({ description, color: "" }), "Needed", sizes);
    document.getElementById("floor-search").value = "";
    renderFloorSearch();
    setStatus("floor-lookup-status", `Added ${description} — staged as Needed. Tap Update to push it.`, false);
  } catch (e) {
    setStatus("floor-lookup-status", "Couldn't reach the sheet — try again.", true);
  }
}

/* ---------- Replen ---------- */

function stageReplen(sku, size, action) {
  const item = findRestockRow(loadRestock(), sku, size, isFloorNeeded);
  if (!item) return;
  stageReplenRow({ sku, size, description: item.description, color: item.color, action });
}

async function commitReplen(btn) {
  const holding = loadJSON(STORE.replenHolding, []);
  if (!holding.length || !requireOnline("floor-replen-status", "updated")) return;
  const nowIso = new Date().toISOString();
  setStatus("floor-replen-status", `Updating ${plural(holding.length, "item")}…`, false);

  await withBusy(btn, async () => {
    try {
      await api.floorPickUpdate({ date: todayISO(), decisions: holding.map((h) => ({ sku: h.sku, size: h.size, action: h.action })) });
      const restock = loadRestock();
      for (const h of holding) {
        const row = findRestockRow(restock, h.sku, h.size, isFloorNeeded);
        if (!row) continue;
        row.status = h.action === "picked" ? "Picked" : "Out of Stock";
        if (h.action === "outOfStock") row.outOfStock = nowIso;
      }
      saveJSON(STORE.floorRestock, restock);
      saveJSON(STORE.replenHolding, []);
      renderFloor();
      updateExceptionBadge();
      setStatus("floor-replen-status", `Updated ${plural(holding.length, "item")}.`, false);
    } catch (e) {
      setStatus("floor-replen-status", "Couldn't reach the sheet — items stay staged. Try again.", true);
    }
  });
}

/* ---------- 86 Board ---------- */

async function markRestocked(sku, size, btn) {
  if (!requireOnline("floor-86-status", "updated")) return;
  await withBusy(btn, async () => {
    try {
      await api.floor86Restock({ date: todayISO(), items: [{ sku, size }] });
      const restock = loadRestock();
      const row = findRestockRow(restock, sku, size, isFloorOn86);
      if (row) row.restocked = new Date().toISOString();
      saveJSON(STORE.floorRestock, restock);
      renderFloor();
      toast("Marked restocked");
    } catch (e) {
      setStatus("floor-86-status", "Couldn't reach the sheet — try again.", true);
    }
  });
}

registerView("floor", {
  init(root) {
    floorSub = loadJSON(STORE.floorView, "check");
    document.getElementById("floor-check-filter").addEventListener("input", () => renderCheckPanel(loadRestock()));
    document.getElementById("floor-search").addEventListener("input", renderFloorSearch);
    document.getElementById("floor-needed-save-btn").addEventListener("click", saveNeededModal);
    // "Other" means any size will do — exclusive with picking specific ones.
    const neededWrap = document.getElementById("floor-needed-sizes");
    neededWrap.addEventListener("change", (e) => {
      if (e.target.id === "floor-needed-other" && e.target.checked) {
        neededWrap.querySelectorAll(".floor-needed-size").forEach((cb) => (cb.checked = false));
      } else if (e.target.classList.contains("floor-needed-size") && e.target.checked) {
        document.getElementById("floor-needed-other").checked = false;
      }
    });
    document.getElementById("floor-manual-save-btn").addEventListener("click", saveManualEntry);

    onAction(root, {
      "floor-tab": (el) => goTo(`floor/${el.dataset.sub}`),
      "floor-needed": (el) => openNeededModal(el.dataset.key),
      "floor-not-needed": (el) => stageCheckGroup(el.dataset.key, "Not Needed", []),
      "floor-unstage": unstageFloor,
      "floor-check-update": commitCheckFloor,
      "floor-add-product": (el) => addCatalogProductToCheck(el.dataset.sku),
      "floor-manual": openManualModal,
      "floor-picked": (el) => stageReplen(el.dataset.sku, el.dataset.size, "picked"),
      "floor-oos": (el) => stageReplen(el.dataset.sku, el.dataset.size, "outOfStock"),
      "floor-replen-update": commitReplen,
      "floor-restocked": (el) => markRestocked(el.dataset.sku, el.dataset.size, el),
    });
  },

  show(sub) {
    setFloorSub(sub || floorSub);
    renderFloorSearch();
    renderFloor();
  },
});
