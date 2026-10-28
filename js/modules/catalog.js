"use strict";

/* ---------- Product Catalog ----------
   Tag Lookup + Product Master + hard-tag placement in one place: one
   search, one per-product detail view (catalog facts, hard-tag location,
   recent counts), and the MAO bulk import underneath. */

let catalogSelectedSku = null;

function catalogEls() {
  return {
    search: document.getElementById("catalog-search"),
    results: document.getElementById("catalog-results"),
    detail: document.getElementById("catalog-detail"),
    empty: document.getElementById("catalog-empty"),
  };
}

function renderCatalogSearch() {
  const { search, results, empty } = catalogEls();
  const q = search.value.trim();
  empty.hidden = !!q || !!catalogSelectedSku;
  if (catalogSelectedSku) {
    results.hidden = true;
    return;
  }
  renderProductResults(results, q, {
    action: "open-product",
    actionLabel: "Details",
    emptyHint: "If it's new, import it from MAO below.",
  });
}

function openCatalogProduct(sku) {
  catalogSelectedSku = sku;
  renderCatalogSearch();
  renderCatalogDetail();
}

function closeCatalogProduct() {
  catalogSelectedSku = null;
  catalogEls().detail.hidden = true;
  renderCatalogSearch();
}

function renderCatalogDetail() {
  const { detail } = catalogEls();
  const item = catalogSelectedSku && findProductBySku(catalogSelectedSku);
  if (!item) {
    detail.hidden = true;
    return;
  }
  detail.hidden = false;

  const tagLoc = getTagLocation(item.style);
  const variants = item.style ? loadMaster().filter((p) => p.style === item.style).length : 1;
  const counts = loadJSON(STORE.auditLog, [])
    .filter((e) => e.sku === item.sku)
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
    .slice(0, 5);

  detail.innerHTML = `
    <button type="button" class="link-btn" data-action="close-product">‹ Back to results</button>
    <div class="card product-card">
      <div class="mono dim">${escapeHtml(item.sku)} · UPC ${escapeHtml(item.upc)}</div>
      <h2 class="product-title">${escapeHtml(item.description || item.sku)}</h2>
      <dl class="facts">
        <div><dt>Style</dt><dd class="mono">${escapeHtml(item.style || "—")}</dd></div>
        <div><dt>Color</dt><dd>${escapeHtml(item.color || "—")}</dd></div>
        <div><dt>Size</dt><dd>${escapeHtml(item.size || "—")}</dd></div>
        <div><dt>Dept</dt><dd>${escapeHtml(item.dept || "—")}</dd></div>
        <div><dt>Expected count</dt><dd>${item.expectedCount == null ? "Not set" : escapeHtml(item.expectedCount)}</dd></div>
      </dl>

      <div class="tag-box ${tagLoc ? "" : "empty"}">
        <div class="tag-box-label">🏷 Hard-tag placement</div>
        <div class="tag-box-value">${tagLoc ? escapeHtml(tagLoc) : "Not assigned yet"}</div>
        ${
          item.style
            ? `<div class="tag-assign-row">
                <select id="catalog-tag-select" aria-label="Hard-tag location">
                  <option value="">Not assigned</option>
                  ${TAG_LOCATIONS.map(
                    (loc) => `<option value="${escapeHtml(loc)}" ${loc === tagLoc ? "selected" : ""}>${escapeHtml(loc)}</option>`
                  ).join("")}
                </select>
                <button type="button" class="btn primary small" data-action="save-tag">Save</button>
              </div>
              <p class="hint">Applies to all ${plural(variants, "color/size variant")} of style ${escapeHtml(item.style)}.</p>`
            : `<p class="hint">No style on this product, so a tag location can't be set.</p>`
        }
        <p id="catalog-tag-status" class="status-msg" role="status"></p>
      </div>

      <h3 class="subhead">Recent counts</h3>
      ${
        counts.length
          ? `<ul class="mini-list">${counts
              .map(
                (e) => `<li>
                  <span>${escapeHtml(formatDay(e.date || e.timestamp))} · ${escapeHtml(e.initials || "—")}</span>
                  <span>exp ${escapeHtml(e.expected)} · got ${escapeHtml(e.counted)}
                    <span class="pill ${isFlaggedVariance(e) ? "pill-danger" : e.variance ? "pill-warn" : "pill-ok"}">${
                      e.variance > 0 ? "+" : ""
                    }${escapeHtml(e.variance)}</span></span>
                </li>`
              )
              .join("")}</ul>`
          : `<p class="hint">Never counted.</p>`
      }
      <button type="button" class="btn secondary" data-action="count-product">Count this product</button>
    </div>`;
}

async function saveCatalogTag(btn) {
  const item = findProductBySku(catalogSelectedSku);
  if (!item || !item.style) return;
  const location = document.getElementById("catalog-tag-select").value;
  const status = document.getElementById("catalog-tag-status");
  if (!requireOnline(status)) return;

  setStatus(status, "Saving…", false);
  await withBusy(btn, async () => {
    try {
      await api.tagAssign({ style: item.style, location });
      setLocalTagLocation(item.style, location);
      renderCatalogDetail();
      renderCatalogTagList();
      toast(location ? `Tag set: ${location}` : "Tag location cleared");
    } catch (e) {
      setStatus(status, "Couldn't reach the sheet — check your connection and try again.", true);
    }
  });
}

function renderCatalogTagList() {
  const listEl = document.getElementById("catalog-tag-list");
  const map = new Map();
  for (const item of loadMaster()) {
    if (item.style && item.hardTagLocation && !map.has(item.style)) map.set(item.style, item);
  }
  document.getElementById("catalog-tag-count").textContent = map.size ? `(${map.size})` : "";
  if (!map.size) {
    listEl.innerHTML = `<p class="hint">No tag locations assigned yet.</p>`;
    return;
  }
  listEl.innerHTML = [...map.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(
      ([style, item]) => `
      <button type="button" class="list-row" data-action="open-product" data-sku="${escapeHtml(item.sku)}">
        <span><span class="mono">${escapeHtml(style)}</span><br><span class="hint">${escapeHtml(item.description)}</span></span>
        <span class="list-row-end">${escapeHtml(item.hardTagLocation)} ›</span>
      </button>`
    )
    .join("");
}

async function importCatalogPaste(btn) {
  const textarea = document.getElementById("catalog-paste");
  const status = document.getElementById("catalog-import-status");
  const parsed = parseManhattanPaste(textarea.value);
  if (!parsed.length) {
    setStatus(status, "No items found — check the paste still has the SKU/Style/Color/Size/UPC lines.", true);
    return;
  }
  const result = upsertProductMaster(parsed);
  textarea.value = "";
  renderCatalogSummary();
  setStatus(status, `Added ${result.added}, updated ${result.updated}. Sharing with the catalog sheet…`, false);

  let shared = 0;
  await withBusy(btn, async () => {
    if (!navigator.onLine) return;
    // Product pushes are per-item on the backend; keep going past a
    // failure so one bad row doesn't strand the rest.
    for (const item of parsed) {
      try {
        await api.pushProduct(item);
        shared++;
        setStatus(status, `Sharing with the catalog sheet… ${shared}/${parsed.length}`, false);
      } catch (e) {
        // stays local-only; importing again finishes sharing
      }
    }
  });

  setStatus(
    status,
    shared === parsed.length
      ? `Added ${result.added}, updated ${result.updated}, and shared all ${shared} with the sheet.`
      : `Added ${result.added}, updated ${result.updated} on this device. Only ${shared} of ${parsed.length} reached the sheet — import again to finish sharing.`,
    shared !== parsed.length
  );
}

function renderCatalogSummary() {
  const master = loadMaster();
  const styles = new Set(master.map((p) => p.style).filter(Boolean)).size;
  document.getElementById("catalog-summary").textContent = `${plural(master.length, "product")} · ${plural(styles, "style")}`;
}

function exportCatalogCsv() {
  const header = ["sku", "upc", "style", "dept", "description", "color", "size", "hardTagLocation", "expectedCount", "updatedAt"];
  downloadCsv(`product-catalog-${todayISO()}.csv`, [header, ...loadMaster().map((item) => header.map((k) => item[k]))]);
}

registerView("catalog", {
  init(root) {
    const { search } = catalogEls();
    search.addEventListener("input", () => {
      catalogSelectedSku = null;
      catalogEls().detail.hidden = true;
      renderCatalogSearch();
    });

    onAction(root, {
      "open-product": (el) => {
        openCatalogProduct(el.dataset.sku);
        root.scrollIntoView({ block: "start" });
      },
      "close-product": closeCatalogProduct,
      "save-tag": saveCatalogTag,
      "count-product": () => {
        const sku = catalogSelectedSku;
        goTo("counts", () => selectCountItem(sku));
      },
      "catalog-scan": () =>
        openScanner("Scan a product…", (text) => {
          search.value = text;
          const hit = findProductByUpc(text);
          if (hit) openCatalogProduct(hit.sku);
          else {
            catalogSelectedSku = null;
            renderCatalogSearch();
          }
        }),
      "catalog-clear": () => {
        search.value = "";
        closeCatalogProduct();
        search.focus();
      },
      "catalog-import": importCatalogPaste,
      "catalog-export": exportCatalogCsv,
    });
  },

  show() {
    renderCatalogSummary();
    renderCatalogSearch();
    renderCatalogDetail();
    renderCatalogTagList();
  },
});
