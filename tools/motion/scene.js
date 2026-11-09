// Oakridge Product Suite — motion piece (~1:45).
// Everything is a pure function of time t (seconds): window.renderAt(t)
// draws one frame, so frames can be captured deterministically.
// Pacing rule: every text panel holds long enough to read (6–9s); motion
// keeps drifting slowly during holds so nothing feels frozen.
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { Line2 } from "three/addons/lines/Line2.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import { LineGeometry } from "three/addons/lines/LineGeometry.js";

const W = 1920, H = 1080;

/* ---------------- easing ---------------- */
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lerp = (a, b, t) => a + (b - a) * t;
const prog = (t, a, b) => clamp((t - a) / (b - a));
const eio = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const eout = (x) => 1 - Math.pow(1 - x, 3);
const ein = (x) => x * x * x;
const expo = (x) => (x >= 1 ? 1 : 1 - Math.pow(2, -10 * x));
const back = (x) => { const c1 = 1.6, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); };
const v3 = (x, y, z) => new THREE.Vector3(x, y, z);

const PINK = new THREE.Color("#ff8fa8");
const GREEN = new THREE.Color("#34c77b");

/* ================= TIMELINE ================= */
// Intro
const I_PHONE = 4.3;          // phone materialises inside the morphed outline
const I_STATEMENT = 5.2;      // opening statement panel
// The six pages (start time, duration)
const PAGES = [];
{
  const spec = [
    ["home", 8.5], ["catalog", 7.5], ["counts", 7.5], ["consol", 8.0], ["receiving", 7.5], ["floor", 8.0],
  ];
  let t = 11.5;
  for (const [id, d] of spec) { PAGES.push({ id, start: t, end: t + d }); t += d; }
}
const B0 = PAGES[PAGES.length - 1].end;   // back end begins (~58.5)
const B_A = B0 + 2.2, B_B = B_A + 7.2, B_C = B_B + 7.2, S0 = B_C + 7.2; // three back-end panels, then sync
const S_B = S0 + 7.5, F0 = S_B + 7.0;    // two sync panels, then finale
const END = F0 + 10.5;
window.DURATION = END;

/* ---------------- renderer / scene ---------------- */
const canvas = document.getElementById("gl");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(W, H, false);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x12080b, 0.035);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
{
  const c = document.createElement("canvas");
  c.width = 960; c.height = 540;
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(480, 250, 20, 480, 270, 620);
  grad.addColorStop(0, "#3a1820");
  grad.addColorStop(0.45, "#1d0c11");
  grad.addColorStop(1, "#0a0406");
  g.fillStyle = grad;
  g.fillRect(0, 0, 960, 540);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  scene.background = tex;
}
const camera = new THREE.PerspectiveCamera(36, W / H, 0.05, 200);
scene.add(new THREE.AmbientLight(0xffffff, 0.35));
const key = new THREE.DirectionalLight(0xfff1f4, 2.2);
key.position.set(3, 5, 6);
scene.add(key);
const rim = new THREE.PointLight(0xff6f8f, 40, 30, 2);
rim.position.set(-4, 2, -3);
scene.add(rim);
const rim2 = new THREE.PointLight(0x5fe0a0, 0, 30, 2);
rim2.position.set(6, 3, -2);
scene.add(rim2);

/* ---------------- textures ---------------- */
const loader = new THREE.TextureLoader();
const texPromises = [];
function tex(path) {
  const t = loader.load(path);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  texPromises.push(new Promise((res) => {
    const check = () => (t.image && t.image.complete ? res() : setTimeout(check, 20));
    check();
  }));
  return t;
}
const T = {
  home: tex("assets/home-01-overview.png"),
  catalog: tex("assets/cat-08-detail-full.png"),
  counts: tex("assets/cnt-06-list.png"),
  consol: tex("assets/con-06-holding.png"),
  receiving: tex("assets/rec-01-top.png"),
  floor: tex("assets/flr-01-check.png"),
  cardHome: tex("assets/home-03-exceptions.png"),
  cardCatalog: tex("assets/cat-03-detail.png"),
  cardCounts: tex("assets/cnt-07-flagged.png"),
  cardConsol: tex("assets/con-02-mao.png"),
  cardReceiving: tex("assets/rec-05-awaiting.png"),
  cardFloor: tex("assets/flr-03-sizes.png"),
  logo: tex("assets/icon-512.png"),
};

// Labels are drawn to canvases; redrawn once the web fonts load (window.ready).
const labelRedraws = [];
function textTexture(lines, opts = {}) {
  const c = document.createElement("canvas");
  const t = new THREE.CanvasTexture(c);
  const draw = () => { drawText(c, lines, opts); t.needsUpdate = true; };
  draw();
  labelRedraws.push(draw);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}
function drawText(c, lines, { w = 1024, h = 256, bg = null, pad = 40 } = {}) {
  c.width = w; c.height = h;
  const g = c.getContext("2d");
  if (bg) { g.fillStyle = bg; g.beginPath(); g.roundRect(4, 4, w - 8, h - 8, 40); g.fill(); }
  let y = pad;
  for (const l of lines) {
    g.font = l.font;
    g.fillStyle = l.color;
    g.textBaseline = "top";
    g.textAlign = "center";
    if (l.spacing) g.letterSpacing = l.spacing;
    g.fillText(l.text, w / 2, y);
    y += l.size * 1.25;
  }
}
function label(lines, scale, opts) {
  const mat = new THREE.SpriteMaterial({ map: textTexture(lines, opts), transparent: true, depthWrite: false, toneMapped: false });
  const s = new THREE.Sprite(mat);
  const w = (opts && opts.w) || 1024, h = (opts && opts.h) || 256;
  s.scale.set(scale, (scale * h) / w, 1);
  return s;
}

/* ---------------- particles ---------------- */
const particles = (() => {
  const n = 1600;
  const pos = new Float32Array(n * 3);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < n; i++) {
    pos[i * 3] = (rnd() - 0.5) * 34;
    pos[i * 3 + 1] = (rnd() - 0.5) * 18;
    pos[i * 3 + 2] = (rnd() - 0.5) * 26 - 3;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  const dot = document.createElement("canvas");
  dot.width = dot.height = 64;
  const g = dot.getContext("2d");
  const rg = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  rg.addColorStop(0, "rgba(255,255,255,1)");
  rg.addColorStop(0.3, "rgba(255,200,215,0.6)");
  rg.addColorStop(1, "rgba(255,150,180,0)");
  g.fillStyle = rg;
  g.fillRect(0, 0, 64, 64);
  const mat = new THREE.PointsMaterial({ size: 0.07, map: new THREE.CanvasTexture(dot), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: 0xffb3c4, opacity: 0.7 });
  const pts = new THREE.Points(geo, mat);
  scene.add(pts);
  return pts;
})();

const glowTex = (() => {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d");
  const rg = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  rg.addColorStop(0, "rgba(255,255,255,1)");
  rg.addColorStop(0.25, "rgba(255,255,255,0.55)");
  rg.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = rg;
  g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
})();
function glow(color, size) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  s.scale.setScalar(size);
  return s;
}

const grid = (() => {
  const g = new THREE.GridHelper(80, 80, 0x7a3445, 0x4a1f29);
  g.material.transparent = true;
  g.material.opacity = 0.0;
  g.material.depthWrite = false;
  g.position.y = -2.4;
  scene.add(g);
  return g;
})();

/* ---------------- phone ---------------- */
const SCREEN_W = 0.96, SCREEN_H = 0.96 * (2110 / 975);
const screenShader = {
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `
    uniform sampler2D a; uniform sampler2D b; uniform float mixv; uniform float bright; uniform float opacity;
    varying vec2 vUv;
    void main(){
      float edge = smoothstep(mixv - 0.04, mixv + 0.04, 1.0 - vUv.y);
      vec2 shiftA = vUv + vec2(0.0, -mixv * 0.12);
      vec2 shiftB = vUv + vec2(0.0, (1.0 - mixv) * 0.12);
      vec3 ca = texture2D(a, clamp(shiftA, 0.0, 1.0)).rgb;
      vec3 cb = texture2D(b, clamp(shiftB, 0.0, 1.0)).rgb;
      vec3 col = mix(cb, ca, edge);
      float line = (1.0 - smoothstep(0.0, 0.015, abs((1.0 - vUv.y) - mixv))) * step(0.001, mixv) * step(mixv, 0.999);
      col += vec3(1.0, 0.55, 0.65) * line * 0.8;
      gl_FragColor = vec4(col * bright, opacity);
      #include <colorspace_fragment>
    }`,
};
function makePhone(texA) {
  const group = new THREE.Group();
  const body = new THREE.Mesh(
    new RoundedBoxGeometry(1.08, 2.24, 0.11, 6, 0.13),
    new THREE.MeshStandardMaterial({ color: 0x241418, metalness: 0.85, roughness: 0.25, transparent: true })
  );
  group.add(body);
  const mat = new THREE.ShaderMaterial({
    uniforms: { a: { value: texA }, b: { value: texA }, mixv: { value: 0 }, bright: { value: 1 }, opacity: { value: 1 } },
    ...screenShader, transparent: true, toneMapped: false,
  });
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(SCREEN_W, SCREEN_H), mat);
  screen.position.z = 0.0575;
  group.add(screen);
  const halo = glow(PINK, 3.4);
  halo.position.z = -0.3;
  halo.material.opacity = 0.35;
  group.add(halo);
  group.userData = { body, screen, mat, halo };
  scene.add(group);
  return group;
}
function setScreen(phone, a, b, m) {
  const u = phone.userData.mat.uniforms;
  u.a.value = a; u.b.value = b; u.mixv.value = m;
}
function setPhoneOpacity(phone, o) {
  phone.visible = o > 0.001;
  phone.userData.body.material.opacity = o;
  phone.userData.mat.uniforms.opacity.value = o;
  phone.userData.halo.material.opacity = 0.35 * o;
}
const phoneA = makePhone(T.home);
const orbitPhones = [makePhone(T.counts), makePhone(T.floor), makePhone(T.receiving)];

/* ---------------- morphing outline: ring → phone ---------------- */
const N = 240;
function roundedRectPoints(w, h, r) {
  const hw = w / 2, hh = h / 2;
  const path = new THREE.Shape();
  path.moveTo(0, hh);
  path.lineTo(hw - r, hh);
  path.quadraticCurveTo(hw, hh, hw, hh - r);
  path.lineTo(hw, -hh + r);
  path.quadraticCurveTo(hw, -hh, hw - r, -hh);
  path.lineTo(-hw + r, -hh);
  path.quadraticCurveTo(-hw, -hh, -hw, -hh + r);
  path.lineTo(-hw, hh - r);
  path.quadraticCurveTo(-hw, hh, -hw + r, hh);
  path.lineTo(0, hh);
  return path.getSpacedPoints(N - 1);
}
const rectPts = roundedRectPoints(1.2, 2.36, 0.18);
const circlePts = Array.from({ length: N }, (_, i) => {
  const a = Math.PI / 2 - (i / (N - 1)) * Math.PI * 2;
  return new THREE.Vector2(Math.cos(a) * 1.25, Math.sin(a) * 1.25);
});
const morphGeo = new LineGeometry();
const morphMat = new LineMaterial({ color: 0xff8fa8, linewidth: 5, transparent: true, worldUnits: false, toneMapped: false, depthTest: false, depthWrite: false });
morphMat.resolution.set(W, H);
const morphLine = new Line2(morphGeo, morphMat);
scene.add(morphLine);
const morphPos = new Float32Array(N * 3);
function updateMorph(m, draw, spin) {
  const ca = Math.cos(spin), sa = Math.sin(spin);
  for (let i = 0; i < N; i++) {
    const c = circlePts[i], r = rectPts[i];
    const x = lerp(c.x, r.x, m), y = lerp(c.y, r.y, m);
    morphPos[i * 3] = x * ca - y * sa;
    morphPos[i * 3 + 1] = x * sa + y * ca;
    morphPos[i * 3 + 2] = 0;
  }
  morphGeo.setPositions(morphPos);
  morphGeo.instanceCount = Math.max(1, Math.floor((N - 1) * draw));
}
const ring2 = new THREE.Mesh(new THREE.TorusGeometry(1.6, 0.006, 8, 160), new THREE.MeshBasicMaterial({ color: 0xff8fa8, transparent: true, toneMapped: false, depthWrite: false }));
scene.add(ring2);

/* ---------------- floating UI cards, one per page ---------------- */
function card(texture, maxW, maxH) {
  const img = texture.image;
  let w = maxW, h = w * (img.height / img.width);
  if (h > maxH) { h = maxH; w = h * (img.width / img.height); }
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: texture, transparent: true, toneMapped: false, side: THREE.DoubleSide, depthWrite: false }));
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(w * 1.04, h * 1.04), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false }));
  shadow.position.set(0.03, -0.04, -0.02);
  m.add(shadow);
  m.visible = false;
  m.userData.w = w;
  scene.add(m);
  return m;
}
let pageCards = [];

/* ---------------- back end: Apps Script node ---------------- */
const NODE_POS = v3(0.2, 0.35, 0);
const node = new THREE.Group();
{
  const ico = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(0.62, 1)), new THREE.LineBasicMaterial({ color: 0xff8fa8, transparent: true, toneMapped: false }));
  const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.32, 2), new THREE.MeshStandardMaterial({ color: 0x3a1620, emissive: 0xff5c80, emissiveIntensity: 1.4, metalness: 0.3, roughness: 0.4 }));
  const orbit = new THREE.Mesh(new THREE.TorusGeometry(0.95, 0.008, 8, 140), new THREE.MeshBasicMaterial({ color: 0xffc2d0, transparent: true, toneMapped: false }));
  orbit.rotation.x = Math.PI / 2.4;
  const halo = glow(new THREE.Color("#ff5c80"), 2.6);
  halo.material.opacity = 0.5;
  const lab = label([
    { text: "APPS SCRIPT", font: "700 92px Grotesk", color: "#ffffff", size: 92, spacing: "14px" },
    { text: "access key checked on every request", font: "500 44px Grotesk", color: "#f0b9c6", size: 44 },
  ], 2.1, { w: 1024, h: 256, pad: 30 });
  lab.position.set(0, -1.2, 0);
  node.add(ico, core, orbit, halo, lab);
  node.userData = { ico, core, orbit, halo, lab };
  scene.add(node);
}

/* ---------------- back end: the Google Sheet ---------------- */
const SHEET_POS = v3(3.7, -0.05, 0);
const sheet = new THREE.Group();
const COLS = 8, ROWS = 7, TW = 0.34, TH = 0.16, GAP = 0.03;
const rowMats = [];
const tiles = [];
const TABS = ["ProductMaster", "AuditLog", "ConsolLog", "ReceivingLog", "FloorRestock"];
{
  const gw = COLS * (TW + GAP), gh = ROWS * (TH + GAP);
  const panel = new THREE.Mesh(new RoundedBoxGeometry(gw + 0.3, gh + 0.62, 0.06, 4, 0.06), new THREE.MeshStandardMaterial({ color: 0x1a1d1b, metalness: 0.6, roughness: 0.35 }));
  panel.position.set(0, -0.12, -0.04);
  sheet.add(panel);
  sheet.userData.panel = panel;
  for (let r = 0; r < ROWS; r++) {
    const mat = new THREE.MeshStandardMaterial({ color: r === 0 ? 0x188038 : 0xf4f1f2, roughness: 0.55, metalness: 0.05, emissive: r === 0 ? 0x0f5a28 : 0x000000, emissiveIntensity: 1 });
    rowMats.push(mat);
    for (let c = 0; c < COLS; c++) {
      const tile = new THREE.Mesh(new THREE.BoxGeometry(TW, TH, 0.035), mat);
      tile.position.set(-gw / 2 + c * (TW + GAP) + TW / 2, gh / 2 - r * (TH + GAP) - TH / 2, 0.01);
      tile.userData = { r, c, base: tile.position.clone() };
      sheet.add(tile);
      tiles.push(tile);
    }
  }
  sheet.userData.tabs = TABS.map((name, i) => {
    const s = label([{ text: name, font: "600 64px Inter", color: "#ffffff", size: 64 }], 0.62, { w: 512, h: 128, pad: 30 });
    s.position.set(-gw / 2 + 0.33 + i * (gw - 0.66) / 4, -gh / 2 - 0.27, 0.05);
    sheet.add(s);
    return s;
  });
  const title = label([
    { text: "GOOGLE SHEET", font: "700 92px Grotesk", color: "#ffffff", size: 92, spacing: "14px" },
    { text: "one source of truth for every device", font: "500 44px Grotesk", color: "#9fe8bf", size: 44 },
  ], 2.3, { w: 1024, h: 256, pad: 30 });
  title.position.set(0, gh / 2 + 0.55, 0.05);
  sheet.add(title);
  sheet.userData.title = title;
  const halo = glow(GREEN, 6);
  halo.position.z = -0.6;
  halo.material.opacity = 0.25;
  sheet.add(halo);
  sheet.userData.halo = halo;
  scene.add(sheet);
}

/* ---------------- logo badge (finale) ---------------- */
const LOGO_POS = v3(3.7, 0.45, 0.6);
const logo = new THREE.Group();
{
  const disc = new THREE.Mesh(new THREE.CircleGeometry(0.62, 96), new THREE.MeshBasicMaterial({ map: T.logo, transparent: true, toneMapped: false }));
  const rimM = new THREE.Mesh(new THREE.TorusGeometry(0.66, 0.018, 16, 160), new THREE.MeshStandardMaterial({ color: 0xffc2d0, metalness: 0.9, roughness: 0.2, emissive: 0x5a1a28 }));
  const ringA = new THREE.Mesh(new THREE.TorusGeometry(0.86, 0.006, 8, 160), new THREE.MeshBasicMaterial({ color: 0xff8fa8, transparent: true, toneMapped: false }));
  const ringB = new THREE.Mesh(new THREE.TorusGeometry(1.06, 0.004, 8, 160), new THREE.MeshBasicMaterial({ color: 0xffc2d0, transparent: true, toneMapped: false }));
  const halo = glow(PINK, 4.2);
  halo.position.z = -0.2;
  logo.add(halo, disc, rimM, ringA, ringB);
  logo.userData = { ringA, ringB, halo };
  logo.position.copy(LOGO_POS);
  scene.add(logo);
}

/* ---------------- data packets ---------------- */
const PHONE_A_BACKEND = v3(-3.7, 0, 0);
function arc(a, b, lift) {
  const mid = a.clone().add(b).multiplyScalar(0.5);
  mid.y += lift;
  mid.z += 0.6;
  return new THREE.QuadraticBezierCurve3(a, mid, b);
}
const curveA = arc(PHONE_A_BACKEND.clone().add(v3(0.6, 0.2, 0.1)), NODE_POS.clone(), 1.1);
const curveB = arc(NODE_POS.clone(), SHEET_POS.clone().add(v3(-1.2, 0.2, 0.1)), 1.0);
function pathTube(curve, color) {
  const m = new THREE.Mesh(new THREE.TubeGeometry(curve, 80, 0.006, 6, false), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, toneMapped: false, depthWrite: false }));
  scene.add(m);
  return m;
}
const tubeA = pathTube(curveA, 0xff8fa8);
const tubeB = pathTube(curveB, 0x7fe0a8);
const TRAIL = 7;
const packetPool = [];
function getPacket(i) {
  if (!packetPool[i]) {
    const g = new THREE.Group();
    const parts = [];
    for (let k = 0; k < TRAIL; k++) { const s = glow(PINK, 0.3); g.add(s); parts.push(s); }
    g.userData.parts = parts;
    scene.add(g);
    packetPool[i] = g;
  }
  return packetPool[i];
}
// Upload packets phone → Apps Script → Sheet, through the whole back-end act
const LEG = 0.8;
const uploads = [];
for (let t0 = B_A - 1.0, i = 0; t0 < S0 - 1.6; t0 += 0.62, i++) uploads.push({ t0, row: 1 + (i % (ROWS - 1)), tab: i % TABS.length });

/* ---------------- camera path ---------------- */
const camKeys = [
  [0.0, [0, 0, 10.5], [0, 0, 0]],
  [3.4, [0, 0.05, 8.2], [0, 0, 0]],
  [I_PHONE + 0.7, [0.1, 0.12, 5.6], [0, 0, 0]],
  [I_STATEMENT + 2.2, [0.8, 0.25, 5.2], [-0.4, 0, 0]],
  [PAGES[0].start - 0.6, [0.5, 0.28, 5.0], [-0.4, 0, 0]],
];
// Per page: swing to a fresh angle during the transition, then creep slowly
// through the hold so the shot stays alive while the text is read.
PAGES.forEach((p, i) => {
  const side = i % 2 === 0 ? 1 : -1;
  camKeys.push([p.start + 1.2, [0.5 * side + (side < 0 ? -0.9 : 0.2), 0.3 + 0.08 * side, 4.9], [-0.4, 0.02, 0]]);
  camKeys.push([p.end - 0.9, [0.5 * side + (side < 0 ? -0.9 : 0.2) + 0.3 * side, 0.42, 4.75], [-0.36, 0.05, 0]]);
});
camKeys.push(
  [B0 + 0.6, [0.2, 0.55, 5.4], [-0.5, 0, 0]],
  [B_A + 1.0, [-0.5, 1.45, 10.6], [-0.15, 0.3, 0]],
  [B_B - 0.5, [-0.1, 1.55, 10.9], [0.2, 0.3, 0]],
  [B_B + 1.5, [0.9, 1.7, 11.4], [0.8, 0.35, 0]],
  [B_C - 0.3, [1.4, 1.9, 11.0], [1.2, 0.3, 0]],
  [B_C + 1.6, [2.4, 1.3, 9.6], [2.9, 0.55, 0]],
  [S0 - 0.4, [3.3, 1.7, 9.4], [3.3, 0.75, 0]],
  [S0 + 2.2, [8.4, 5.2, 9.4], [3.7, 1.0, 0]],
  [S_B, [6.4, 4.8, 10.6], [3.7, 1.0, 0]],
  [S_B + 3.5, [1.4, 4.0, 9.8], [3.7, 1.0, 0]],
  [F0 - 0.3, [3.9, 1.5, 7.8], [3.7, 0.4, 0]],
  [F0 + 1.6, [3.75, 0.4, 6.5], [3.7, 0.05, 0]],
  [END, [3.7, 0.25, 5.5], [3.7, 0.0, 0]],
);
const camPosCurve = new THREE.CatmullRomCurve3(camKeys.map((k) => v3(...k[1])), false, "centripetal");
const camTgtCurve = new THREE.CatmullRomCurve3(camKeys.map((k) => v3(...k[2])), false, "centripetal");
const kt = camKeys.map((k) => k[0]);
const ku = camKeys.map((_, i) => i / (camKeys.length - 1));
const slopes = (() => {
  const n = kt.length, d = [], m = [];
  for (let i = 0; i < n - 1; i++) d.push((ku[i + 1] - ku[i]) / (kt[i + 1] - kt[i]));
  m[0] = d[0] * 0.2; m[n - 1] = d[n - 2] * 0.6;
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (2 * d[i - 1] * d[i]) / (d[i - 1] + d[i]);
  return m;
})();
function timeToU(t) {
  if (t <= kt[0]) return 0;
  if (t >= kt[kt.length - 1]) return 1;
  let i = 0;
  while (t > kt[i + 1]) i++;
  const h = kt[i + 1] - kt[i], s = (t - kt[i]) / h;
  const h00 = 2 * s ** 3 - 3 * s ** 2 + 1, h10 = s ** 3 - 2 * s ** 2 + s, h01 = -2 * s ** 3 + 3 * s ** 2, h11 = s ** 3 - s ** 2;
  return h00 * ku[i] + h10 * h * slopes[i] + h01 * ku[i + 1] + h11 * h * slopes[i + 1];
}

/* ---------------- kinetic typography ---------------- */
const typeRoot = document.getElementById("type");
const beats = [];
// lines: [{ text, cls, wrap }] — wrap lines animate word by word and can
// break onto several lines; the rest animate letter by letter.
function beat({ lines, x, y, align = "left", start, end, style = "rise", stagger = 0.022, inDur = 0.6, outDur = 0.45, drift = 26, width }) {
  const el = document.createElement("div");
  el.className = "beat";
  el.style.left = x + "px";
  el.style.top = y + "px";
  el.style.textAlign = align;
  el.style.perspective = "900px";
  if (width) el.style.width = width + "px";
  const pieces = [];
  for (const line of lines) {
    const ld = document.createElement("div");
    ld.className = line.cls || "";
    if (line.wrap) ld.style.whiteSpace = "normal";
    if (line.style) Object.assign(ld.style, line.style);
    const tokens = line.wrap ? line.text.split(/(\s+)/) : [...line.text];
    for (const tok of tokens) {
      if (/^\s+$/.test(tok)) {
        if (line.wrap) ld.appendChild(document.createTextNode(" "));
        else { const sp = document.createElement("span"); sp.className = "ch"; sp.innerHTML = "&nbsp;"; ld.appendChild(sp); }
        continue;
      }
      const sp = document.createElement("span");
      sp.className = "ch";
      sp.textContent = tok;
      ld.appendChild(sp);
      pieces.push({ sp, word: !!line.wrap });
    }
    el.appendChild(ld);
  }
  typeRoot.appendChild(el);
  beats.push({ el, pieces, start, end, style, stagger, inDur, outDur, drift, align });
}
function renderBeats(t) {
  for (const b of beats) {
    const visible = t >= b.start - 0.05 && t <= b.end + 0.05;
    b.el.style.display = visible ? "block" : "none";
    if (!visible) continue;
    const life = prog(t, b.start, b.end);
    b.el.style.transform = (b.align === "center" ? "translateX(-50%) " : "") + `translateX(${lerp(0, b.drift, eio(life))}px)`;
    const n = b.pieces.length;
    // entrance ripples across at most ~1.1s, exit across ~0.3s
    const inStep = Math.min(b.stagger, 1.1 / Math.max(1, n));
    const outStep = Math.min(b.stagger * 0.4, 0.3 / Math.max(1, n));
    b.pieces.forEach(({ sp }, i) => {
      const s0 = b.start + i * inStep;
      const pin = prog(t, s0, s0 + b.inDur);
      const o0 = b.end - b.outDur - (n - 1 - i) * outStep;
      const pout = prog(t, o0, o0 + b.outDur);
      let tr = "", op = 1, blur = 0;
      if (b.style === "rise") {
        const e = expo(pin), o = ein(pout);
        tr = `translateY(${(1 - e) * 70 - o * 40}px) rotateX(${(1 - e) * -75}deg)`;
        op = e * (1 - o); blur = (1 - e) * 12 + o * 8;
      } else if (b.style === "slam") {
        const e = back(clamp(pin)), o = ein(pout);
        tr = `scale(${lerp(2.4, 1, e) + o * 0.5})`;
        op = clamp(pin * 2.5) * (1 - o); blur = (1 - clamp(pin * 1.4)) * 22 + o * 16;
      } else if (b.style === "slide") {
        const e = expo(pin), o = ein(pout);
        tr = `translateX(${(1 - e) * -110 + o * 70}px)`;
        op = e * (1 - o); blur = (1 - e) * 10 + o * 8;
      } else if (b.style === "flip") {
        const e = eout(pin), o = ein(pout);
        tr = `rotateY(${(1 - e) * 90}deg) translateY(${-o * 40}px)`;
        op = e * (1 - o); blur = o * 8;
      }
      sp.style.transform = tr;
      sp.style.opacity = op.toFixed(3);
      sp.style.filter = blur > 0.2 ? `blur(${blur.toFixed(1)}px)` : "none";
    });
  }
}

const TEXT_X = 140, TEXT_Y = 300, TEXT_W = 720;
// Intro words
beat({ lines: [{ text: "SCAN.", cls: "mega" }], x: 960, y: 395, align: "center", start: 0.2, end: 1.55, style: "slam", stagger: 0.06, inDur: 0.5, outDur: 0.25, drift: 0 });
beat({ lines: [{ text: "COUNT.", cls: "mega stroke" }], x: 960, y: 395, align: "center", start: 1.6, end: 2.95, style: "slam", stagger: 0.06, inDur: 0.5, outDur: 0.25, drift: 0 });
beat({ lines: [{ text: "RESTOCK.", cls: "mega accent" }], x: 960, y: 395, align: "center", start: 3.0, end: 4.4, style: "slam", stagger: 0.05, inDur: 0.5, outDur: 0.3, drift: 0 });
beat({
  lines: [
    { text: "Oakridge Product Suite  ·  v2", cls: "kicker" },
    { text: "Every floor", cls: "big" },
    { text: "process.", cls: "big" },
    { text: "One app.", cls: "big accent" },
    { text: "Tag placement, counts, consolidations, receiving and replen — on the phone, wired into one shared Google Sheet.", cls: "small", wrap: true, style: { marginTop: "22px" } },
  ],
  x: TEXT_X, y: TEXT_Y, width: TEXT_W, start: I_STATEMENT, end: PAGES[0].start - 0.2,
});
// The six pages
const PAGE_TEXT = {
  home: ["01 — Home", "What needs", "attention.", "Opens on exceptions, not a menu: boxes still waiting on MAO, counts outside tolerance, replen that's stalled — plus this week's numbers at a glance."],
  catalog: ["02 — Product Catalog", "One search.", "Every answer.", "Scan any barcode for product details, hard-tag placement and recent counts. Paste from MAO to add new products for every device."],
  counts: ["03 — Counts", "Scan. Count.", "Flag what's off.", "Confirm expected, enter actual. Anything off by more than 2 units or 5% is flagged until it's recounted — then save every count in one tap."],
  consol: ["04 — Consolidations", "HQ's list,", "tracked live.", "Count pieces as you pull them, batch finished lines into Holding, and log every closed box — with a reminder to close it in MAO too."],
  receiving: ["05 — Receiving", "On the shelf", "isn't in MAO.", "Boxes are logged in two steps. Anything physically received but not yet in MAO stays on screen until it is."],
  floor: ["06 — Floor Stock", "Needed. Picked.", "Restocked.", "One line per style: check the floor, pick the missing sizes, pull them from the back — and anything out of stock goes on the 86 Board."],
};
for (const p of PAGES) {
  const [k, a, b, body] = PAGE_TEXT[p.id];
  beat({
    lines: [{ text: k, cls: "kicker" }, { text: a, cls: "big" }, { text: b, cls: "big accent" }, { text: body, cls: "small", wrap: true, style: { marginTop: "22px" } }],
    x: TEXT_X, y: TEXT_Y, width: TEXT_W, start: p.start + 0.35, end: p.end - 0.1,
  });
}
// Back end
const BACK_X = 140, BACK_Y = 96, BACK_W = 980;
beat({ lines: [{ text: "Under the hood", cls: "kicker" }, { text: "Every tap lands in", cls: "mid" }, { text: "one shared Google Sheet.", cls: "mid green" }, { text: "No server to run and no hosting bill. If Google Sheets works, this works.", cls: "small", wrap: true, style: { marginTop: "16px" } }], x: BACK_X, y: BACK_Y, width: BACK_W, start: B_A, end: B_B - 0.1, style: "slide" });
beat({ lines: [{ text: "Apps Script", cls: "kicker" }, { text: "Checks the access key.", cls: "mid" }, { text: "Then writes the row.", cls: "mid accent" }, { text: "Every request is verified before anything is read or written — a wrong or missing key gets nothing.", cls: "small", wrap: true, style: { marginTop: "16px" } }], x: BACK_X, y: BACK_Y, width: BACK_W, start: B_B, end: B_C - 0.1, style: "slide" });
beat({ lines: [{ text: "The Sheet", cls: "kicker" }, { text: "One tab per job.", cls: "mid" }, { text: "One source of truth.", cls: "mid green" }, { text: "ProductMaster · AuditLog · ConsolMaster · ConsolLog · ReceivingLog · FloorRestock — leads can read and edit it directly.", cls: "small", wrap: true, style: { marginTop: "16px" } }], x: BACK_X, y: BACK_Y, width: 760, start: B_C, end: S0 - 0.1, style: "slide" });
// Sync
beat({ lines: [{ text: "Every device.", cls: "big" }, { text: "Same live data.", cls: "big green" }, { text: "Whatever's in the sheet is what every phone sees — pull to refresh, and everyone is on the same numbers.", cls: "small", wrap: true, style: { marginTop: "18px" } }], x: BACK_X, y: BACK_Y, width: BACK_W, start: S0 + 0.3, end: S_B - 0.1 });
beat({ lines: [{ text: "Built for the floor", cls: "kicker" }, { text: "Never blocked", cls: "big" }, { text: "by store Wi-Fi.", cls: "big accent" }, { text: "Work keeps going offline. Nothing staged is ever lost — it syncs the moment you tap Update.", cls: "small", wrap: true, style: { marginTop: "18px" } }], x: BACK_X, y: BACK_Y, width: BACK_W, start: S_B, end: F0 - 0.15 });
// Title
beat({ lines: [{ text: "Oakridge Park  ·  Arc'teryx", cls: "kicker" }], x: 960, y: 690, align: "center", start: F0 + 1.4, end: END + 1, stagger: 0.02, drift: 0 });
beat({ lines: [{ text: "Oakridge Product Suite", cls: "big" }], x: 960, y: 735, align: "center", start: F0 + 1.55, end: END + 1, style: "flip", stagger: 0.035, inDur: 0.6, drift: 0 });
beat({ lines: [{ text: "v2 — rebuilt for the floor", cls: "small" }], x: 960, y: 850, align: "center", start: F0 + 2.4, end: END + 1, stagger: 0.025, drift: 0 });

/* ---------------- grain ---------------- */
const grainCanvas = document.getElementById("grain");
const gctx = grainCanvas.getContext("2d");
const grainImg = gctx.createImageData(480, 270);
function renderGrain(frameSeed) {
  let s = (frameSeed * 9301 + 49297) % 233280 || 1;
  const d = grainImg.data;
  for (let i = 0; i < d.length; i += 4) {
    s = (s * 16807) % 2147483647;
    const v = s & 255;
    d[i] = d[i + 1] = d[i + 2] = v;
    d[i + 3] = 255;
  }
  gctx.putImageData(grainImg, 0, 0);
}

/* ================= RENDER ================= */
function pageAt(t) {
  for (let i = 0; i < PAGES.length; i++) if (t < PAGES[i].end) return i;
  return PAGES.length - 1;
}

function render(t) {
  const u = timeToU(t);
  const cp = camPosCurve.getPoint(u), ct = camTgtCurve.getPoint(u);
  cp.x += Math.sin(t * 0.9) * 0.03; cp.y += Math.sin(t * 0.6 + 1) * 0.022;
  camera.position.copy(cp);
  camera.lookAt(ct);
  camera.fov = lerp(36, 30, eio(prog(t, F0 - 0.5, END)));
  camera.updateProjectionMatrix();

  particles.rotation.y = t * 0.015;
  particles.position.y = Math.sin(t * 0.3) * 0.15;
  grid.material.opacity = 0.22 * eout(prog(t, B0, B0 + 1.6)) * (1 - ein(prog(t, F0, F0 + 1.0)));

  // ---- intro: ring draws, spins, morphs into the phone outline ----
  const draw = expo(prog(t, 0.1, 1.7));
  const m = eio(prog(t, 3.3, 4.4));
  updateMorph(m, draw, (1 - m) * (t * 1.1));
  const morphOut = 1 - eout(prog(t, 4.7, 5.4));
  morphMat.opacity = morphOut;
  morphLine.visible = morphOut > 0.01;
  morphLine.position.set(0, 0, 0.1);
  ring2.visible = t < 4.6;
  ring2.material.opacity = 0.6 * eout(prog(t, 0.3, 1.5)) * (1 - eout(prog(t, 3.4, 4.3)));
  ring2.rotation.set(1.1 + t * 0.3, t * 0.5, 0);
  ring2.scale.setScalar(lerp(0.6, 1.25, eout(prog(t, 0, 4.0))));

  // ---- phone A ----
  const appear = back(prog(t, I_PHONE, I_PHONE + 0.8));
  const pa = v3(0, 0, 0).lerp(PHONE_A_BACKEND, eio(prog(t, B0, B0 + 1.8)));
  const orbitIn = eio(prog(t, S0, S0 + 1.5));
  const orbitAngle = (k) => k * (Math.PI / 2) + 0.6 + (t - S0) * 0.32;
  const orbitPos = (k) => {
    const a = orbitAngle(k);
    return SHEET_POS.clone().add(v3(Math.cos(a) * 3.3, 0.25 + Math.sin(a * 2 + k) * 0.25, Math.sin(a) * 3.3));
  };
  if (t > S0) pa.lerp(orbitPos(0), orbitIn);
  const collapse = ein(prog(t, F0, F0 + 0.7));
  pa.lerp(LOGO_POS, collapse);
  phoneA.position.copy(pa);
  phoneA.position.y += Math.sin(t * 1.1) * 0.04;
  phoneA.scale.setScalar(Math.max(0.0001, appear * (1 - collapse)));
  setPhoneOpacity(phoneA, clamp(prog(t, I_PHONE, I_PHONE + 0.4)) * (1 - collapse));
  // During the pages, the phone turns a little toward each new card, then sways gently.
  const pi = pageAt(t);
  let ry = lerp(-0.55, 0.0, eout(prog(t, I_PHONE, I_PHONE + 1.0)));
  if (t > PAGES[0].start - 0.5 && t < B0 + 0.5) {
    const target = (pi % 2 === 0 ? -0.18 : 0.14);
    const prev = pi === 0 ? 0 : ((pi - 1) % 2 === 0 ? -0.18 : 0.14);
    ry = lerp(prev, target, eio(prog(t, PAGES[pi].start - 0.4, PAGES[pi].start + 0.8))) + Math.sin(t * 0.7) * 0.06;
  }
  ry = lerp(ry, 0.55, eio(prog(t, B0, B0 + 1.6)));
  phoneA.rotation.set(Math.sin(t * 0.6) * 0.04, ry, lerp(0, 0.04, prog(t, B0, B0 + 1.5)));
  if (t > S0) phoneA.lookAt(camera.position.x, phoneA.position.y, camera.position.z);

  // screen: statement shows Home; each page wipes to its own screen
  const screens = PAGES.map((p) => T[p.id]);
  if (t < PAGES[0].start + 0.5) setScreen(phoneA, T.home, T.home, 0);
  else {
    const i = pageAt(t);
    const p = PAGES[i];
    if (i < PAGES.length - 1 && t > p.end - 0.55) setScreen(phoneA, screens[i], screens[i + 1], eio(prog(t, p.end - 0.55, p.end + 0.1)));
    else setScreen(phoneA, i > 0 && t < p.start + 0.1 ? screens[i - 1] : screens[i], screens[i], 0);
    if (t > B0 + 0.4) setScreen(phoneA, T.floor, T.receiving, eio(prog(t, B0 + 0.4, B0 + 1.0)));
  }
  phoneA.userData.mat.uniforms.bright.value = lerp(0.2, 1, eout(prog(t, I_PHONE + 0.1, I_PHONE + 0.8)));

  // ---- one card per page lifts off the screen, holds, then flies off ----
  PAGES.forEach((p, i) => {
    const c = pageCards[i];
    const lift = eout(prog(t, p.start + 0.7, p.start + 1.6));
    const away = ein(prog(t, p.end - 0.9, p.end - 0.25));
    c.visible = lift > 0.001 && away < 0.999;
    if (!c.visible) return;
    const bob = Math.sin((t - p.start) * 0.9) * 0.03;
    c.position.set(lerp(0, 0.62 + c.userData.w * 0.48, lift) + away * 2.2, lerp(-0.1, 0.18, lift) + bob, lerp(0.06, 0.55, lift) + away * 0.6);
    c.rotation.set(0, lerp(0, -0.36, lift) - away * 0.6 + Math.sin(t * 0.5) * 0.03, lerp(0, 0.025, lift));
    c.material.opacity = clamp(lift * 2) * (1 - away);
    c.children[0].material.opacity = 0.35 * c.material.opacity;
  });

  // ---- back end: Apps Script node ----
  const nodeIn = back(prog(t, B0 + 0.6, B0 + 1.4));
  const nodeToTop = eio(prog(t, S0 - 0.2, S0 + 1.2));
  node.position.copy(NODE_POS.clone().lerp(SHEET_POS.clone().add(v3(0, 1.8, 0)), nodeToTop).lerp(LOGO_POS, collapse));
  node.scale.setScalar(Math.max(0.0001, nodeIn * lerp(1, 0.6, nodeToTop) * (1 - collapse)));
  node.visible = nodeIn > 0.001 && collapse < 0.999;
  node.userData.ico.rotation.set(t * 0.4, t * 0.55, 0);
  node.userData.orbit.rotation.z = t * 0.9;
  node.userData.lab.material.opacity = clamp(prog(t, B0 + 1.2, B0 + 1.8)) * (1 - prog(t, S0 - 0.3, S0 + 0.3));
  let pulse = 0;
  for (const up of uploads) {
    const dt = t - (up.t0 + LEG);
    if (dt > 0 && dt < 0.4) pulse = Math.max(pulse, 1 - dt / 0.4);
  }
  // panel B (Apps Script) brightens the node
  const keyFocus = clamp(prog(t, B_B, B_B + 0.6)) * (1 - prog(t, B_C - 0.4, B_C + 0.2));
  node.userData.core.material.emissiveIntensity = 1.2 + pulse * 2.2 + keyFocus * 1.2;
  node.userData.halo.material.opacity = 0.45 + pulse * 0.35 + keyFocus * 0.25;

  // ---- back end: the Sheet builds itself ----
  const SB = B0 + 0.9;
  sheet.position.copy(SHEET_POS).lerp(LOGO_POS, collapse);
  sheet.scale.setScalar(Math.max(0.0001, 1 - collapse));
  sheet.visible = t > SB && collapse < 0.999;
  sheet.rotation.set(-0.08, lerp(-0.42, 0.0, eio(prog(t, B_C, S0 + 2))), 0);
  sheet.userData.panel.scale.setScalar(Math.max(0.0001, back(prog(t, SB, SB + 0.6))));
  for (const tile of tiles) {
    const { r, c, base } = tile.userData;
    const d = SB + 0.25 + (r + c) * 0.04;
    tile.scale.setScalar(Math.max(0.0001, back(prog(t, d, d + 0.5))));
    tile.position.set(base.x, base.y, base.z + (1 - eout(prog(t, d, d + 0.5))) * 1.2);
  }
  sheet.userData.title.material.opacity = clamp(prog(t, SB + 0.8, SB + 1.4));
  sheet.userData.halo.material.opacity = 0.25 * clamp(prog(t, SB, SB + 1.2));
  const rowGlow = new Array(ROWS).fill(0);
  const tabGlow = new Array(TABS.length).fill(0);
  for (const up of uploads) {
    const dt = t - (up.t0 + 2 * LEG);
    if (dt > 0) {
      const g = Math.exp(-dt * 2.6);
      rowGlow[up.row] = Math.max(rowGlow[up.row], g);
      tabGlow[up.tab] = Math.max(tabGlow[up.tab], g);
    }
  }
  // panel C (the Sheet): tabs light up one after another
  if (t > B_C + 0.8 && t < S0) {
    const k = Math.floor((t - B_C - 0.8) / 1.1) % TABS.length;
    const f = ((t - B_C - 0.8) % 1.1) / 1.1;
    tabGlow[k] = Math.max(tabGlow[k], Math.sin(f * Math.PI));
  }
  for (let r = 1; r < ROWS; r++) {
    const w = t > S0 && t < F0 ? 0.35 * Math.max(0, Math.sin((t - S0) * 3 - r * 0.6)) : 0;
    const g = Math.max(rowGlow[r], w);
    rowMats[r].emissive.setRGB(0.25 * g, 1.5 * g, 0.75 * g);
    rowMats[r].color.setRGB(lerp(0.955, 0.75, g), lerp(0.945, 1.0, g), lerp(0.95, 0.82, g));
  }
  sheet.userData.tabs.forEach((s, i) => {
    s.material.opacity = clamp(prog(t, SB + 1.0 + i * 0.1, SB + 1.4 + i * 0.1)) * (0.55 + 0.45 * tabGlow[i]);
    s.scale.set(0.62 * (1 + tabGlow[i] * 0.14), 0.155 * (1 + tabGlow[i] * 0.14), 1);
  });
  rim2.intensity = 30 * clamp(prog(t, B0 + 0.8, B0 + 2.0)) * (1 - collapse);
  tubeA.material.opacity = 0.35 * clamp(prog(t, B0 + 0.6, B0 + 1.2)) * (1 - prog(t, S0 - 0.3, S0 + 0.3));
  tubeB.material.opacity = 0.35 * clamp(prog(t, B0 + 0.8, B0 + 1.4)) * (1 - prog(t, S0 - 0.3, S0 + 0.3));
  tubeA.visible = tubeA.material.opacity > 0.002;
  tubeB.visible = tubeB.material.opacity > 0.002;

  // ---- packets ----
  let np = 0;
  const placePacket = (curve, p, color, scale = 1) => {
    const pk = getPacket(np++);
    pk.visible = true;
    pk.userData.parts.forEach((s, k) => {
      s.position.copy(curve.getPoint(clamp(p - k * 0.025)));
      s.material.color.copy(color);
      s.material.opacity = (1 - k / TRAIL) * clamp(p * 6) * clamp((1 - p) * 8 + 0.3);
      s.scale.setScalar((0.34 * (1 - k / TRAIL) + 0.05) * scale);
    });
  };
  for (const up of uploads) {
    if (t > up.t0 && t < up.t0 + LEG) placePacket(curveA, eio(prog(t, up.t0, up.t0 + LEG)), PINK);
    else if (t >= up.t0 + LEG && t < up.t0 + 2 * LEG) placePacket(curveB, eio(prog(t, up.t0 + LEG, up.t0 + 2 * LEG)), GREEN);
  }
  // ---- sync: orbiting phones + two-way packets ----
  orbitPhones.forEach((ph, k) => {
    const inn = back(prog(t, S0 + 0.1 + k * 0.2, S0 + 0.8 + k * 0.2));
    ph.position.copy(orbitPos(k + 1).lerp(LOGO_POS, collapse));
    ph.scale.setScalar(Math.max(0.0001, inn * 0.85 * (1 - collapse)));
    setPhoneOpacity(ph, clamp(prog(t, S0 + 0.1 + k * 0.2, S0 + 0.5 + k * 0.2)) * (1 - collapse));
    ph.lookAt(camera.position.x, ph.position.y, camera.position.z);
  });
  if (t > S0 + 0.8 && t < F0) {
    const from = SHEET_POS.clone().add(v3(0, 0.2, 0));
    for (let k = 0; k < 4; k++) {
      for (let j = 0; j < 40; j++) {
        const t0 = S0 + 0.8 + k * 0.23 + j * 0.9;
        if (t0 > F0 - 0.8) break;
        const p = prog(t, t0, t0 + 0.75);
        if (p <= 0 || p >= 1) continue;
        const target = k === 0 ? phoneA.position.clone() : orbitPhones[k - 1].position.clone();
        const down = j % 2 === 0;
        placePacket(down ? arc(from, target, 0.8) : arc(target, from, 0.8), eio(p), down ? GREEN : PINK, 0.8);
      }
    }
  }
  for (let i = np; i < packetPool.length; i++) packetPool[i].visible = false;

  // ---- finale: logo ----
  const lg = back(prog(t, F0 + 0.45, F0 + 1.3));
  logo.visible = lg > 0.001;
  logo.scale.setScalar(Math.max(0.0001, lg * 0.72));
  logo.rotation.y = lerp(-0.9, 0, eout(prog(t, F0 + 0.45, F0 + 1.8))) + Math.sin(t * 0.8) * 0.03;
  logo.userData.ringA.rotation.set(1.2 + t * 0.6, t * 0.35, 0);
  logo.userData.ringB.rotation.set(t * 0.4, 1.1 + t * 0.3, 0);
  logo.userData.ringA.material.opacity = 0.8 * clamp(prog(t, F0 + 0.8, F0 + 1.4));
  logo.userData.ringB.material.opacity = 0.6 * clamp(prog(t, F0 + 0.9, F0 + 1.5));
  logo.userData.halo.material.opacity = 0.5 + 0.3 * Math.exp(-Math.max(0, t - F0 - 0.5) * 3);

  // ---- overlays ----
  renderBeats(t);
  const flash = Math.max(0, 1 - Math.abs(t - (F0 + 0.5)) / 0.25);
  document.getElementById("flash").style.opacity = (0.22 * flash * flash).toFixed(3);
  document.getElementById("bars").style.setProperty("--bar", `${Math.round(62 * eout(prog(t, 0, 0.8)))}px`);
  const fadeIn = eout(prog(t, 0, 0.5)), fadeOut = prog(t, END - 1.2, END);
  document.getElementById("stage").style.filter = `brightness(${(fadeIn * (1 - fadeOut)).toFixed(3)})`;
  renderGrain(Math.round(t * 30));

  renderer.render(scene, camera);
}

const fontLoads = ["400 40px Inter", "600 64px Inter", "800 90px Inter", "900 200px Inter", "500 40px Grotesk", "700 92px Grotesk"].map((f) => document.fonts.load(f));
window.ready = Promise.all([...texPromises, ...fontLoads]).then(() => document.fonts.ready).then(() => {
  labelRedraws.forEach((d) => d());
  const cardSpec = { home: T.cardHome, catalog: T.cardCatalog, counts: T.cardCounts, consol: T.cardConsol, receiving: T.cardReceiving, floor: T.cardFloor };
  pageCards = PAGES.map((p) => card(cardSpec[p.id], 1.15, 1.6));
  render(0);
  return true;
});
window.renderAt = (t) => { render(t); return new Promise((r) => requestAnimationFrame(() => r(true))); };
