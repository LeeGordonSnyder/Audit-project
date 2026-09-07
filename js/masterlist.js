"use strict";

function initMasterList() {
  document.getElementById("import-btn").addEventListener("click", () => {
    const textarea = document.getElementById("paste-area");
    const parsed = parseManhattanPaste(textarea.value);
    if (!parsed.length) {
      setStatus("import-status", "No items found in that paste — check it still has the SKU/Style/Color/Size/UPC/Available lines.", true);
      return;
    }
    const result = upsertProductMaster(parsed);
    textarea.value = "";
    setStatus(
      "import-status",
      `Added ${result.added} new item(s), updated ${result.updated} existing item(s). Master list now has ${result.total} item(s) total.`,
      false
    );
    renderMasterTable();
  });

  document.getElementById("master-filter").addEventListener("input", renderMasterTable);

  document.getElementById("clear-master-btn").addEventListener("click", () => {
    if (confirm("Clear ALL product master data? This can't be undone.")) {
      saveJSON(STORAGE.master, []);
      renderMasterTable();
    }
  });

  document.getElementById("export-master-csv-btn").addEventListener("click", exportMasterCsv);

  renderMasterTable();
}

function renderMasterTable() {
  const master = loadJSON(STORAGE.master, []);
  const filterVal = normalize(document.getElementById("master-filter").value);
  const tbody = document.getElementById("master-table-body");
  const countEl = document.getElementById("master-count");

  const filtered = master.filter(
    (item) =>
      !filterVal ||
      normalize(item.sku).includes(filterVal) ||
      normalize(item.upc).includes(filterVal) ||
      normalize(item.style).includes(filterVal) ||
      normalize(combinedDescription(item)).includes(filterVal)
  );

  countEl.textContent = `${filtered.length} of ${master.length} item(s)`;
  tbody.innerHTML = "";

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" class="no-results">${
      master.length === 0 ? "No items yet — paste Manhattan data above." : "No items match that filter."
    }</td></tr>`;
    return;
  }

  const sorted = filtered.slice().sort((a, b) => combinedDescription(a).localeCompare(combinedDescription(b)));
  for (const item of sorted) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="mono">${escapeHtml(item.sku)}</td>
      <td class="mono">${escapeHtml(item.upc)}</td>
      <td>${escapeHtml(combinedDescription(item))}</td>
      <td class="num">${item.expectedCount == null ? "Not set" : item.expectedCount}</td>
      <td>${escapeHtml(new Date(item.updatedAt).toLocaleDateString())}</td>
    `;
    tbody.appendChild(tr);
  }
}

function exportMasterCsv() {
  const master = loadJSON(STORAGE.master, []);
  const header = ["sku", "upc", "style", "dept", "description", "color", "size", "expectedCount", "updatedAt"];
  const rows = [header, ...master.map((item) => header.map((k) => item[k]))];
  downloadCsv(`product-master-${todayISO()}.csv`, rows);
}
