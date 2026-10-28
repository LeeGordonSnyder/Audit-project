"use strict";

/* ---------- Receiving ----------
   Two steps per box — Physically Received, then Received into MAO — with
   continuous box scanning into a Holding list. New in the rebuild: the
   "Waiting on MAO" queue. A box that's on the shelf but not received into
   MAO is exactly the same silent-gap risk as closing a consolidation box,
   so it stays visible here (and on Home) until the sheet shows step two. */

function loadReceivingHolding() {
  return loadJSON(STORE.receivingHolding, []);
}

function saveReceivingHolding(h) {
  saveJSON(STORE.receivingHolding, h);
}

function isBoxHeld(barcode) {
  return loadReceivingHolding().some((b) => b.barcode === barcode);
}

function holdBox(barcode) {
  const item = loadJSON(STORE.receivingMaster, []).find((p) => p.barcode === barcode);
  if (!item) return { ok: false, reason: "not-expected", message: `${barcode} — not in the expected shipment list.` };
  if (item.receivedIntoMaoDate) return { ok: false, reason: "already-mao", message: `${barcode} — already received into MAO.` };
  const holding = loadReceivingHolding();
  if (holding.some((b) => b.barcode === barcode)) return { ok: false, reason: "already-held", message: `${barcode} — already held.` };
  holding.push({ barcode: item.barcode, po: item.po });
  saveReceivingHolding(holding);
  return { ok: true, message: `Held ${barcode} (PO ${item.po}).`, heldCount: holding.length };
}

function startReceivingScan() {
  openScanner("Scanning boxes…", handleReceivingScan, { continuous: true });
}

async function handleReceivingScan(text) {
  const barcode = text.trim();
  const result = holdBox(barcode);
  if (result.ok) {
    renderReceiving();
    setStatus("scanner-modal-feedback", `${result.message} ${plural(result.heldCount, "box", "boxes")} held.`, false);
    return;
  }
  if (result.reason === "not-expected") {
    // Wait for the camera to fully stop before the next modal opens.
    await closeScanner();
    openAddBoxModal(barcode);
    return;
  }
  setStatus("scanner-modal-feedback", result.message, true);
}

function openAddBoxModal(barcode) {
  document.getElementById("recv-add-barcode").value = barcode;
  document.getElementById("recv-add-po").value = "";
  setStatus("recv-add-status", "", false);
  openModal("recv-add-modal");
  document.getElementById("recv-add-po").focus();
}

async function saveAddBox() {
  const barcode = document.getElementById("recv-add-barcode").value;
  const po = document.getElementById("recv-add-po").value.trim();
  if (!po) {
    setStatus("recv-add-status", "Enter the PO # first.", true);
    return;
  }
  const item = { barcode, po, expectedDate: "" };
  upsertReceivingMaster([item]);
  holdBox(barcode);
  closeModal("recv-add-modal");
  renderReceiving();
  setStatus("recv-status", `Added ${barcode} (PO ${po}) and held it — sharing with the sheet…`, false);
  try {
    await api.receivingImport(item);
    setStatus("recv-status", `Added ${barcode} (PO ${po}) and shared it with the sheet.`, false);
  } catch (e) {
    setStatus("recv-status", `Added ${barcode} on this device, but couldn't share it yet — check your connection.`, true);
  }
}

async function markHeld(status, btn) {
  const holding = loadReceivingHolding();
  if (!holding.length || !requireOnline("recv-status", "marked")) return;
  const date = todayISO();
  const initials = currentInitials();
  const barcodes = holding.map((b) => b.barcode);
  const label = status === "mao" ? "Received into MAO" : "Physically Received";
  setStatus("recv-status", `Marking ${plural(barcodes.length, "box", "boxes")} ${label}…`, false);

  await withBusy(btn, async () => {
    try {
      await api.receivingStatus({ status, date, initials, barcodes });
      const master = loadJSON(STORE.receivingMaster, []);
      for (const barcode of barcodes) {
        const box = master.find((p) => p.barcode === barcode);
        if (!box) continue;
        if (status === "mao") {
          box.receivedIntoMaoDate = date;
          box.receivedIntoMaoBy = initials;
        } else {
          box.physicallyReceivedDate = date;
          box.physicallyReceivedBy = initials;
        }
      }
      saveJSON(STORE.receivingMaster, master);
      saveReceivingHolding([]);
      renderReceiving();
      updateExceptionBadge();
      setStatus(
        "recv-status",
        `Marked ${plural(barcodes.length, "box", "boxes")} ${label}.` +
          (status === "physical" ? " They'll show under Waiting on MAO until received into MAO." : ""),
        false
      );
    } catch (e) {
      setStatus("recv-status", "Couldn't reach the sheet — boxes stay held. Try again.", true);
    }
  });
}

function holdAllAwaiting() {
  let n = 0;
  for (const box of receivingAwaitingMao()) if (holdBox(box.barcode).ok) n++;
  renderReceiving();
  setStatus("recv-status", n ? `Held ${plural(n, "box", "boxes")} — confirm they're in MAO, then tap Received into MAO.` : "Nothing new to hold.", false);
  document.getElementById("recv-holding-section").scrollIntoView({ block: "start", behavior: "smooth" });
}

function holdSelected() {
  const checked = [...document.querySelectorAll(".recv-select:checked")];
  let n = 0;
  checked.forEach((cb) => {
    if (holdBox(cb.dataset.barcode).ok) n++;
  });
  renderReceiving();
  setStatus("recv-status", `Held ${plural(n, "box", "boxes")}.`, false);
}

function renderAwaiting() {
  const awaiting = receivingAwaitingMao();
  const section = document.getElementById("recv-awaiting-section");
  section.hidden = awaiting.length === 0;
  if (!awaiting.length) return;
  document.getElementById("recv-awaiting-count").textContent = `${awaiting.length}`;
  document.getElementById("recv-awaiting").innerHTML = awaiting
    .slice(0, 30)
    .map(
      (b) => `
      <div class="list-row static${(b.age ?? 0) >= RECEIVING_MAO_GRACE_DAYS ? " overdue" : ""}">
        <span><span class="mono">${escapeHtml(b.barcode)}</span><br><span class="hint">PO ${escapeHtml(b.po)} · on shelf since ${escapeHtml(
        formatDay(b.physicallyReceivedDate)
      )} (${escapeHtml(b.physicallyReceivedBy || "—")})</span></span>
        <span class="list-row-end age">${escapeHtml(formatAge(b.age))}</span>
      </div>`
    )
    .join("");
}

function renderHolding() {
  const holding = loadReceivingHolding();
  document.getElementById("recv-holding-count").textContent = holding.length ? plural(holding.length, "box", "boxes") + " held" : "";
  document.getElementById("recv-mark-physical-btn").disabled = !holding.length;
  document.getElementById("recv-mark-mao-btn").disabled = !holding.length;
  document.getElementById("recv-holding").innerHTML = holding.length
    ? holding
        .map(
          (b) => `
        <div class="list-row static">
          <span><span class="mono">${escapeHtml(b.barcode)}</span><br><span class="hint">PO ${escapeHtml(b.po)}</span></span>
          <button type="button" class="btn secondary small" data-action="recv-unhold" data-barcode="${escapeHtml(b.barcode)}">Remove</button>
        </div>`
        )
        .join("")
    : `<p class="hint">Scan boxes (or tick them below) to hold them here.</p>`;
}

function renderExpected() {
  const master = loadJSON(STORE.receivingMaster, []);
  const filter = normalize(document.getElementById("recv-filter").value);
  const maoCount = master.filter((b) => b.receivedIntoMaoDate).length;
  const remaining = master.filter((b) => !b.receivedIntoMaoDate && !isBoxHeld(b.barcode));
  const shown = remaining.filter((b) => !filter || normalize(b.po).includes(filter) || normalize(b.barcode).includes(filter));
  const held = master.length - remaining.length - maoCount;

  document.getElementById("recv-count").textContent =
    `${shown.length} of ${remaining.length} remaining` + (held ? ` · ${held} held` : "") + (maoCount ? ` · ${maoCount} in MAO` : "");

  const el = document.getElementById("recv-expected");
  if (!shown.length) {
    el.innerHTML = `<p class="no-results">${
      master.length === 0
        ? "No expected shipments — paste the MAO list under Import below."
        : remaining.length === 0
        ? "Every box is received into MAO."
        : "No boxes match that filter."
    }</p>`;
    return;
  }
  el.innerHTML = shown
    .slice()
    .sort((a, b) => a.po.localeCompare(b.po) || a.barcode.localeCompare(b.barcode))
    .map(
      (b) => `
      <label class="list-row check-row">
        <input type="checkbox" class="recv-select" data-barcode="${escapeHtml(b.barcode)}">
        <span class="grow"><span class="mono">${escapeHtml(b.barcode)}</span><br><span class="hint">PO ${escapeHtml(b.po)} · ETA ${escapeHtml(
        formatDay(b.expectedDate)
      )}</span></span>
        <span class="list-row-end">${
          b.physicallyReceivedDate
            ? `<span class="pill pill-warn">On shelf</span>`
            : `<span class="pill pill-muted">Expected</span>`
        }</span>
      </label>`
    )
    .join("");
}

async function importReceivingPaste(btn) {
  const textarea = document.getElementById("recv-paste");
  const status = document.getElementById("recv-import-status");
  const parsed = parseReceivingPaste(textarea.value);
  if (!parsed.length) {
    setStatus(status, "No boxes found — check it's pasted with the ETA / Package / PO # lines.", true);
    return;
  }
  const result = upsertReceivingMaster(parsed);
  textarea.value = "";
  renderReceiving();
  setStatus(status, `Added ${result.added}, updated ${result.updated}. Sharing with the sheet…`, false);
  let shared = false;
  await withBusy(btn, async () => {
    if (!navigator.onLine) return;
    try {
      await api.receivingImportBatch(parsed);
      shared = true;
    } catch (e) {
      // stays local; importing again finishes sharing
    }
  });
  setStatus(
    status,
    shared
      ? `Added ${result.added}, updated ${result.updated}, and shared all ${parsed.length} with the sheet.`
      : `Added ${result.added}, updated ${result.updated} on this device. Couldn't share with the sheet — import again once connected.`,
    !shared
  );
}

function exportReceivingCsv() {
  const header = ["barcode", "po", "expectedDate", "physicallyReceivedDate", "physicallyReceivedBy", "receivedIntoMaoDate", "receivedIntoMaoBy"];
  downloadCsv(`receiving-log-${todayISO()}.csv`, [header, ...loadJSON(STORE.receivingMaster, []).map((b) => header.map((k) => b[k]))]);
}

function renderReceiving() {
  renderAwaiting();
  renderHolding();
  renderExpected();
}

registerView("receiving", {
  init(root) {
    document.getElementById("recv-filter").addEventListener("input", renderExpected);
    document.getElementById("recv-add-save-btn").addEventListener("click", saveAddBox);
    onAction(root, {
      "recv-scan": startReceivingScan,
      "recv-unhold": (el) => {
        saveReceivingHolding(loadReceivingHolding().filter((b) => b.barcode !== el.dataset.barcode));
        renderReceiving();
      },
      "recv-mark-physical": (el) => markHeld("physical", el),
      "recv-mark-mao": (el) => markHeld("mao", el),
      "recv-hold-awaiting": holdAllAwaiting,
      "recv-hold-selected": holdSelected,
      "recv-import": importReceivingPaste,
      "recv-export": exportReceivingCsv,
    });
  },

  show() {
    renderReceiving();
  },
});
