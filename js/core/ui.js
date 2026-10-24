"use strict";

/* ---------- Modals ---------- */

function openModal(id) {
  document.getElementById(id).hidden = false;
}

function closeModal(id) {
  document.getElementById(id).hidden = true;
}

// Any element with data-close="<modal id>" closes that modal.
document.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-close]");
  if (btn) closeModal(btn.dataset.close);
});

/* ---------- Toast ---------- */

let toastTimer = null;

function toast(message, isError) {
  const el = document.getElementById("toast");
  el.textContent = message;
  el.classList.toggle("error", !!isError);
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), isError ? 5000 : 2600);
}

/* ---------- Event delegation ----------
   Each view wires one click listener on its root and dispatches on
   data-action, instead of re-binding listeners on every re-render. */
function onAction(root, handlers) {
  root.addEventListener("click", (e) => {
    const el = e.target.closest("[data-action]");
    if (!el || !root.contains(el)) return;
    const fn = handlers[el.dataset.action];
    if (fn) fn(el, e);
  });
}

/* ---------- Shared product search results ----------
   The one result list every module's product search renders into. */
function renderProductResults(container, query, { actionLabel, action, emptyHint } = {}) {
  if (!query) {
    container.hidden = true;
    container.innerHTML = "";
    return [];
  }
  container.hidden = false;
  const matches = searchProducts(query);
  if (matches.length === 0) {
    container.innerHTML = `<div class="no-results">No matches for "${escapeHtml(query)}".${
      emptyHint ? ` ${escapeHtml(emptyHint)}` : ""
    }</div>`;
    return matches;
  }
  container.innerHTML = matches
    .map(
      (item) => `
      <button type="button" class="result-row" data-action="${escapeHtml(action)}" data-sku="${escapeHtml(item.sku)}">
        <span class="result-main">
          <span class="result-title">${escapeHtml(combinedDescription(item))}</span>
          <span class="result-sub mono">${escapeHtml(item.sku)} · UPC ${escapeHtml(item.upc)}</span>
        </span>
        <span class="result-cta">${escapeHtml(actionLabel || "Open")} ›</span>
      </button>`
    )
    .join("");
  return matches;
}

/* ---------- Floor Stock lifecycle indicator ----------
   One small progress strip per line, the same in all three Floor Stock
   views: Needed → Picked / Out of Stock → Restocked. */
const FLOOR_STAGE_LABELS = {
  check: "To check",
  notneeded: "Not needed",
  needed: "Needed",
  picked: "Picked",
  out: "Out of stock",
  restocked: "Restocked",
};

function floorStageStrip(item) {
  const stage = floorStage(item);
  const steps = ["needed", "pick", "restock"];
  const reached = {
    check: 0,
    notneeded: 0,
    needed: 1,
    picked: 3, // picked straight from the back — lifecycle complete
    out: 2,
    restocked: 3,
  }[stage];
  const dots = steps
    .map((s, i) => `<span class="stage-dot${i < reached ? " on" : ""}${stage === "out" && i === 1 ? " warn" : ""}"></span>`)
    .join("");
  return `<span class="stage-strip stage-${stage}" title="${escapeHtml(FLOOR_STAGE_LABELS[stage])}">${dots}<span class="stage-label">${escapeHtml(
    FLOOR_STAGE_LABELS[stage]
  )}</span></span>`;
}

/* ---------- Busy buttons ---------- */

async function withBusy(btn, fn) {
  if (btn.disabled) return;
  btn.disabled = true;
  btn.classList.add("busy");
  try {
    return await fn();
  } finally {
    btn.disabled = false;
    btn.classList.remove("busy");
  }
}

function requireOnline(statusEl, verb = "saved") {
  if (navigator.onLine) return true;
  setStatus(statusEl, `Offline — nothing was ${verb}. Try again once you have a connection.`, true);
  return false;
}
