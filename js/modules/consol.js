"use strict";

/* ---------- Consolidations ----------
   Same model as before, refined rather than replaced:
   - Actioned decisions stage in Holding; one Update pushes them all.
   - Actual Count pushes on every tap (coalesced per line) — never staged.
   - Close-a-Box is independent of both, gated by the MAO reminder. */

const consolCountSync = {}; // eccMaterial -> { inFlight, pendingValue }

function loadConsolHolding() {
  return loadJSON(STORE.consolHolding, []);
}

function saveConsolHolding(h) {
  saveJSON(STORE.consolHolding, h);
}

function isConsolHeld(ecc) {
  return loadConsolHolding().some((h) => h.eccMaterial === ecc);
}

function findConsolItem(ecc) {
  return loadJSON(STORE.consolMaster, []).find((p) => p.eccMaterial === ecc) || null;
}

function stageConsolActioned(ecc) {
  const item = findConsolItem(ecc);
  if (!item || isConsolHeld(ecc)) return;
  const holding = loadConsolHolding();
  // stagedAt lets Home call out anything left sitting in Holding.
  holding.push({ eccMaterial: item.eccMaterial, description: item.description, color: item.color, status: "Actioned", stagedAt: todayISO() });
  saveConsolHolding(holding);
  renderConsol();
}

function unstageConsol(ecc) {
  saveConsolHolding(loadConsolHolding().filter((h) => h.eccMaterial !== ecc));
  renderConsol();
}

function renderConsolHolding() {
  const holding = loadConsolHolding();
  document.getElementById("consol-holding-count").textContent = holding.length ? `${holding.length} staged` : "";
  document.getElementById("consol-update-btn").disabled = holding.length === 0;
  const el = document.getElementById("consol-holding");
  el.innerHTML = holding.length
    ? holding
        .map(
          (h) => `
        <div class="list-row static">
          <span>${escapeHtml(h.description)} — ${escapeHtml(h.color)}<br><span class="hint">${escapeHtml(h.status)}${
            h.stagedAt ? " · staged " + escapeHtml(formatDay(h.stagedAt)) : ""
          }</span></span>
          <button type="button" class="btn secondary small" data-action="consol-unstage" data-ecc="${escapeHtml(h.eccMaterial)}">Remove</button>
        </div>`
        )
        .join("")
    : `<p class="hint">Nothing staged — mark items Actioned below.</p>`;
}

function getConsolActualCount(ecc) {
  const entry = loadJSON(STORE.consolLog, []).find((e) => e.entryType === "count" && e.eccMaterial === ecc);
  return entry ? Number(entry.actualCount) || 0 : 0;
}

function setConsolActualCountLocal(item, value) {
  const log = loadJSON(STORE.consolLog, []);
  let entry = log.find((e) => e.entryType === "count" && e.eccMaterial === item.eccMaterial);
  if (!entry) {
    entry = {
      id: "count-" + item.eccMaterial,
      entryType: "count",
      timestamp: "",
      date: todayISO(),
      initials: "",
      eccMaterial: item.eccMaterial,
      description: item.description,
      color: item.color,
      status: "",
      size: "",
      actualCount: 0,
      referenceNumber: "",
      synced: false,
    };
    log.unshift(entry);
  }
  entry.actualCount = value;
  entry.timestamp = new Date().toISOString();
  saveJSON(STORE.consolLog, log);
}

function setConsolCount(ecc, value) {
  const item = findConsolItem(ecc);
  if (!item) return;
  setConsolActualCountLocal(item, Math.max(0, value));
  renderConsolList();
  syncConsolCount(item);
}

// Every push sends the absolute count, so a failed push is simply
// superseded by the next tap; taps during an in-flight push coalesce.
async function syncConsolCount(item) {
  const state = consolCountSync[item.eccMaterial] || (consolCountSync[item.eccMaterial] = { inFlight: false, pendingValue: null });
  state.pendingValue = getConsolActualCount(item.eccMaterial);
  if (state.inFlight) return;
  state.inFlight = true;
  while (state.pendingValue !== null) {
    const value = state.pendingValue;
    state.pendingValue = null;
    try {
      await api.consolCountUpdate({
        eccMaterial: item.eccMaterial,
        description: item.description,
        color: item.color,
        actualCount: value,
        initials: currentInitials(),
      });
      const log = loadJSON(STORE.consolLog, []);
      const entry = log.find((e) => e.entryType === "count" && e.eccMaterial === item.eccMaterial);
      if (entry && entry.actualCount === value) {
        entry.synced = true;
        saveJSON(STORE.consolLog, log);
      }
    } catch (e) {
      setStatus("consol-status", "Couldn't save that count to the sheet — it'll go up with your next tap.", true);
      break;
    }
  }
  state.inFlight = false;
}

function renderConsolList() {
  const master = loadJSON(STORE.consolMaster, []);
  const filter = normalize(document.getElementById("consol-filter").value);
  const processed = master.filter(isConsolProcessed).length;
  const remaining = master.filter((i) => !isConsolProcessed(i) && !isConsolHeld(i.eccMaterial));
  const held = master.length - remaining.length - processed;
  const shown = remaining.filter(
    (i) =>
      !filter ||
      [i.description, i.styleSku, i.color, i.eccMaterial, i.destination].some((f) => normalize(f).includes(filter))
  );

  document.getElementById("consol-count").textContent =
    `${shown.length} of ${remaining.length} remaining` +
    (held ? ` · ${held} in holding` : "") +
    (processed ? ` · ${processed} processed` : "");

  const el = document.getElementById("consol-list");
  if (!shown.length) {
    el.innerHTML = `<p class="no-results">${
      master.length === 0
        ? "No consolidation items — paste HQ's list into the ConsolMaster sheet, then tap ↻."
        : remaining.length === 0
        ? "All items processed — nothing left to consolidate."
        : "No items match that filter."
    }</p>`;
    return;
  }

  el.innerHTML = shown
    .slice()
    .sort((a, b) => a.description.localeCompare(b.description) || a.color.localeCompare(b.color))
    .map((item) => {
      const actual = getConsolActualCount(item.eccMaterial);
      const complete = item.total > 0 && actual >= item.total;
      const ecc = escapeHtml(item.eccMaterial);
      return `
      <div class="line-card${complete ? " complete" : ""}">
        <div class="line-main">
          <div class="line-title">${escapeHtml(item.description)}</div>
          <div class="line-sub">${escapeHtml(item.color)} · <span class="mono">${escapeHtml(item.styleSku)}</span> · to ${escapeHtml(
        item.destination || "—"
      )}</div>
        </div>
        <div class="line-controls">
          <div class="stepper" aria-label="Actual count">
            <button type="button" class="btn secondary small" data-action="consol-dec" data-ecc="${ecc}" aria-label="Decrease">−</button>
            <input type="number" inputmode="numeric" min="0" class="stepper-input" data-ecc="${ecc}" value="${actual}" aria-label="Actual count">
            <button type="button" class="btn secondary small" data-action="consol-inc" data-ecc="${ecc}" aria-label="Increase">+</button>
            <span class="stepper-total">/ ${item.total}</span>
          </div>
          <button type="button" class="btn primary small" data-action="consol-stage" data-ecc="${ecc}">Actioned</button>
        </div>
      </div>`;
    })
    .join("");
}

async function commitConsolUpdate(btn) {
  const holding = loadConsolHolding();
  if (!holding.length || !requireOnline("consol-status", "updated")) return;
  const initials = currentInitials();
  const date = todayISO();
  setStatus("consol-status", `Updating ${plural(holding.length, "item")}…`, false);

  await withBusy(btn, async () => {
    try {
      await api.consolUpdate({
        initials,
        date,
        decisions: holding.map((h) => ({ eccMaterial: h.eccMaterial, description: h.description, color: h.color, status: h.status })),
      });
      const master = loadJSON(STORE.consolMaster, []);
      const log = loadJSON(STORE.consolLog, []);
      const nowIso = new Date().toISOString();
      for (const h of holding) {
        const m = master.find((p) => p.eccMaterial === h.eccMaterial);
        if (m) m.processed = "Processed";
        log.unshift({
          id: uid(),
          entryType: "status",
          timestamp: nowIso,
          date,
          initials,
          eccMaterial: h.eccMaterial,
          description: h.description,
          color: h.color,
          status: "Actioned",
          size: "",
          actualCount: 0,
          referenceNumber: "",
          synced: true,
        });
      }
      saveJSON(STORE.consolMaster, master);
      saveJSON(STORE.consolLog, log);
      saveConsolHolding([]);
      renderConsol();
      updateExceptionBadge();
      setStatus("consol-status", `Updated ${plural(holding.length, "item")}.`, false);
    } catch (e) {
      setStatus("consol-status", "Couldn't reach the sheet — items stay staged. Try again.", true);
    }
  });
}

/* ---------- Close a Box ---------- */

// Confirm-only checkpoint: closing the box here doesn't close it in MAO,
// and this app can't see MAO — so it can't be dismissed unacknowledged.
function showMaoReminder(reference) {
  return new Promise((resolve) => {
    document.getElementById("mao-reminder-reference").textContent = reference;
    openModal("mao-reminder-modal");
    const btn = document.getElementById("mao-reminder-confirm-btn");
    btn.addEventListener(
      "click",
      () => {
        closeModal("mao-reminder-modal");
        resolve();
      },
      { once: true }
    );
  });
}

function startBoxCloseScan() {
  openScanner("Scan the packing slip…", handleBoxClose);
}

async function handleBoxClose(reference) {
  await showMaoReminder(reference);
  if (!requireOnline("consol-packout-status", "logged")) return;
  const date = todayISO();
  const initials = currentInitials();
  setStatus("consol-packout-status", `Logging box ${reference} closed…`, false);
  try {
    await api.consolBoxClose({ referenceNumber: reference, date, initials });
    const log = loadJSON(STORE.consolLog, []);
    log.unshift({
      id: uid(),
      entryType: "packout",
      timestamp: new Date().toISOString(),
      date,
      initials,
      eccMaterial: "",
      description: "",
      color: "",
      status: "",
      size: "",
      actualCount: 0,
      referenceNumber: reference,
      synced: true,
    });
    saveJSON(STORE.consolLog, log);
    renderConsolLog();
    setStatus("consol-packout-status", `Box ${reference} closed and logged.`, false);
  } catch (e) {
    setStatus("consol-packout-status", `Box ${reference}: couldn't reach the sheet — scan again once connected.`, true);
  }
}

function closeBoxManually() {
  const input = document.getElementById("consol-box-ref");
  const ref = input.value.trim();
  if (!ref) {
    setStatus("consol-packout-status", "Enter the packing slip reference first.", true);
    return;
  }
  input.value = "";
  handleBoxClose(ref);
}

/* ---------- Log ---------- */

function renderConsolLog() {
  const log = loadJSON(STORE.consolLog, []).filter((e) => e.status !== "Resolved" && e.entryType !== "count");
  const el = document.getElementById("consol-log");
  if (!log.length) {
    el.innerHTML = `<p class="hint">No consolidation activity yet.</p>`;
    return;
  }
  el.innerHTML = log
    .slice(0, 50)
    .map((e) => {
      if (e.entryType === "packout") {
        return `<div class="entry"><div class="entry-top"><span class="entry-title">📦 Box closed</span><span class="pill pill-ok mono">${escapeHtml(
          e.referenceNumber
        )}</span></div><div class="entry-meta">${escapeHtml(e.initials || "—")} · ${escapeHtml(formatDay(e.date))}</div></div>`;
      }
      // "Needs Adjustment" can't be created anymore; older entries still
      // live in the sheet and can still be resolved here.
      const adj = e.status === "Needs Adjustment";
      return `<div class="entry">
        <div class="entry-top"><span class="entry-title">${escapeHtml(e.description)} — ${escapeHtml(e.color)}</span>
          <span class="pill ${adj ? "pill-warn" : "pill-ok"}">${escapeHtml(e.status)}</span></div>
        <div class="entry-meta">${adj ? `Size ${escapeHtml(e.size)} · ${escapeHtml(e.actualCount)} out · ` : ""}${escapeHtml(
        e.initials || "—"
      )} · ${escapeHtml(formatDay(e.date))}
          ${adj ? `<button type="button" class="link-btn" data-action="consol-resolve" data-id="${escapeHtml(e.id)}">Resolve</button>` : ""}
        </div></div>`;
    })
    .join("");
}

async function resolveConsolEntry(id) {
  if (!requireOnline("consol-status", "updated")) return;
  try {
    await api.consolLogResolve({ id });
    const log = loadJSON(STORE.consolLog, []);
    const entry = log.find((e) => e.id === id);
    if (entry) entry.status = "Resolved";
    saveJSON(STORE.consolLog, log);
    renderConsolLog();
    updateExceptionBadge();
    toast("Resolved");
  } catch (e) {
    setStatus("consol-status", "Couldn't reach the sheet — try again.", true);
  }
}

function exportConsolCsv() {
  const header = ["date", "initials", "entryType", "eccMaterial", "description", "color", "status", "size", "actualCount", "referenceNumber", "timestamp"];
  downloadCsv(`consolidation-log-${todayISO()}.csv`, [header, ...loadJSON(STORE.consolLog, []).map((e) => header.map((k) => e[k]))]);
}

function renderConsol() {
  renderConsolHolding();
  renderConsolList();
  renderConsolLog();
}

registerView("consol", {
  init(root) {
    document.getElementById("consol-filter").addEventListener("input", renderConsolList);
    root.addEventListener("change", (e) => {
      if (e.target.classList.contains("stepper-input")) {
        const n = parseInt(e.target.value, 10);
        setConsolCount(e.target.dataset.ecc, isNaN(n) ? 0 : n);
      }
    });
    root.addEventListener("keydown", (e) => {
      if (e.target.classList.contains("stepper-input") && e.key === "Enter") e.target.blur();
    });
    onAction(root, {
      "consol-dec": (el) => setConsolCount(el.dataset.ecc, getConsolActualCount(el.dataset.ecc) - 1),
      "consol-inc": (el) => setConsolCount(el.dataset.ecc, getConsolActualCount(el.dataset.ecc) + 1),
      "consol-stage": (el) => stageConsolActioned(el.dataset.ecc),
      "consol-unstage": (el) => unstageConsol(el.dataset.ecc),
      "consol-update": commitConsolUpdate,
      "consol-scan-box": startBoxCloseScan,
      "consol-close-manual": closeBoxManually,
      "consol-resolve": (el) => resolveConsolEntry(el.dataset.id),
      "consol-export": exportConsolCsv,
    });
  },

  show() {
    renderConsol();
  },
});
