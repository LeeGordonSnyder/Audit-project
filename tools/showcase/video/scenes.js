"use strict";

/* Oakridge Product Suite: staff-meeting showcase, first cut (no narration).

   Every frame is a pure function of time: renderAt(t) lays out the whole
   stage for second t, so render.js can draw any frame in any order.
   Scenes are laid end to end on one timeline; each owns its elements and
   an update(localTime) that positions them. */

const W = 1920, H = 1080;
const PW = 433, PH = 892, SX = 20, SY = 74; // iPhone drawing: size, and where the app's screenshot starts inside it
const RECTS = window.RECTS || {};
const SHOT = (name) => `../screens/${name}.png`;
const SHEET = "../frames/sheets/deployment-full.png";

const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const prog = (t, a, b) => clamp((t - a) / (b - a));
const lerp = (a, b, p) => a + (b - a) * p;
const ease = {
  io: (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2),
  out: (x) => 1 - Math.pow(1 - x, 3),
  in: (x) => x * x * x,
  soft: (x) => 0.5 - Math.cos(Math.PI * x) / 2,
};
const fade = (lt, dur, a = 0.6, b = 0.6) => Math.min(ease.soft(prog(lt, 0, a)), ease.soft(1 - prog(lt, dur - b, dur)));

const stage = document.getElementById("stage");
function el(tag, cls, html, parent) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  if (parent) parent.appendChild(e);
  return e;
}
function style(e, s) { Object.assign(e.style, s); return e; }

/* ---------- building blocks ---------- */

// An iPhone with two stacked screenshots, so screens can crossfade.
function phone(parent) {
  const root = el("div", "iphone", `<div class="screen"><div class="island"></div><div class="status"><span>9:41</span><span class="bat"><i></i></span></div><div class="shots"><img><img></div><div class="off"></div><div class="home-bar"></div></div>`, parent);
  const [a, b] = root.querySelectorAll(".shots img");
  const off = root.querySelector(".off");
  return {
    root, off,
    show(from, to, mix) {
      if (a.dataset.src !== from) { a.src = SHOT(from); a.dataset.src = from; }
      if (b.dataset.src !== to) { b.src = SHOT(to); b.dataset.src = to; }
      b.style.opacity = mix;
    },
    dark(v) { off.style.opacity = v; },
  };
}

// Lines of text that rise in one after another and fade out together.
function text(parent, { x, y, w = 900, align = "left", lines }) {
  const box = style(el("div", "abs", "", parent), { left: x + "px", top: y + "px", width: w + "px", textAlign: align });
  if (align === "center") box.style.transform = "translateX(-50%)";
  const els = lines.map(([cls, html, extra]) => style(el("div", "line " + cls, html, box), extra || {}));
  return {
    box,
    at(lt, tIn, tOut, stagger = 0.18) {
      els.forEach((e, i) => {
        const p = ease.out(prog(lt, tIn + i * stagger, tIn + i * stagger + 0.8));
        const q = 1 - ease.soft(prog(lt, tOut, tOut + 0.5));
        e.style.opacity = p * q;
        e.style.transform = `translateY(${(1 - p) * 26}px)`;
      });
    },
  };
}

const SCENES = [];
let T = 0;
function scene(dur, build, overlap = 0) {
  const root = el("div", "scene", "", stage);
  const s = { start: T - overlap, dur, root };
  s.update = build(root, dur);
  SCENES.push(s);
  T = s.start + dur;
}

/* ---------- grey line drawings for the old ways (design box 1200 × 640) ---------- */

const G = { ink: "#636366", mid: "#8e8e93", light: "#c7c7cc", faint: "#d1d1d6" };
const ART = {
  wall: () => `
    <g id="sheets">${[0, 1, 2].map((i) => `
      <g transform="translate(${170 + i * 200} ${40 + (i % 2) * 14}) rotate(${[-3, 2, -1][i]})">
        <rect width="160" height="210" rx="3" fill="#fff" stroke="${G.mid}" stroke-width="2"/>
        <rect x="55" y="-10" width="50" height="20" fill="${G.faint}" opacity=".9"/>
        <line x1="18" y1="28" x2="110" y2="28" stroke="${G.mid}" stroke-width="5" stroke-linecap="round"/>
        ${[60, 85, 110, 135, 160, 185].map((yy) => `<line x1="18" y1="${yy}" x2="${100 + (yy % 40)}" y2="${yy}" stroke="${G.light}" stroke-width="5" stroke-linecap="round"/>`).join("")}
      </g>`).join("")}
    </g>
    <g id="jacket" transform="translate(800 70)" fill="none" stroke="${G.ink}" stroke-width="3" stroke-linejoin="round">
      <path d="M110 60 Q160 -10 210 60"/>
      <path d="M100 60 L50 90 L18 300 L50 306 L72 170 L74 380 L246 380 L248 170 L270 306 L302 300 L270 90 L220 60 Z"/>
      <line x1="160" y1="62" x2="160" y2="380"/>
      <rect x="98" y="250" width="40" height="44" rx="4"/><rect x="182" y="250" width="40" height="44" rx="4"/>
    </g>
    <g id="tagA" transform="translate(1012 210)"><path d="M0 0 h30 l12 14 l-12 14 h-30 z" fill="#fff" stroke="${G.ink}" stroke-width="3"/><circle cx="8" cy="14" r="3.5" fill="${G.ink}"/></g>
    <g id="tagB" transform="translate(940 92)"><path d="M0 0 h30 l12 14 l-12 14 h-30 z" fill="#fff" stroke="${G.ink}" stroke-width="3"/><circle cx="8" cy="14" r="3.5" fill="${G.ink}"/></g>
    <g id="cross" transform="translate(1050 70)" stroke="${G.ink}" stroke-width="5" stroke-linecap="round"><line x1="0" y1="0" x2="34" y2="34"/><line x1="34" y1="0" x2="0" y2="34"/></g>
    <text id="q" x="1120" y="200" font-family="Inter Display" font-size="110" font-weight="700" fill="${G.mid}">?</text>`,
  clipboard: () => `
    <g id="board" transform="translate(420 20)">
      <rect width="360" height="500" rx="18" fill="#fff" stroke="${G.ink}" stroke-width="3"/>
      <rect x="120" y="-18" width="120" height="44" rx="10" fill="#fff" stroke="${G.ink}" stroke-width="3"/>
      <rect x="30" y="50" width="300" height="420" rx="3" fill="#fff" stroke="${G.mid}" stroke-width="2"/>
      ${[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => `<line x1="50" y1="${90 + i * 36}" x2="310" y2="${90 + i * 36}" stroke="${G.light}" stroke-width="2"/>
        <line x1="58" y1="${80 + i * 36}" x2="${150 + (i * 37) % 90}" y2="${80 + i * 36}" stroke="${G.faint}" stroke-width="6" stroke-linecap="round"/>`).join("")}
      <g id="marks" stroke="${G.ink}" stroke-width="3" fill="none" stroke-linecap="round">
        <path d="M250 80 q10 -14 22 0"/><path d="M262 116 l8 8 l18 -20"/><path d="M248 188 q20 -16 34 4 q-14 10 -30 -4"/><path d="M256 260 l30 0"/><path d="M262 330 l8 8 l18 -20"/>
      </g>
    </g>
    <text id="q" x="840" y="320" font-family="Inter Display" font-size="140" font-weight="700" fill="${G.mid}">?</text>`,
  consol: () => {
    const sheet = (marks) => `
      <rect width="300" height="400" rx="4" fill="#fff" stroke="${G.mid}" stroke-width="2"/>
      <line x1="22" y1="36" x2="190" y2="36" stroke="${G.mid}" stroke-width="5" stroke-linecap="round"/>
      ${[0, 1, 2, 3, 4, 5, 6, 7].map((i) => `<line x1="22" y1="${72 + i * 40}" x2="278" y2="${72 + i * 40}" stroke="${G.light}" stroke-width="2"/><line x1="30" y1="${90 + i * 40}" x2="${150 + (i * 29) % 70}" y2="${90 + i * 40}" stroke="${G.faint}" stroke-width="6" stroke-linecap="round"/>`).join("")}
      ${marks}`;
    return `
      <g id="s1" transform="translate(190 120) rotate(-9)">${sheet(`<g stroke="${G.ink}" stroke-width="3" fill="none" stroke-linecap="round"><path d="M220 84 l10 10 l20 -22"/><path d="M220 164 l10 10 l20 -22"/><path d="M214 124 l30 14 M214 138 l30 -14"/><path d="M220 284 l10 10 l20 -22"/></g>`)}</g>
      <g id="s2" transform="translate(470 80) rotate(3)">${sheet(`<g stroke="#3a3a3c" stroke-width="3" fill="none" stroke-dasharray="7 6"><ellipse cx="236" cy="130" rx="32" ry="15"/><ellipse cx="236" cy="250" rx="32" ry="15"/><path d="M22 205 C 90 198, 170 214, 282 202"/></g><text x="214" y="350" font-family="Inter" font-size="28" font-weight="700" fill="#48484a">2?</text>`)}</g>
      <g id="s3" transform="translate(760 130) rotate(11)">${sheet(`<g stroke="${G.mid}" stroke-width="4" fill="none" stroke-linecap="round"><path d="M220 90 h36"/><path d="M220 170 h36"/><path d="M220 210 h36"/><path d="M220 330 h36"/></g><text x="212" y="288" font-family="Inter" font-size="24" font-weight="600" font-style="italic" fill="${G.ink}">BOH</text>`)}</g>`;
  },
  receiving: () => {
    const icons = [
      `<rect x="-60" y="-80" width="120" height="160" rx="8" fill="#fff" stroke="currentColor" stroke-width="3"/>${[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((i) => `<rect x="${-44 + i * 8}" y="20" width="${i % 3 ? 3 : 5}" height="40" fill="currentColor"/>`).join("")}<line x1="-44" y1="-50" x2="30" y2="-50" stroke="currentColor" stroke-width="5" stroke-linecap="round"/><line x1="-44" y1="-28" x2="10" y2="-28" stroke="currentColor" stroke-width="4" stroke-linecap="round"/>`,
      `<rect x="-70" y="-46" width="140" height="96" rx="14" fill="#fff" stroke="currentColor" stroke-width="3"/><rect x="-26" y="-62" width="52" height="18" rx="5" fill="#fff" stroke="currentColor" stroke-width="3"/><circle r="30" fill="none" stroke="currentColor" stroke-width="3"/><circle r="14" fill="none" stroke="currentColor" stroke-width="3"/>`,
      `<rect x="-90" y="-26" width="180" height="52" rx="26" fill="#fff" stroke="currentColor" stroke-width="3"/><circle cx="-56" cy="-4" r="11" fill="none" stroke="currentColor" stroke-width="3"/><line x1="-48" y1="4" x2="-40" y2="12" stroke="currentColor" stroke-width="3" stroke-linecap="round"/><line x1="-26" y1="0" x2="56" y2="0" stroke="currentColor" stroke-width="5" stroke-linecap="round" opacity=".4"/>`,
      `<rect x="-40" y="-40" width="80" height="80" rx="12" fill="#fff" stroke="currentColor" stroke-width="3"/><path d="M-20 0 l14 14 l28 -30" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>`,
      `<circle r="46" fill="#fff" stroke="currentColor" stroke-width="3"/><text y="14" text-anchor="middle" font-family="Inter Display" font-size="38" font-weight="700" fill="currentColor">LS</text>`,
    ];
    const labels = ["Label", "Photo", "Search", "Tick", "Initial"];
    return icons.map((ic, i) => `
      <g class="ri" transform="translate(${180 + i * 210} 260)" style="color:${G.mid}">${ic}
        <text y="130" text-anchor="middle" font-family="Inter" font-size="24" font-weight="600" fill="${G.mid}">${labels[i]}</text></g>
      ${i < 4 ? `<path d="M${180 + i * 210 + 90} 260 h30 m-10 -9 l10 9 l-10 9" fill="none" stroke="${G.light}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>` : ""}`).join("") +
      `<g id="times" transform="translate(1110 120)"><circle r="54" fill="#fff" stroke="${G.ink}" stroke-width="3"/><text y="16" text-anchor="middle" font-family="Inter Display" font-size="44" font-weight="700" fill="${G.ink}">×2</text></g>`;
  },
  replen: () => `
    <g id="print" transform="translate(170 70) rotate(-4)">
      <rect width="300" height="420" rx="3" fill="#fff" stroke="${G.mid}" stroke-width="2"/>
      ${[0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => `<line x1="24" y1="${50 + i * 40}" x2="${170 + (i * 31) % 60}" y2="${50 + i * 40}" stroke="${G.faint}" stroke-width="6" stroke-linecap="round"/>`).join("")}
      <g stroke="${G.ink}" stroke-width="3" fill="none" stroke-linecap="round">${[0, 1, 3, 4, 6].map((i) => `<path d="M240 ${44 + i * 40} l8 8 l18 -20"/>`).join("")}</g>
    </g>
    <g id="wb" transform="translate(560 60)">
      <rect width="520" height="380" rx="10" fill="#fff" stroke="${G.ink}" stroke-width="3"/>
      <rect x="140" y="384" width="240" height="14" rx="4" fill="${G.faint}"/>
      <text x="36" y="76" font-family="Inter Display" font-size="56" font-weight="700" fill="${G.ink}">86</text>
      ${[0, 1, 2, 3].map((i) => `<path class="wl" d="M40 ${130 + i * 58} q60 -10 120 0 t120 0 t${100 + i * 20} 0" fill="none" stroke="${G.mid}" stroke-width="5" stroke-linecap="round"/>`).join("")}
      <ellipse id="wipe" cx="0" cy="210" rx="90" ry="70" fill="#fff" opacity=".95"/>
    </g>`,
  stopwatch: (r = 190) => `
    <g fill="none" stroke="${G.mid}" stroke-width="5"><circle r="${r}"/><rect x="-28" y="${-r - 60}" width="56" height="34" rx="8"/><line x1="0" y1="${-r - 26}" x2="0" y2="${-r}"/>
      <line x1="${r * 0.71}" y1="${-r * 0.84}" x2="${r * 0.84}" y2="${-r * 0.97}" stroke-linecap="round"/><circle r="${r - 22}" stroke="${G.faint}" stroke-width="2"/></g>`,
};
const art = (parent, key, { x, y, w, h }, svg) => {
  const s = el("div", "abs", `<svg viewBox="0 0 1200 640" width="${w}" height="${h}" overflow="visible">${svg || ART[key]()}</svg>`, parent);
  return style(s, { left: x + "px", top: y + "px" });
};
const q = (root, sel) => root.querySelector(sel);
const qa = (root, sel) => [...root.querySelectorAll(sel)];
const pop = (e, p, from = 0.6) => { e.style.opacity = p; e.style.transformBox = "fill-box"; e.style.transformOrigin = "center"; e.style.scale = lerp(from, 1, ease.out(p)); };

/* ============================ ACT 1 · the reveal ============================ */

// Little shapes that burst out from behind the phone as it wakes: tags,
// boxes, ticks, barcodes, rings, in the app's colours.
const BURST = (() => {
  const C = ["#9b4a63", "#f2b8c8", "#2FAE4E", "#1F6FC1", "#F4A93B", "#c7c7cc", "#9b4a63", "#8E7CC3"];
  const shapes = [
    (c) => `<path d="M4 4 h34 l14 16 l-14 16 h-34 z" fill="${c}"/><circle cx="14" cy="20" r="4" fill="#fff"/>`,
    (c) => `<rect x="4" y="12" width="40" height="32" rx="4" fill="${c}"/><path d="M4 12 l20 -10 l20 10" fill="none" stroke="${c}" stroke-width="4" stroke-linejoin="round"/>`,
    (c) => `<circle cx="24" cy="24" r="22" fill="${c}"/><path d="M13 24 l8 8 l15 -16" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>`,
    (c) => [0, 1, 2, 3, 4, 5, 6].map((i) => `<rect x="${4 + i * 6}" y="6" width="${i % 2 ? 2.5 : 4}" height="36" fill="${c}"/>`).join(""),
    (c) => `<circle cx="24" cy="24" r="18" fill="none" stroke="${c}" stroke-width="7"/>`,
    (c) => `<rect x="6" y="6" width="36" height="36" rx="10" fill="${c}"/>`,
    (c) => `<circle cx="24" cy="24" r="10" fill="${c}"/>`,
    (c) => `<path d="M24 4 l6 14 l15 1 l-11 10 l4 15 l-14 -8 l-14 8 l4 -15 l-11 -10 l15 -1 z" fill="${c}"/>`,
  ];
  const out = [];
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2 + (i % 3) * 0.17;
    out.push({ svg: shapes[i % shapes.length](C[(i * 3) % C.length]), a, d: 300 + ((i * 97) % 5) * 55, size: 0.9 + ((i * 53) % 4) * 0.25, spin: ((i % 2 ? 1 : -1) * (40 + (i * 29) % 80)) });
  }
  return out;
})();

scene(37, (root, dur) => {
  const glow = style(el("div", "abs", "", root), { inset: 0, background: "radial-gradient(ellipse at 50% 55%, #f5f5f7 0%, #fff 60%)" });
  const bits = BURST.map((b) => style(el("div", "abs", `<svg width="48" height="48" viewBox="0 0 48 48" overflow="visible">${b.svg}</svg>`, root), { width: "48px", height: "48px" }));
  const fns = [
    ["01", "Product Catalog", "04-catalog-detail"], ["02", "Counts", "08-counts-list"], ["03", "Consolidations", "09-consol-list"],
    ["04", "Receiving", "16-receiving-awaiting"], ["05", "Floor Stock", "17-floor-check"],
  ];
  const items = fns.map(([n, name]) => el("div", "abs", `<div class="kicker" style="letter-spacing:.1em">${n}</div><div class="h3 display" style="margin-top:4px">${name}</div>`, root));
  const ph = phone(root);
  ph.root.style.transformOrigin = "50% 50%";
  const t1 = text(root, { x: 960, y: 950, w: 1600, align: "center", lines: [["sub", "Product management has many facets.", { color: "var(--ink)", fontSize: "44px" }]] });
  const title = text(root, { x: 960, y: 760, w: 1600, align: "center", lines: [["h1 display", "Oakridge Product Suite"]] });
  const LIST_T0 = 10.2, EACH = 3.3;
  return (lt) => {
    root.style.opacity = fade(lt, dur, 0.01, 1.2);
    // 1 · float up from below, easing to a stop
    const rise = ease.out(prog(lt, 0.4, 2.6));
    let cx = 960, cy = lerp(1500, 540, rise), sc = 0.8, r = lerp(6, 0, rise);
    // 2 · a playful jolt as the screen wakes
    const j = prog(lt, 2.6, 3.5);
    const wob = j > 0 && j < 1 ? Math.sin(j * Math.PI * 3) * (1 - j) : 0;
    let sx = 1 + 0.07 * wob, sy = 1 - 0.06 * wob;
    r += 4 * wob;
    // 3 · drift right, swaying gently, while the functions come out from behind
    const move = ease.io(prog(lt, 8.4, 10));
    cx = lerp(cx, 1330, move); sc = lerp(sc, 0.86, move);
    if (lt > 8.4) r += 2.6 * Math.sin(((lt - 8.4) / 4.2) * Math.PI * 2) * move;
    // 4 · back to centre and upright for the title
    const home = ease.io(prog(lt, LIST_T0 + 5 * EACH + 0.4, LIST_T0 + 5 * EACH + 2.6));
    cx = lerp(cx, 960, home); cy = lerp(cy, 410, home); sc = lerp(sc, 0.62, home); r = lerp(r, 0, home);
    style(ph.root, { left: cx - PW / 2 + "px", top: cy - PH / 2 + "px", transform: `rotate(${r}deg) scale(${sc * sx}, ${sc * sy})`, zIndex: 5 });
    ph.dark(1 - ease.soft(prog(lt, 2.65, 2.95)));
    glow.style.opacity = 1 - home;

    // the screen follows the list
    let from = "01-home", to = "01-home", mix = 0;
    fns.forEach(([, , shot], i) => {
      const t = LIST_T0 + i * EACH;
      if (lt >= t) { from = i ? fns[i - 1][2] : "01-home"; to = shot; mix = ease.soft(prog(lt, t, t + 0.5)); }
    });
    if (lt >= LIST_T0 + 5 * EACH + 0.4) { from = fns[4][2]; to = "01-home"; mix = ease.soft(prog(lt, LIST_T0 + 5 * EACH + 0.4, LIST_T0 + 5 * EACH + 1)); }
    ph.show(from, to, mix);

    // the burst: out on the jolt, drifting, gone before the phone moves
    BURST.forEach((b, i) => {
      const p = ease.out(prog(lt, 2.7 + (i % 4) * 0.03, 3.8 + (i % 4) * 0.03));
      const drift = Math.max(0, lt - 3.8) * 10;
      const d = b.d * p + drift;
      const gone = 1 - ease.soft(prog(lt, 7.2, 8.4));
      style(bits[i], { left: 960 + Math.cos(b.a) * d * 1.25 - 24 + "px", top: 540 + Math.sin(b.a) * d - 24 + "px", opacity: Math.min(1, p * 2) * gone,
        transform: `rotate(${b.spin * p + drift}deg) scale(${lerp(0.2, b.size, p)})`, zIndex: 1 });
    });

    // the five functions slide out from behind the phone into a list
    items.forEach((it, i) => {
      const t = LIST_T0 + i * EACH;
      const p = ease.out(prog(lt, t, t + 1.1));
      const active = lt >= t && lt < t + EACH ? 1 : 0;
      const gone = 1 - ease.soft(prog(lt, LIST_T0 + 5 * EACH + 0.2, LIST_T0 + 5 * EACH + 1));
      style(it, { left: lerp(cx - 120, 230, p) + "px", top: 236 + i * 128 + "px", opacity: Math.min(1, p * 1.4) * gone, zIndex: 2, color: lt < t + EACH || i === 4 ? "var(--ink)" : "#c7c7cc" });
      it.style.transform = `scale(${1 + 0.04 * active * p})`;
    });

    t1.at(lt, 4, 8.2);
    title.at(lt, LIST_T0 + 5 * EACH + 2.2, dur - 1.4);
  };
});

/* ============================ ACT 2 · the old ways ============================ */

function oldWay(dur, { key, kicker, title, sub, animate }) {
  scene(dur, (root) => {
    const a = art(root, key, { x: 310, y: 150, w: 1300, h: 693 });
    const k = text(root, { x: 160, y: 96, lines: [["kicker grey", kicker]] });
    const tx = text(root, { x: 960, y: 812, w: 1700, align: "center", lines: [["h2 display", title, { color: "#3a3a3c" }], ["sub", sub, { marginTop: "12px" }]] });
    return (lt) => {
      root.style.opacity = fade(lt, dur);
      a.style.opacity = ease.soft(prog(lt, 0.2, 1.2));
      a.style.transform = `translateY(${(1 - ease.out(prog(lt, 0.2, 1.4))) * 30}px)`;
      animate(a, lt);
      k.at(lt, 0.4, dur - 0.7);
      tx.at(lt, 1.6, dur - 0.7, 0.35);
    };
  });
}
scene(3.6, (root, dur) => {
  const tx = text(root, { x: 960, y: 470, w: 1600, align: "center", lines: [["h2 display", "Here's how it used to work.", { color: "#3a3a3c" }]] });
  return (lt) => { root.style.opacity = fade(lt, dur, 0.5, 0.6); tx.at(lt, 0.2, dur - 0.8); };
});
oldWay(9.5, {
  key: "wall", kicker: "Tag look-up · the old way", title: "Rules on a wall.",
  sub: "Exceptions spread by word of mouth. A wrong guess meant retagging, or damaged product.",
  animate: (a, lt) => {
    qa(a, "#sheets > g").forEach((g, i) => pop(g, ease.out(prog(lt, 0.4 + i * 0.25, 1.2 + i * 0.25)), 0.9));
    pop(q(a, "#jacket"), ease.out(prog(lt, 1.2, 2)), 0.95);
    pop(q(a, "#tagA"), ease.out(prog(lt, 2.6, 3.1)));
    pop(q(a, "#tagB"), ease.out(prog(lt, 3.6, 4.1)));
    pop(q(a, "#q"), ease.out(prog(lt, 4.4, 4.9)));
    pop(q(a, "#cross"), ease.out(prog(lt, 5.6, 6.1)));
  },
});
oldWay(9, {
  key: "clipboard", kicker: "Inventory audits · the old way", title: "Counts on paper.",
  sub: "Or from memory. Lose the sheet, and nobody knows when it was last counted.",
  animate: (a, lt) => {
    qa(a, "#marks path").forEach((p, i) => (p.style.opacity = prog(lt, 1.6 + i * 0.4, 2 + i * 0.4)));
    const lost = ease.io(prog(lt, 5, 6.2));
    q(a, "#board").style.opacity = 1 - 0.75 * lost;
    q(a, "#board").style.transform = `translate(420px, ${20 + lost * 30}px) rotate(${lost * 8}deg)`;
    pop(q(a, "#q"), ease.out(prog(lt, 5.8, 6.4)));
  },
});
oldWay(9.5, {
  key: "consol", kicker: "Consolidations · the old way", title: "Three paper copies.",
  sub: "None of them update each other. Lose one, and you check it all over again.",
  animate: (a, lt) => ["#s1", "#s2", "#s3"].forEach((s, i) => (q(a, s).style.opacity = ease.out(prog(lt, 0.4 + i * 0.6, 1.2 + i * 0.6)))),
});
oldWay(9.5, {
  key: "receiving", kicker: "Receiving · the old way", title: "Every box, by hand. Twice.",
  sub: "Copy each barcode in. Then photograph, scan, search, tick and initial, and again for MAO.",
  animate: (a, lt) => {
    const ri = qa(a, ".ri");
    const step = Math.floor(Math.max(0, lt - 1.2) / 0.5) % 5;
    ri.forEach((g, i) => (g.style.color = lt > 1.2 && i === step ? "#1d1d1f" : G.mid));
    pop(q(a, "#times"), ease.out(prog(lt, 4.6, 5.2)));
  },
});
oldWay(9, {
  key: "replen", kicker: "Floor replen & the 86 board · the old way", title: "Printouts and a whiteboard.",
  sub: "The 86 board sits out of sight in the back, and things get wiped off it.",
  animate: (a, lt) => {
    const w = prog(lt, 4.6, 6.4);
    q(a, "#wipe").setAttribute("cx", lerp(-120, 640, ease.io(w)));
    q(a, "#wipe").style.opacity = w > 0 && w < 1 ? 0.95 : 0;
    qa(a, ".wl").forEach((l, i) => (l.style.opacity = i === 1 || i === 2 ? 1 - 0.85 * ease.soft(prog(lt, 5 + i * 0.25, 5.8 + i * 0.25)) : 1));
  },
});
scene(5.5, (root, dur) => {
  const keys = ["wall", "clipboard", "consol", "receiving", "replen"];
  const minis = keys.map((k) => art(root, k, { x: 0, y: 0, w: 520, h: 277 }));
  const tx = text(root, { x: 960, y: 640, w: 1500, align: "center", lines: [["h2 display", "It got done. The hard way.", { color: "#3a3a3c" }]] });
  return (lt) => {
    root.style.opacity = fade(lt, dur, 0.5, 0.8);
    const g = ease.io(prog(lt, 0.6, 2.2));
    minis.forEach((m, i) => {
      const k = i - 2;
      const x = lerp(960 + k * 360, 960 + k * 40, g) - 260, y = lerp(330, 360 + Math.abs(k) * 8, g) - 138;
      style(m, { left: x + "px", top: y + "px", opacity: lerp(1, 0.8, g), transform: `scale(${lerp(0.72, 0.9, g)}) rotate(${k * 6 * g}deg)` });
    });
    tx.at(lt, 2.2, dur - 0.8);
  };
});

/* ============================ ACT 3 · before / now ============================ */

// Stroke-drawing helper: paths with pathLength="1" draw on as p goes 0 → 1.
const drawOn = (path, p) => { path.style.strokeDasharray = "1 1"; path.style.strokeDashoffset = String(1 - p); };

// Left half: an animated grey drawing of the old way, in a 1200 × 640 box.
const BEFORE = {
  tags: {
    svg: () => ART.wall() + `
      <g id="mag" fill="none" stroke="${G.ink}" stroke-width="5" stroke-linecap="round"><circle r="46" fill="rgba(255,255,255,.35)"/><line x1="34" y1="34" x2="80" y2="80" stroke-width="9"/></g>
      <path id="trail" d="M954 106 C 1000 120, 1030 170, 1020 222" fill="none" stroke="${G.mid}" stroke-width="3" stroke-dasharray="6 8" pathLength="1"/>`,
    play(a, lt) {
      const m = q(a, "#mag"), sweep = ease.io(prog(lt, 0.6, 3.2));
      m.setAttribute("transform", `translate(${lerp(240, 680, sweep)} ${150 + Math.sin(sweep * Math.PI * 3) * 40})`);
      m.style.opacity = 1 - prog(lt, 3.2, 3.6);
      qa(a, "#sheets > g").forEach((g) => (g.style.opacity = 1));
      q(a, "#tagA").style.opacity = 0;
      const tg = q(a, "#tagB"), land = ease.out(prog(lt, 3.4, 4.1)), redo = ease.io(prog(lt, 5.2, 6.2));
      tg.setAttribute("transform", `translate(${lerp(lerp(600, 940, land), 1012, redo)} ${lerp(lerp(300, 92, land), 210, redo)})`);
      tg.style.opacity = land;
      pop(q(a, "#cross"), ease.out(prog(lt, 4.3, 4.8)));
      q(a, "#cross").style.opacity *= 1 - prog(lt, 5.2, 5.5);
      pop(q(a, "#q"), ease.out(prog(lt, 4.5, 5)));
      drawOn(q(a, "#trail"), ease.io(prog(lt, 5.2, 6.2)));
      q(a, "#trail").style.opacity = 1 - prog(lt, 7, 7.6);
    },
  },
  audit: {
    svg: () => ART.clipboard().replace(/<path d="/g, '<path pathLength="1" d="') + `
      <g id="pen" transform="translate(0 0)"><path d="M0 0 l18 -6 l60 -60 l-12 -12 l-60 60 z" fill="#fff" stroke="${G.ink}" stroke-width="3" stroke-linejoin="round"/><path d="M0 0 l6 -18" stroke="${G.ink}" stroke-width="3"/></g>`,
    play(a, lt) {
      const marks = qa(a, "#marks path");
      marks.forEach((p, i) => drawOn(p, ease.out(prog(lt, 0.8 + i * 0.75, 1.4 + i * 0.75))));
      const k = clamp(Math.floor((lt - 0.8) / 0.75), 0, marks.length - 1), local = prog(lt, 0.8 + k * 0.75, 1.4 + k * 0.75);
      const ys = [80, 116, 188, 260, 330];
      q(a, "#pen").setAttribute("transform", `translate(${420 + 250 + local * 30} ${20 + ys[k] + 4})`);
      q(a, "#pen").style.opacity = 1 - prog(lt, 4.6, 5);
      const lost = ease.io(prog(lt, 5.2, 6.4));
      q(a, "#board").style.transform = `translate(420px, ${20 + lost * 60}px) rotate(${lost * 10}deg)`;
      q(a, "#board").style.opacity = 1 - 0.8 * lost;
      pop(q(a, "#q"), ease.out(prog(lt, 6, 6.5)));
    },
  },
  consol: {
    svg: () => ART.consol().replace(/<path d="/g, '<path pathLength="1" d="').replace(/<ellipse /g, '<ellipse pathLength="1" ') +
      `<text id="q" x="560" y="80" font-family="Inter Display" font-size="110" font-weight="700" fill="${G.mid}">?</text>`,
    play(a, lt) {
      ["#s1", "#s2", "#s3"].forEach((s, i) => {
        const g = q(a, s);
        qa(g, "path, ellipse").forEach((p, k) => drawOn(p, ease.out(prog(lt, 0.8 + k * 0.9 + i * 0.3, 1.4 + k * 0.9 + i * 0.3))));
        const shake = lt > 5 ? Math.sin((lt - 5) * 9 + i) * 2 * (1 - prog(lt, 6.5, 7.5)) : 0;
        g.style.transformBox = "fill-box"; g.style.transformOrigin = "center"; g.style.rotate = shake + "deg";
      });
      pop(q(a, "#q"), ease.out(prog(lt, 5.2, 5.8)));
    },
  },
  board: {
    svg: () => ART.replen().replace(/<path class="wl" d="/g, '<path class="wl" pathLength="1" d="') +
      `<g id="mk" transform="translate(0 0)"><rect x="-8" y="-60" width="16" height="56" rx="4" fill="#fff" stroke="${G.ink}" stroke-width="3"/><path d="M-8 -4 l8 10 l8 -10" fill="${G.ink}"/></g>`,
    play(a, lt) {
      q(a, "#print").style.opacity = 0.35;
      const wl = qa(a, ".wl");
      wl.forEach((l, i) => drawOn(l, ease.io(prog(lt, 0.6 + i * 0.9, 1.4 + i * 0.9))));
      const k = clamp(Math.floor((lt - 0.6) / 0.9), 0, 3), local = prog(lt, 0.6 + k * 0.9, 1.4 + k * 0.9);
      q(a, "#mk").setAttribute("transform", `translate(${560 + 40 + local * (260 + k * 20)} ${60 + 130 + k * 58})`);
      q(a, "#mk").style.opacity = 1 - prog(lt, 4.2, 4.5);
      const w = prog(lt, 4.8, 6.4);
      q(a, "#wipe").setAttribute("cx", lerp(-120, 640, ease.io(w)));
      q(a, "#wipe").style.opacity = w > 0 && w < 1 ? 0.95 : 0;
      wl.forEach((l, i) => (l.style.opacity = i === 1 || i === 2 ? 1 - 0.9 * ease.soft(prog(lt, 5.2 + i * 0.25, 6 + i * 0.25)) : 1));
    },
  },
};

// Right half: the real screen on an iPhone, with taps, a scan beam, and the
// part being talked about lifted out as a magnified card.
function nowPhone(root, { screen, x = 1250, top = 214, s = 0.7 }) {
  const ph = phone(root);
  ph.show(screen, screen, 0); ph.dark(0);
  const left = x - (PW * s) / 2;
  const at = (sx, sy) => [left + (SX + sx) * s, top + (SY + sy) * s];
  return { ph, left, top, s, at };
}
function callout(root, screen, rect, k = 1.12) {
  const c = style(el("div", "abs", `<img src="${SHOT(screen)}" style="position:absolute;width:${393 * k}px;left:${-rect.x * k}px;top:${-rect.y * k}px">`, root),
    { width: rect.w * k + "px", height: rect.h * k + "px", overflow: "hidden", borderRadius: "18px", background: "#fff", transformOrigin: "0 0",
      boxShadow: "0 30px 60px rgba(0,0,0,.16), 0 6px 16px rgba(0,0,0,.08)" });
  return (p, from, to) => {
    const e = ease.out(p);
    style(c, { left: lerp(from[0], to[0], e) + "px", top: lerp(from[1], to[1], e) + "px", transform: `scale(${lerp(from[2] / k, 1, e)})`, opacity: Math.min(1, p * 3) });
  };
}
function ripple(root) {
  const r = style(el("div", "abs", "", root), { width: "70px", height: "70px", borderRadius: "50%", border: "4px solid var(--accent)", background: "rgba(155,74,99,.12)" });
  return (lt, t, x, y) => {
    const p = prog(lt, t, t + 0.7);
    style(r, { left: x - 35 + "px", top: y - 35 + "px", opacity: p > 0 && p < 1 ? 1 - p : 0, transform: `scale(${lerp(0.3, 1.5, ease.out(p))})` });
  };
}

function versus(dur, { before, beforeLine, now, line, build }) {
  scene(dur, (root) => {
    const left = style(el("div", "abs", "", root), { left: 0, top: 0, width: "960px", height: "1080px", background: "var(--paper)" });
    const a = before ? art(left, null, { x: 20, y: 236, w: 920, h: 491 }, BEFORE[before].svg()) : null;
    const cb = text(root, { x: 480, y: 84, w: 900, align: "center", lines: [["caption", "Before"], ["sub", beforeLine, { marginTop: "8px" }]] });
    const cn = text(root, { x: 1440, y: 84, w: 900, align: "center", lines: [["caption", "Now", { color: "var(--accent)" }], ["sub", now, { marginTop: "8px" }]] });
    const bottom = line ? text(root, { x: 960, y: 930, w: 1800, align: "center", lines: [["h3 display", line, { fontSize: "56px" }]] }) : null;
    const play = build(root, left);
    return (lt) => {
      root.style.opacity = fade(lt, dur);
      left.style.transform = `translateX(${(ease.out(prog(lt, 0, 0.9)) - 1) * 120}px)`;
      if (a) { a.style.opacity = ease.soft(prog(lt, 0.2, 0.9)); BEFORE[before].play(a, lt); }
      cb.at(lt, 0.3, dur - 0.7);
      cn.at(lt, 0.9, dur - 0.7);
      if (bottom) bottom.at(lt, dur - 3.2, dur - 0.7);
      play(lt);
    };
  });
}
const phoneIn = (n, lt) => { const p = ease.out(prog(lt, 0.6, 1.7)); style(n.ph.root, { left: n.left + "px", top: n.top + (1 - p) * 60 + "px", transform: `scale(${n.s})`, opacity: p }); };

versus(9, {
  before: "tags", beforeLine: "Rules on a wall. Guess, tag, retag.", now: "Scan it. The tag spot is right there.", line: "One answer, for everyone.",
  build: (root) => {
    const n = nowPhone(root, { screen: "04-catalog-detail" });
    const r = RECTS["04-catalog-detail"], call = callout(root, "04-catalog-detail", r), tap = ripple(root);
    return (lt) => {
      phoneIn(n, lt);
      const [x0, y0] = n.at(r.x, r.y);
      tap(lt, 2.4, ...n.at(r.x + r.w / 2, r.y + r.h / 2));
      call(prog(lt, 3, 4), [x0, y0, r.w * n.s], [1442, 470, r.w * 1.12]);
    };
  },
});
versus(9, {
  before: "audit", beforeLine: "Paper lists that get lost.", now: "Every count logged, with who and when.", line: "Every count, on record.",
  build: (root) => {
    const n = nowPhone(root, { screen: "08-counts-list" });
    const r = { x: 16, y: 343, w: 361, h: 82 }, call = callout(root, "08-counts-list", r, 1.08), tap = ripple(root);
    return (lt) => {
      phoneIn(n, lt);
      tap(lt, 2.2, ...n.at(196, 210));
      const [x0, y0] = n.at(r.x, r.y);
      call(prog(lt, 3, 4), [x0, y0, r.w * n.s], [1446, 520, r.w * 1.08]);
    };
  },
});
versus(9, {
  before: "consol", beforeLine: "Three copies that never match.", now: "One list everyone shares, live.", line: "One list. Always current.",
  build: (root) => {
    const r = RECTS["09-consol-list"] || { x: 16, y: 325, w: 361, h: 113 };
    const phones = [1120, 1440, 1760].map((x) => nowPhone(root, { screen: "09-consol-list", x, top: 250, s: 0.5 }));
    const rings = phones.map(() => style(el("div", "abs", "", root), { border: "4px solid var(--accent)", borderRadius: "12px" }));
    const tap = ripple(root);
    return (lt) => {
      phones.forEach((n, i) => {
        const p = ease.out(prog(lt, 0.6 + i * 0.15, 1.6 + i * 0.15));
        style(n.ph.root, { left: n.left + "px", top: n.top + (1 - p) * 60 + "px", transform: `scale(${n.s})`, opacity: p });
        const [x, y] = n.at(r.x - 4, r.y - 4);
        const on = i === 0 ? prog(lt, 2.6, 2.9) : prog(lt, 3.1 + i * 0.25, 3.4 + i * 0.25);
        style(rings[i], { left: x + "px", top: y + "px", width: (r.w + 8) * n.s + "px", height: (r.h + 8) * n.s + "px", opacity: on * (1 - prog(lt, 7.6, 8.2)) });
      });
      tap(lt, 2.4, ...phones[0].at(r.x + 150, r.y + 78));
    };
  },
});
versus(17, {
  before: null, beforeLine: "Copy, find, tick, initial. Box by box.", now: "Paste once. Scan the boxes.",
  build: (root, left) => {
    const sw = el("div", "abs", `<svg width="400" height="400" viewBox="-200 -200 400 400" overflow="visible">${ART.stopwatch(128)}</svg>`, left);
    style(sw, { left: "280px", top: "196px" });
    const lnum = style(el("div", "abs stopwatch-num", "0:00", left), { left: "280px", top: "336px", width: "400px", textAlign: "center", fontSize: "88px", color: "#636366" });
    const chain = el("div", "abs", `<svg viewBox="0 0 1200 640" width="760" height="405" overflow="visible">${ART.receiving()}</svg>`, left);
    style(chain, { left: "100px", top: "540px" });
    const lbox = style(el("div", "abs", "", left), { left: "280px", top: "540px", width: "400px", textAlign: "center", fontSize: "26px", fontWeight: 600, color: "#636366" });
    const n = nowPhone(root, { screen: "14-receiving-scan", x: 1200, s: 0.72 });
    const beam = style(el("div", "abs", "", root), { height: "4px", borderRadius: "2px", background: "#ff3b5c", boxShadow: "0 0 18px 4px rgba(255,59,92,.55)" });
    const rnum = style(el("div", "abs stopwatch-num", "0:00", root), { left: "1490px", top: "420px", width: "400px", textAlign: "center", fontSize: "140px", color: "var(--ink)" });
    const rbox = style(el("div", "abs", "", root), { left: "1490px", top: "600px", width: "400px", textAlign: "center", fontSize: "28px", fontWeight: 600, color: "var(--ink-2)" });
    const tx = text(root, { x: 960, y: 920, w: 1800, align: "center", lines: [["h2 display", `Same 5 boxes. <span style="color:var(--accent)">68% less time.</span>`, { fontSize: "64px" }], ["caption", "In testing", { marginTop: "14px" }]] });
    const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
    const T0 = 2, SPAN = 8; // 8 seconds of screen time stand for 3:25
    const at = (secs) => T0 + (SPAN * secs) / 205;
    return (lt) => {
      phoneIn(n, lt);
      chain.style.opacity = sw.style.opacity = ease.soft(prog(lt, 0.3, 1));
      const k = prog(lt, T0, T0 + SPAN) * 205;
      lnum.textContent = mmss(k);
      rnum.textContent = mmss(Math.min(k, 66));
      lbox.textContent = `Box ${Math.min(5, Math.floor(k / 41) + 1)} of 5`;
      rbox.textContent = `${Math.min(5, Math.floor(k / 13.2))} of 5 boxes scanned`;
      // the old way's steps cycle for every box
      const step = Math.floor(((k % 41) / 41) * 5);
      qa(chain, ".ri").forEach((g, i) => (g.style.color = lt > T0 && k < 205 && i === step ? "#1d1d1f" : G.mid));
      // the scan beam sweeps once per box on the phone, then stops
      const [bx, by0] = n.at(48, 250), [, by1] = n.at(48, 520);
      const sweeping = lt > T0 && k < 66;
      const ph = ((k % 13.2) / 13.2);
      style(beam, { left: bx + "px", top: lerp(by0, by1, ph) + "px", width: 300 * n.s + "px", opacity: sweeping ? 1 : 0 });
      const done = ease.out(prog(lt, at(66), at(66) + 0.6));
      rnum.style.color = done > 0 ? "var(--accent)" : "var(--ink)";
      rnum.style.transform = `scale(${1 + 0.08 * Math.sin(done * Math.PI)})`;
      rnum.style.opacity = rbox.style.opacity = lbox.style.opacity = ease.soft(prog(lt, 1.2, 2));
      tx.at(lt, T0 + SPAN + 0.6, 16.3, 0.5);
    };
  },
});
versus(9, {
  before: "board", beforeLine: "A whiteboard in the back.", now: "The 86 Board, on every phone.", line: "Nothing gets wiped off.",
  build: (root) => {
    const n = nowPhone(root, { screen: "20-floor-86" });
    const r = RECTS["20-floor-86"], call = callout(root, "20-floor-86", r, 1.12);
    return (lt) => {
      phoneIn(n, lt);
      const [x0, y0] = n.at(r.x, r.y);
      call(prog(lt, 2.8, 3.8), [x0, y0, r.w * n.s], [1442, 470, r.w * 1.12]);
    };
  },
});
scene(7, (root, dur) => {
  const tx = text(root, { x: 960, y: 330, w: 1800, align: "center", lines: [
    ["h2 display", `~41s per box &nbsp;→&nbsp; <span style="color:var(--accent)">~13s per box</span>`],
    ["sub", "On a 60-box shipment, that's about", { marginTop: "54px" }],
    ["h1 display", "28 minutes saved", { marginTop: "6px" }],
    ["sub", "per store, per shipment.", { marginTop: "14px" }],
  ] });
  return (lt) => { root.style.opacity = fade(lt, dur); tx.at(lt, 0.3, dur - 0.8, 0.45); };
});

/* ============================ ACT 4 · each function, up close ============================ */

function sectionCard(num, title) {
  scene(3.4, (root, dur) => {
    const tx = text(root, { x: 960, y: 420, w: 1600, align: "center", lines: [["kicker", num, { fontSize: "30px", letterSpacing: ".1em" }], ["h1 display", title, { marginTop: "12px" }]] });
    return (lt) => { root.style.opacity = fade(lt, dur, 0.4, 0.5); tx.at(lt, 0.1, dur - 0.7, 0.15); };
  });
}

// Camera on an iPhone at the left: each step shows a screen, either whole or
// zoomed onto its focus box (sharp) with the rest blurred, and a text panel
// on the right. The camera eases from one step's framing to the next.
const HOME_CENTER = { x: 640, y: 540 };
function framing(step) {
  if (!step.focus) return { z: 1, px: PW / 2, py: PH / 2, clip: [0, 0, 0, 0], blur: 0 };
  const r = RECTS[step.screen] || { x: 16, y: 200, w: 361, h: 200 };
  const pad = 12;
  const z = clamp(Math.min(860 / (r.w + 40), 720 / (r.h + 40)), 1.3, 2.5);
  const x0 = SX + r.x - pad, y0 = SY + r.y - pad, x1 = SX + r.x + r.w + pad, y1 = SY + Math.min(r.y + r.h, 852 - 54) + pad;
  return { z, px: (x0 + x1) / 2, py: (y0 + y1) / 2, clip: [(y0 / PH) * 100, (1 - x1 / PW) * 100, (1 - y1 / PH) * 100, (x0 / PW) * 100], blur: 7 };
}
function deepDive(steps) {
  const dur = steps.reduce((n, s) => n + s.dur, 0);
  scene(dur, (root) => {
    const rig = style(el("div", "abs", "", root), { left: 0, top: 0, transformOrigin: "0 0" });
    const soft = phone(rig), sharp = phone(rig);
    soft.dark(0); sharp.dark(0);
    sharp.root.style.boxShadow = "none";
    const texts = [];
    steps.forEach((s, i) => {
      const prev = texts[texts.length - 1];
      if (prev && prev.key === s.text) { prev.end += s.dur; return; }
      const t0 = steps.slice(0, i).reduce((n, x) => n + x.dur, 0);
      texts.push({ key: s.text, start: t0, end: t0 + s.dur, t: text(root, { x: 1180, y: 330, w: 640, lines: [["kicker", s.text[0]], ["h3 display", s.text[1], { marginTop: "18px" }], ["sub", s.text[2], { marginTop: "24px" }]] }) });
    });
    const starts = steps.map((_, i) => steps.slice(0, i).reduce((n, x) => n + x.dur, 0));
    return (lt) => {
      root.style.opacity = fade(lt, dur, 0.5, 0.6);
      let i = starts.findIndex((st, k) => lt >= st && lt < st + steps[k].dur);
      if (i < 0) i = steps.length - 1;
      const s = steps[i], prev = steps[Math.max(0, i - 1)];
      const l = lt - starts[i];
      const A = i === 0 ? { ...framing(s), z: 0.9 } : framing(prev), B = framing(s);
      const p = ease.io(prog(l, 0, i === 0 ? 1.4 : 1.3));
      const z = lerp(A.z, B.z, p), px = lerp(A.px, B.px, p), py = lerp(A.py, B.py, p), blur = lerp(A.blur, B.blur, p);
      const clip = A.clip.map((v, k) => lerp(v, B.clip[k], p));
      rig.style.transform = `translate(${HOME_CENTER.x - px * z}px, ${HOME_CENTER.y - py * z}px) scale(${z})`;
      const from = i === 0 ? s.screen : prev.screen, mix = from === s.screen ? 1 : ease.soft(prog(l, 0.05, 0.35));
      soft.show(from, s.screen, mix); sharp.show(from, s.screen, mix);
      soft.root.style.filter = `blur(${blur}px) saturate(${1 - blur / 18})`;
      soft.root.style.opacity = blur > 0.05 ? lerp(1, 0.55, blur / 7) : 1;
      sharp.root.style.clipPath = `inset(${clip[0]}% ${clip[1]}% ${clip[2]}% ${clip[3]}% round ${lerp(68, 30, blur / 7) / z}px)`;
      sharp.root.style.visibility = blur > 0.05 ? "visible" : "hidden";
      texts.forEach((x) => x.t.at(lt, x.start + 0.5, x.end - (x.end >= dur - 0.01 ? 0.9 : 0.5)));
    };
  });
}

sectionCard("", "Home");
deepDive([
  { screen: "01-home", focus: false, dur: 5.5, text: ["Home", "What needs attention, first.", "It opens on the day's exceptions and this week's numbers, not a menu."] },
  { screen: "02-home-exceptions", focus: true, dur: 8, text: ["Home", "Problems find you.", "Boxes not yet in MAO, counts outside tolerance, replen that's stalled, each with a button to fix it."] },
]);

sectionCard("01", "Product Catalog");
deepDive([
  { screen: "03-catalog-search", focus: false, dur: 6, text: ["Product Catalog", "Scan or search anything.", "Every product, every size, from one search."] },
  { screen: "04-catalog-detail", focus: true, dur: 9, text: ["Product Catalog", "Where the tag goes.", "The hard-tag spot for every product, so nobody has to guess."] },
  { screen: "05-catalog-assign", focus: true, dur: 9, text: ["Product Catalog", "Decided once. Shared instantly.", "When a product breaks the rules, a lead picks the spot, and every phone shows it. No retagging."] },
]);

sectionCard("02", "Counts");
deepDive([
  { screen: "06-count-active", focus: true, dur: 8.5, text: ["Counts", "Scan. Count. Done.", "Confirm what's expected, enter what's there."] },
  { screen: "07-counts-flagged", focus: true, dur: 8, text: ["Counts", "Off counts stand out.", "More than 2 units or 5% off is flagged until it's recounted."] },
  { screen: "08-counts-list", focus: true, dur: 8, text: ["Counts", "Every count, on record.", "Who counted, when, and what they found, saved to the sheet."] },
]);

sectionCard("03", "Consolidations");
scene(10, (root, dur) => {
  const phones = [0, 1, 2].map(() => { const p = phone(root); p.show("09-consol-list", "09-consol-list", 0); p.dark(0); return p; });
  const rings = phones.map(() => style(el("div", "abs", "", root), { border: "4px solid var(--accent)", borderRadius: "14px" }));
  const tx = text(root, { x: 960, y: 900, w: 1700, align: "center", lines: [["h3 display", "Floor and back of house, on one list."], ["sub", "Count a line on one phone, and it updates on the others.", { marginTop: "14px" }]] });
  const r = RECTS["09-consol-list"] || { x: 16, y: 325, w: 361, h: 113 };
  const s = 0.68;
  return (lt) => {
    root.style.opacity = fade(lt, dur);
    phones.forEach((p, i) => {
      const k = i - 1, rise = ease.out(prog(lt, 0.2 + i * 0.2, 1.3 + i * 0.2));
      const x = 960 + k * 480 - (PW * s) / 2, y = lerp(120, 60, rise);
      style(p.root, { left: x + "px", top: y + "px", transform: `scale(${s})`, opacity: rise });
      const pulse = prog(lt, 2.6 + i * 0.45, 3.4 + i * 0.45), on = Math.sin(pulse * Math.PI);
      style(rings[i], { left: x + (SX + r.x - 6) * s + "px", top: y + (SY + r.y - 6) * s + "px", width: (r.w + 12) * s + "px", height: (r.h + 12) * s + "px", opacity: lt > 2.6 + i * 0.45 ? Math.max(on, prog(lt, 4.6, 5)) * (1 - prog(lt, dur - 1, dur - 0.5)) : 0 });
    });
    tx.at(lt, 1.6, dur - 0.7, 0.35);
  };
});
deepDive([
  { screen: "09-consol-list", focus: true, dur: 8.5, text: ["Consolidations", "Count as you pull.", "Tap + for every piece. Finished lines go to Holding, then one tap updates the sheet."] },
  { screen: "11-consol-mao", focus: true, dur: 8.5, text: ["Consolidations", "Close the box, everywhere.", "Every closed box is logged, with a reminder to close it in MAO too."] },
]);

sectionCard("04", "Receiving");
deepDive([
  { screen: "13-receiving-paste", focus: true, dur: 8.5, text: ["Receiving", "Paste the whole shipment.", "Copy MAO's Receive Inventory page and paste. Every box, already under its PO."] },
  { screen: "14-receiving-scan", focus: false, dur: 7.5, text: ["Receiving", "Scan the boxes as they land.", "Each label scanned is a box held, ready to mark physically received."] },
  { screen: "16-receiving-awaiting", focus: true, dur: 9, text: ["Receiving", "Nothing slips through.", "Boxes on the shelf but not yet in MAO stay on screen until they are. Hold all, mark them in one tap."] },
]);
scene(6.5, (root, dur) => {
  const tx = text(root, { x: 960, y: 360, w: 1800, align: "center", lines: [["caption", "In testing"], ["h1 display", `3:25 &nbsp;→&nbsp; <span style="color:var(--accent)">1:06</span>`, { marginTop: "18px", fontVariantNumeric: "tabular-nums" }], ["sub", "Same five boxes.", { marginTop: "20px" }]] });
  return (lt) => { root.style.opacity = fade(lt, dur); tx.at(lt, 0.3, dur - 0.8, 0.35); };
});

sectionCard("05", "Floor Stock");
deepDive([
  { screen: "17-floor-check", focus: true, dur: 8.5, text: ["Floor Stock", "One line per style.", "Check the floor for each style and colour that sold. Not every size, one line."] },
  { screen: "18-floor-sizes", focus: true, dur: 8, text: ["Floor Stock", "Pick the missing sizes.", "Tap what's needed, and it lands on the pick list."] },
  { screen: "19-floor-replen", focus: true, dur: 8, text: ["Floor Stock", "Picked, or out of stock.", "Pull it from the back, or send it to the 86 Board."] },
  { screen: "20-floor-86", focus: true, dur: 8, text: ["Floor Stock", "An 86 Board everyone sees.", "Out of stock lives on every phone, not a whiteboard in the back."] },
]);

/* ============================ ACT 5 · behind it all ============================ */

scene(19, (root, dur) => {
  const mon = el("div", "monitor", `<div class="panel"><div class="glass"><img src="${SHEET}"></div></div><div class="neck"></div><div class="foot"></div>`, root);
  const shade = style(el("div", "abs", "", root), { left: 0, right: 0, bottom: 0, height: "260px", background: "linear-gradient(rgba(255,255,255,0), #fff 55%)" });
  const cap = text(root, { x: 960, y: 40, w: 1200, align: "center", lines: [["caption", "Behind it all"]] });
  const t1 = text(root, { x: 960, y: 940, w: 1800, align: "center", lines: [["sub", "One shared Google Sheet, on any computer.", { color: "var(--ink)", fontSize: "40px" }]] });
  const t2 = text(root, { x: 960, y: 940, w: 1800, align: "center", lines: [["sub", "For managers: the day's deployment builds itself from When I Work.", { color: "var(--ink)", fontSize: "40px" }]] });
  const t3 = text(root, { x: 960, y: 940, w: 1800, align: "center", lines: [["sub", "Paste the MAO sales report, and the Hourly Tracker fills itself in.", { color: "var(--ink)", fontSize: "40px" }]] });
  // the glass: 1164 px wide showing a 1920 × 1200 screenshot
  const G0 = { x: 18, y: 18, k: 1164 / 1920 };
  const look = (ix, iy, z) => ({ z, tx: 960 - (G0.x + ix * G0.k) * z, ty: 470 - (G0.y + iy * G0.k) * z });
  const shots = [{ z: 0.9, tx: 420, ty: 104 }, look(900, 320, 1.75), look(860, 700, 1.6)];
  return (lt) => {
    root.style.opacity = fade(lt, dur);
    const a = ease.io(prog(lt, 5.5, 7.5)), b = ease.io(prog(lt, 12, 14));
    const k = (f) => lerp(lerp(shots[0][f], shots[1][f], a), shots[2][f], b);
    const rise = ease.out(prog(lt, 0.2, 1.6));
    mon.style.transform = `translate(${k("tx")}px, ${k("ty") + (1 - rise) * 40}px) scale(${k("z")})`;
    mon.style.opacity = rise;
    shade.style.opacity = a;
    cap.at(lt, 0.6, 5.2);
    t1.at(lt, 1.2, 5.3);
    t2.at(lt, 7.4, 11.8);
    t3.at(lt, 14, dur - 0.8);
  };
});
deepDive([
  { screen: "01-home", focus: false, dur: 4, text: ["Your shift", "Your day, on your phone.", "Built from When I Work every morning."] },
  { screen: "01-home", focus: true, dur: 9, text: ["Your shift", "Roles, breaks, and when you're done.", "Your whole shift at a glance, with a marker for right now. If a lead moves your break, your phone shows it."] },
]);

/* ============================ ACT 6 · close ============================ */

scene(16, (root, dur) => {
  const ph = phone(root);
  ph.root.style.transformOrigin = "50% 50%";
  ph.show("01-home", "01-home", 0); ph.dark(0);
  const tx = text(root, { x: 960, y: 760, w: 1600, align: "center", lines: [["h1 display", "Oakridge Product Suite"]] });
  return (lt) => {
    root.style.opacity = fade(lt, dur, 0.8, 2);
    const p = ease.io(prog(lt, 0, 7));
    style(ph.root, { left: 960 - PW / 2 + "px", top: lerp(560, 400, p) - PH / 2 + "px", transform: `rotate(${lerp(-10, 0, p)}deg) scale(${lerp(0.95, 0.62, p)})` });
    tx.at(lt, 5.5, dur + 5, 0.5);
  };
});

window.DURATION = T;
window.renderAt = function (t) {
  for (const s of SCENES) {
    const on = t >= s.start && t < s.start + s.dur;
    s.root.style.display = on ? "block" : "none";
    if (on) s.update(t - s.start);
  }
};
window.ready = Promise.all([document.fonts.ready, ...[...document.images].map((i) => i.decode().catch(() => {}))]);
renderAt(0);
