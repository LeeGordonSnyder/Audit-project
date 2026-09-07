"use strict";

const TAG_LOCATIONS = ["Hood", "Below Wash Tag", "Through Wash Tag", "Tag Side Pocket", "Left Leg In-seam", "Chest Pocket"];

let tagAssignStyle = null;

function initTagLookup() {
  const input = document.getElementById("tag-search-input");

  input.addEventListener("input", () => renderTagResults(input.value.trim()));

  document.getElementById("tag-clear-btn").addEventListener("click", () => {
    input.value = "";
    input.focus();
    renderTagResults("");
  });

  document.getElementById("tag-scan-btn").addEventListener("click", () => {
    openScanner("Scanning for tag lookup…", (text) => {
      input.value = text;
      renderTagResults(text);
    });
  });

  const select = document.getElementById("tag-assign-select");
  select.innerHTML =
    `<option value="">Not assigned</option>` +
    TAG_LOCATIONS.map((loc) => `<option value="${escapeHtml(loc)}">${escapeHtml(loc)}</option>`).join("");

  document.getElementById("tag-assign-save-btn").addEventListener("click", saveTagAssignModal);
  document.getElementById("tag-assign-cancel-btn").addEventListener("click", closeTagAssignModal);

  renderTagResults("");
  renderTagAssignmentsList();
}

function findMasterMatches(query) {
  const q = normalize(query);
  if (!q) return [];
  const master = loadJSON(STORAGE.master, []);
  return master.filter(
    (item) =>
      normalize(item.sku).includes(q) ||
      normalize(item.upc).includes(q) ||
      normalize(item.style).includes(q) ||
      normalize(combinedDescription(item)).includes(q)
  );
}

function renderTagResults(query) {
  const resultsEl = document.getElementById("tag-results");
  const emptyEl = document.getElementById("tag-empty-state");

  if (!query) {
    emptyEl.hidden = false;
    resultsEl.hidden = true;
    resultsEl.innerHTML = "";
    return;
  }
  emptyEl.hidden = true;
  resultsEl.hidden = false;

  const matches = findMasterMatches(query);
  if (matches.length === 0) {
    resultsEl.innerHTML = `<div class="no-results">No matches for "${escapeHtml(
      query
    )}". Import it on the Product Master tab first if it's new.</div>`;
    return;
  }

  resultsEl.innerHTML = "";
  for (const item of matches) {
    const tagLoc = getTagLocation(item.style);
    const card = document.createElement("div");
    card.className = "result-card";
    card.innerHTML = `
      <div class="sku">${escapeHtml(item.sku)} · UPC ${escapeHtml(item.upc)}</div>
      <h3>${escapeHtml(combinedDescription(item))}</h3>
      <div class="result-field">
        <div class="label">Style</div>
        <div class="value">${escapeHtml(item.style)}</div>
      </div>
      <div class="result-field">
        <div class="label">Expected Count</div>
        <div class="value">${item.expectedCount == null ? "Not set" : item.expectedCount}</div>
      </div>
      <div class="tag-box ${tagLoc ? "" : "empty"}">
        <div class="label">🏷 Tag Placement</div>
        <div class="value">${tagLoc ? escapeHtml(tagLoc) : "Not assigned yet"}</div>
      </div>
      <button class="btn secondary small assign-tag-btn" data-style="${escapeHtml(item.style)}">Set / Edit Tag Location</button>
    `;
    resultsEl.appendChild(card);
  }

  resultsEl.querySelectorAll(".assign-tag-btn").forEach((btn) => {
    btn.addEventListener("click", () => openTagAssignModal(btn.dataset.style));
  });
}

function openTagAssignModal(style) {
  tagAssignStyle = style;
  document.getElementById("tag-assign-style-label").textContent =
    `Style ${style} — applies to every size and color of this style.`;
  document.getElementById("tag-assign-select").value = getTagLocation(style);
  document.getElementById("tag-assign-modal").hidden = false;
}

function closeTagAssignModal() {
  tagAssignStyle = null;
  document.getElementById("tag-assign-modal").hidden = true;
}

function saveTagAssignModal() {
  if (!tagAssignStyle) return;
  setTagLocation(tagAssignStyle, document.getElementById("tag-assign-select").value);
  closeTagAssignModal();
  renderTagResults(document.getElementById("tag-search-input").value.trim());
  renderTagAssignmentsList();
}

function renderTagAssignmentsList() {
  const listEl = document.getElementById("tag-assignments-list");
  const map = loadJSON(STORAGE.tagMap, {});
  const styles = Object.keys(map).filter((s) => map[s]);

  listEl.innerHTML = "";
  if (styles.length === 0) {
    listEl.innerHTML = `<p class="hint">No tag locations assigned yet.</p>`;
    return;
  }

  for (const style of styles.sort()) {
    const row = document.createElement("div");
    row.className = "tag-assignment-row";
    row.innerHTML = `
      <span class="mono">${escapeHtml(style)}</span>
      <span>${escapeHtml(map[style])}</span>
      <button class="btn secondary small edit-tag-btn" data-style="${escapeHtml(style)}">Edit</button>
    `;
    listEl.appendChild(row);
  }

  listEl.querySelectorAll(".edit-tag-btn").forEach((btn) => {
    btn.addEventListener("click", () => openTagAssignModal(btn.dataset.style));
  });
}
