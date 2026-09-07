"use strict";

function initAdjustments() {
  document.getElementById("export-adjustments-csv-btn").addEventListener("click", exportAdjustmentsCsv);
  renderAdjustments();
}

function renderAdjustments() {
  const adjustments = loadJSON(STORAGE.adjustments, []);
  renderAdjustmentSection("in", adjustments.filter((a) => a.type === "in"), document.getElementById("mark-in-list"));
  renderAdjustmentSection("out", adjustments.filter((a) => a.type === "out"), document.getElementById("mark-out-list"));
}

function renderAdjustmentSection(type, items, container) {
  container.innerHTML = "";
  if (items.length === 0) {
    container.innerHTML = `<p class="hint">Nothing here yet.</p>`;
    return;
  }

  const sorted = items.slice().sort((a, b) => Number(a.completed) - Number(b.completed));

  for (const item of sorted) {
    const card = document.createElement("div");
    card.className = "adjustment-card" + (item.completed ? " completed" : "");
    card.innerHTML = `
      <div class="adjustment-top">
        <span class="mono">${escapeHtml(item.upc)}</span>
        <span class="variance-pill ${type}">${type === "in" ? "+" : ""}${item.variance}</span>
      </div>
      <div class="meta">${escapeHtml(item.description)} (${escapeHtml(item.sku)})</div>
      <label class="inline-label">Supervisor Initials
        <input type="text" class="initials-input" value="${escapeHtml(item.supervisorInitials)}" ${item.completed ? "disabled" : ""}>
      </label>
      <label class="checkbox-row">
        <input type="checkbox" class="completed-checkbox" ${item.completed ? "checked" : ""}>
        Completed
        ${item.completed ? `<span class="meta">on ${escapeHtml(new Date(item.completedDate).toLocaleDateString())}</span>` : ""}
      </label>
    `;

    const initialsInput = card.querySelector(".initials-input");
    initialsInput.addEventListener("change", () => {
      updateAdjustment(item.id, { supervisorInitials: initialsInput.value.trim() });
    });

    const checkbox = card.querySelector(".completed-checkbox");
    checkbox.addEventListener("change", () => {
      if (checkbox.checked && !initialsInput.value.trim()) {
        alert("Enter supervisor initials before marking this complete.");
        checkbox.checked = false;
        return;
      }
      updateAdjustment(item.id, {
        completed: checkbox.checked,
        completedDate: checkbox.checked ? new Date().toISOString() : null,
        supervisorInitials: initialsInput.value.trim(),
      });
    });

    container.appendChild(card);
  }
}

function updateAdjustment(id, changes) {
  const adjustments = loadJSON(STORAGE.adjustments, []);
  const idx = adjustments.findIndex((a) => a.id === id);
  if (idx === -1) return;
  adjustments[idx] = { ...adjustments[idx], ...changes };
  saveJSON(STORAGE.adjustments, adjustments);
  renderAdjustments();
}

function exportAdjustmentsCsv() {
  const adjustments = loadJSON(STORAGE.adjustments, []);
  const header = ["type", "upc", "sku", "description", "variance", "supervisorInitials", "completed", "completedDate", "createdAt"];
  const rows = [header, ...adjustments.map((a) => header.map((k) => a[k]))];
  downloadCsv(`inventory-adjustments-${todayISO()}.csv`, rows);
}
