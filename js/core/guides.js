"use strict";

/* ---------- Step-by-step guide reader ----------
   On an iPhone, the installed app opens a guide PDF inside its own window,
   with no way back out but closing the app. So every guide link opens here
   instead: the same guide, laid out for the phone (docs/guides/guides.json,
   made by tools/guides/build.py from the same text as the PDFs), with a
   Back button. The PDF itself is still one tap away under Share PDF where
   the phone can share files. */

let guidesData = null;

async function loadGuides() {
  if (guidesData) return guidesData;
  const res = await fetch("docs/guides/guides.json", { cache: "no-cache" });
  if (!res.ok) throw new Error("HTTP " + res.status);
  guidesData = (await res.json()).guides || {};
  return guidesData;
}

// Guide text comes from this app's own guides.json and only uses <b> and
// entities. Anything else is escaped, so it can only ever be text.
function guideText(html) {
  return escapeHtml(html)
    .replace(/&lt;(\/?)b&gt;/g, "<$1b>")
    .replace(/&amp;(amp|lt|gt|quot|#39);/g, "&$1;");
}

function renderGuide(file, g) {
  const steps = g.steps
    .map(
      (s, i) => `
      <section class="guide-step">
        <h3><span class="guide-n">${i + 1}</span>${guideText(s.title)}</h3>
        ${s.body.map((b) => `<p>${guideText(b)}</p>`).join("")}
        ${s.tip ? `<p class="guide-tip"><b>Tip:</b> ${guideText(s.tip)}</p>` : ""}
        ${s.image ? `<img class="guide-img${s.wide ? " wide" : ""}" src="docs/guides/${escapeHtml(s.image)}" alt="" loading="lazy">` : ""}
      </section>`
    )
    .join("");
  const extras = (g.extras || [])
    .map((x) => {
      if (x.kind === "h") return `<h3 class="guide-section">${guideText(x.text)}</h3>`;
      if (x.kind === "p") return `<p>${guideText(x.text)}</p>`;
      // tables read as one card per row on a phone
      return x.rows
        .map(
          (r) => `
          <div class="guide-row">
            <p class="guide-row-head">${guideText(r[0])}</p>
            ${r.slice(1).map((c, j) => `<p><span class="guide-label">${guideText(x.header[j + 1])}:</span> ${guideText(c)}</p>`).join("")}
          </div>`
        )
        .join("");
    })
    .join("");
  return `
    <div class="guide-hero">
      <span class="kicker-sm">Step-by-step guide</span>
      <h2>${guideText(g.title)}</h2>
      <p>${guideText(g.subtitle)}</p>
    </div>
    <div class="guide-intro">
      <p class="guide-label">What this page is for</p>
      <p>${guideText(g.purpose)}</p>
      ${g.need ? `<p class="guide-label">Before you start</p><p>${guideText(g.need)}</p>` : ""}
    </div>
    ${steps}
    ${extras}`;
}

async function openGuide(file) {
  const modal = document.getElementById("guide-modal");
  const body = document.getElementById("guide-body");
  document.getElementById("guide-bar-title").textContent = "Guide";
  body.innerHTML = `<p class="hint guide-loading">Loading the guide…</p>`;
  modal.dataset.file = file;
  modal.hidden = false;
  document.body.classList.add("guide-open");
  // The phone's own back gesture or button closes the guide too
  history.pushState({ guide: file }, "", location.href);
  try {
    const g = (await loadGuides())[file];
    if (!g) throw new Error("not found");
    document.getElementById("guide-bar-title").textContent = g.title;
    body.innerHTML = renderGuide(file, g);
    body.scrollTop = 0;
  } catch (e) {
    body.innerHTML = `<p class="hint guide-loading">Couldn't load this guide${navigator.onLine ? "" : " while offline"}. Tap Back and try again.</p>`;
  }
}

function hideGuide() {
  document.getElementById("guide-modal").hidden = true;
  document.body.classList.remove("guide-open");
}

function closeGuide() {
  if (history.state && history.state.guide) history.back(); // popstate hides it
  else hideGuide();
}

async function shareGuidePdf(btn) {
  const file = document.getElementById("guide-modal").dataset.file;
  await withBusy(btn, async () => {
    try {
      const blob = await (await fetch(`docs/guides/${file}`)).blob();
      await navigator.share({ files: [new File([blob], file, { type: "application/pdf" })] });
    } catch (e) {
      // cancelled, or the phone can't share files: nothing to do
    }
  });
}

function canSharePdf() {
  try {
    return !!navigator.canShare && navigator.canShare({ files: [new File([""], "guide.pdf", { type: "application/pdf" })] });
  } catch (e) {
    return false;
  }
}

function initGuides() {
  document.addEventListener("click", (e) => {
    const link = e.target.closest('a[href^="docs/guides/"][href$=".pdf"]');
    if (!link) return;
    e.preventDefault();
    if (link.closest("#settings-modal")) closeModal("settings-modal");
    openGuide(link.getAttribute("href").replace("docs/guides/", ""));
  });
  document.getElementById("guide-back").addEventListener("click", closeGuide);
  const share = document.getElementById("guide-share");
  share.hidden = !canSharePdf();
  share.addEventListener("click", () => shareGuidePdf(share));
  window.addEventListener("popstate", () => {
    if (!document.getElementById("guide-modal").hidden) hideGuide();
  });
}
