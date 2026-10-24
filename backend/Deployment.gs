/* ============================================================================
   Oakridge Product Suite — Daily Deployment (Deployment.gs)

   Builds the day's color-coded deployment grid in the shared Google Sheet
   from the store's When I Work "entire schedule" calendar link, and serves
   each person's own shift to the app.

   Add this as a NEW file in the existing Apps Script project (Files → + →
   Script → "Deployment"), then add ONE line to computeDoGetResult() in
   Code.gs — see backend/README.md. Nothing else in Code.gs changes, so the
   original app keeps working exactly as before.

   The When I Work link is kept in the script's properties (Deployment →
   Set the When I Work link…), never in the sheet. People are matched to the
   app by initials taken from their When I Work name ("Li Snyder" → LS).

   Tabs it uses (created by Deployment → Set up deployment tabs):
     Deployment Codes  — Code | Meaning | Fill | Text | When I Work positions
     Deployment        — today's grid (rebuilt each morning, editable by hand)
     Deployment YYYY-MM-DD — previous days, hidden, kept DEPLOY.ARCHIVE_KEEP_DAYS days

   The grid is the source of truth once it's built: leads can retype any
   cell (FL, PG, PROD, B …) and the colors update by themselves; the app
   reads whatever the grid says at that moment.
   ========================================================================= */

const DEPLOY = {
  TZ: "America/Vancouver",
  SHEET: "Deployment",
  CODES_SHEET: "Deployment Codes",
  ARCHIVE_PREFIX: "Deployment ",
  ARCHIVE_KEEP_DAYS: 7, // archived days are hidden, then deleted once older than this
  // Grid: 15-minute slots from 8:00am to 10:00pm
  GRID_START_MIN: 8 * 60,
  GRID_END_MIN: 22 * 60,
  SLOT_MIN: 15,
  HEADER_ROW: 3,
  FIRST_STAFF_ROW: 4,
  MIN_STAFF_ROWS: 16, // blank rows kept for people added by hand
  COL: { NAME: 1, SHIFT: 2, BREAK30: 3, BREAK15A: 4, BREAK15B: 5, GRID: 6 },
  FEED_CACHE_SECONDS: 1800,
  // Script property holding the "entire schedule" link, set from the
  // Deployment menu. Kept out of the sheet: it shows everyone's schedule.
  GLOBAL_FEED_PROP: "WIW_GLOBAL_FEED",
  AUTO_BUILD_HOUR: 5,
  // Break policy by shift length:
  //   under 3h: none · 3h–under 5.5h: one 15 · 5.5h–8h: 15 + 30 · over 8h: 15 + 30 + 15
  BREAKS: {
    ONE_FIFTEEN_FROM_HOURS: 3.0,
    FIFTEEN_AND_THIRTY_FROM_HOURS: 5.5,
    TWO_FIFTEENS_AND_THIRTY_OVER_HOURS: 8.0, // strictly over: an 8h shift gets 15 + 30
    EDGE_BUFFER_MIN: 30, // no breaks in the first/last 30 min of a shift
    STEP_MIN: 15, // breaks land on the 15-minute grid
    MIN_ON_FLOOR: 2, // never fewer than 2 people working
    MIN_FLOOR_LEADS: 1, // never zero Floor Leads while one is scheduled
  },
  BREAK_CODE: "B",
  // Hourly Tracker, written under the staff rows: one column per hour the
  // store is open (from the Store hours table), plus CLOSE. It starts at
  // FIRST_HOUR (8am) on every day, so pre-open employee purchases have a
  // column of their own.
  TRACKER: { TITLE: "Hourly Tracker", FIRST_HOUR: 8 },
  // Store hours and % of sales live on the Deployment Codes tab, from this
  // column (G), so leads can change them without touching the script.
  PLAN_COL: 7,
  STRIVE_MULTIPLIER: 1.4, // Strive = Goal × 1.4
  MONTH_GOAL_PREFIX: "MONTH_GOAL_", // script property per month, e.g. MONTH_GOAL_2026-10
  // Pasted MAO "Items Sold" lines are kept on this hidden tab, so pasting the
  // same sales again replaces them instead of counting them twice.
  SALES_LOG_SHEET: "Sales Log",
  PASTE_WIDTH: 11, // columns in the MAO export
  // Hourly Notes, under the tracker: one tall text box per grid hour.
  NOTES: {
    TITLE: "Hourly Notes",
    BOX_HEIGHT: 160, // px; the boxes wrap, and a row can be dragged taller
  },
};

// label, kind, number format, CLOSE column[, numerator, denominator].
//   auto   — filled from the grid (who's on FL that hour)
//   plan   — % of sales, from the Deployment Codes tab
//   target — Goal × % of sales
//   sales  — filled from the pasted MAO export
//   calc   — numerator ÷ denominator
//   input  — typed in
// CLOSE: sum of the hours, the Goal, a ratio of the CLOSE values, or the
// day's units ÷ transactions (upt).
const DEPLOY_TRACKER_ROWS = [
  ["Floor Lead", "auto", "@", ""],
  ["Segment", "header", "@", ""],
  ["% of sales", "plan", "0%", "sum"],
  ["Sales Target", "target", "$#,##0", "goal"],
  ["Total", "sales", "$#,##0", "sum"],
  ["Sales %", "calc", "0%", "ratio", "Total", "Sales Target"],
  ["AOV", "calc", "$#,##0", "ratio", "Total", "Transactions"],
  ["UPT", "sales", "0.00", "upt"],
  ["Transactions", "sales", "0", "sum"],
  ["Traffic", "input", "0", "sum"],
  ["Conversion", "calc", "0%", "ratio", "Transactions", "Traffic"],
];

// Seeded once on the Deployment Codes tab, then edited there.
const DEFAULT_STORE_HOURS = [
  ["Monday", "10am", "7pm"], ["Tuesday", "10am", "7pm"], ["Wednesday", "10am", "7pm"], ["Thursday", "10am", "9pm"],
  ["Friday", "10am", "9pm"], ["Saturday", "10am", "9pm"], ["Sunday", "11am", "7pm"],
];
const DEFAULT_SALES_CURVE = [
  ["8am", ""], ["9am", ""], ["10am", 0.1], ["11am", 0.1], ["12pm", 0.15], ["1pm", 0.15], ["2pm", 0.2],
  ["3pm", 0.2], ["4pm", 0.1], ["5pm", 0.1], ["6pm", 0.1], ["7pm", ""], ["8pm", ""], ["9pm", ""],
];

// Code, meaning, fill, text color, When I Work position names that map to it.
// Seeded into the "Deployment Codes" tab once; edit the tab, not this list.
const DEFAULT_DEPLOY_CODES = [
  ["FL", "Floor Leader", "#F4A93B", "#000000", "Floor Lead, Floor Leader, Key Holder"],
  ["PROD", "BOH / Product", "#1F6FC1", "#FFFFFF", "Product Operations, BOH, Back of House, Product"],
  ["PG", "Product Guide", "#2FAE4E", "#FFFFFF", "Product Guide, Sales Associate"],
  ["VM", "Visual Merchandising", "#C2185B", "#FFFFFF", "Visual Merchandising"],
  ["INIT", "Initiatives", "#8E7CC3", "#FFFFFF", "Initiatives"],
  ["PD", "Training / Development", "#7B4FA0", "#FFFFFF", "Training, Development"],
  ["MEET", "Leadership Meeting", "#5B2C6F", "#FFFFFF", "Meeting, Leadership Meeting"],
  ["HUD", "Huddle", "#00C8D6", "#000000", "Huddle"],
  ["OPEN", "Open", "#FFF200", "#000000", "Open"],
  ["CLOSE", "Close", "#FFF200", "#000000", "Close"],
  ["TRAIN-E", "Trainee", "#FF0090", "#FFFFFF", ""],
  ["TRAINER", "Trainer", "#F8BBD0", "#000000", ""],
  ["ADMIN", "Admin", "#E53935", "#FFFFFF", "Admin"],
  ["B", "Break", "#D9D9D9", "#C0392B", ""],
];

/* ===================== time helpers (Apps Script or Node) ===================== */

function deployLocalParts_(date) {
  if (typeof Utilities !== "undefined") {
    const s = Utilities.formatDate(date, DEPLOY.TZ, "yyyy-MM-dd HH mm");
    const [day, h, m] = s.split(" ");
    return { day, minutes: Number(h) * 60 + Number(m) };
  }
  const f = new Intl.DateTimeFormat("en-CA", { timeZone: DEPLOY.TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
  const p = Object.fromEntries(f.formatToParts(date).map((x) => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, minutes: (Number(p.hour) % 24) * 60 + Number(p.minute) };
}

function deployTodayKey_() {
  return deployLocalParts_(new Date()).day;
}

// 510 -> "8:30a", 1320 -> "10p"
function deployFmtTime_(min) {
  const h24 = Math.floor(min / 60), m = min % 60;
  const h = ((h24 + 11) % 12) + 1;
  return `${h}${m ? ":" + String(m).padStart(2, "0") : ""}${h24 < 12 ? "a" : "p"}`;
}

function deployDayLabel_(dayKey) {
  const [y, mo, d] = dayKey.split("-").map(Number);
  const dt = new Date(Date.UTC(y, mo - 1, d, 12));
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${days[dt.getUTCDay()]}, ${months[mo - 1]} ${d}`;
}

/* ===================== When I Work feed → shifts ===================== */

// Minimal iCalendar parser: VEVENTs with DTSTART/DTEND/SUMMARY.
function deployParseIcs_(text) {
  const unfolded = String(text).replace(/\r\n/g, "\n").replace(/\n[ \t]/g, "");
  const events = [];
  for (const chunk of unfolded.split("BEGIN:VEVENT").slice(1)) {
    const body = chunk.split("END:VEVENT")[0];
    const f = {};
    for (const line of body.split("\n")) {
      const i = line.indexOf(":");
      if (i < 0) continue;
      const key = line.slice(0, i), name = key.split(";")[0];
      if (!(name in f)) f[name] = { key, value: line.slice(i + 1).trim() };
    }
    const start = deployIcsDate_(f.DTSTART), end = deployIcsDate_(f.DTEND);
    if (!start || !end) continue;
    const summary = f.SUMMARY ? f.SUMMARY.value.replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\n/g, " ") : "";
    events.push({ start, end, summary });
  }
  return events;
}

function deployIcsDate_(field) {
  if (!field) return null;
  const m = field.value.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/);
  if (!m) return null;
  const [, y, mo, d, h = "0", mi = "0", s = "0", z] = m;
  if (z) return new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s));
  // Floating/TZID times: When I Work sends UTC ("Z"); treat anything else as store time.
  const guess = new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s));
  const offsetMin = deployLocalParts_(guess).minutes - (+h * 60 + +mi);
  return new Date(guess.getTime() - (((offsetMin + 720) % 1440) - 720) * 60000);
}

// "Li Snyder" → "LS", "Mary Ann Smith" → "MS": first letter of the first and
// last names. This is how a person on the grid is matched to the initials
// they sign in to the app with.
function deployInitials_(name) {
  const words = String(name || "").trim().split(/\s+/).map((w) => (w.match(/\p{L}/u) || [""])[0]).filter(Boolean);
  if (!words.length) return "";
  return (words[0] + (words.length > 1 ? words[words.length - 1] : "")).toUpperCase();
}

// { initials: [names] } for initials shared by more than one name.
function deployInitialsClashes_(names) {
  const by = {};
  names.forEach((n) => { const i = deployInitials_(n); if (i) (by[i] = by[i] || []).push(n); });
  return Object.fromEntries(Object.entries(by).filter(([, ns]) => new Set(ns).size > 1));
}

function deployClashText_(names) {
  const clashes = deployInitialsClashes_(names);
  const lines = Object.entries(clashes).map(([i, ns]) => `${i}: ${[...new Set(ns)].join(", ")}`);
  return lines.length ? `\n\nThese people share initials: ${lines.join("; ")}. The app will ask each of them once which name is theirs.` : "";
}

// The "entire schedule" feed titles every shift
// "Li Snyder (Shift as Product Guide at Arc'teryx Oakridge)". Split it into
// one event list per When I Work name, each titled like a personal feed.
function deploySplitGlobalIcs_(text) {
  const byName = {};
  for (const ev of deployParseIcs_(text)) {
    const m = ev.summary.match(/^(.+?) \((Shift as .+)\)$/);
    if (!m) continue;
    const name = m[1].trim();
    (byName[name] = byName[name] || []).push({ start: ev.start, end: ev.end, summary: m[2] });
  }
  return byName;
}

// "Shift as Product Guide at Arc'teryx Oakridge" -> "Product Guide"
function deployPositionFromSummary_(summary) {
  const m = String(summary).match(/^Shift as (.+?) at /i);
  return (m ? m[1] : String(summary)).trim();
}

function deployCodeForPosition_(position, codes) {
  const p = position.toLowerCase();
  for (const c of codes) if (c.positions.some((x) => x === p)) return c.code;
  for (const c of codes) if (c.positions.some((x) => x && p.includes(x))) return c.code;
  return position.split(/\s+/).map((w) => w[0]).join("").toUpperCase().slice(0, 5) || "?";
}

// All of one person's role blocks on one day, merged where the same role
// continues, clipped to the grid hours.
function deployBlocksForDay_(events, dayKey, codes) {
  const blocks = [];
  for (const ev of events) {
    const s = deployLocalParts_(ev.start), e = deployLocalParts_(ev.end);
    if (s.day !== dayKey) continue;
    const startMin = s.minutes;
    const endMin = e.day === dayKey ? e.minutes : 24 * 60;
    const a = Math.max(startMin, DEPLOY.GRID_START_MIN), b = Math.min(endMin, DEPLOY.GRID_END_MIN);
    if (b <= a) continue;
    blocks.push({ code: deployCodeForPosition_(deployPositionFromSummary_(ev.summary), codes), start: a, end: b });
  }
  blocks.sort((x, y) => x.start - y.start);
  const merged = [];
  for (const b of blocks) {
    const last = merged[merged.length - 1];
    if (last && last.code === b.code && last.end === b.start) last.end = b.end;
    else merged.push({ ...b });
  }
  return merged;
}

/* ===================== breaks ===================== */

function deployRequiredBreaks_(hours) {
  const B = DEPLOY.BREAKS;
  if (hours > B.TWO_FIFTEENS_AND_THIRTY_OVER_HOURS) return [15, 30, 15];
  if (hours >= B.FIFTEEN_AND_THIRTY_FROM_HOURS) return [15, 30];
  if (hours >= B.ONE_FIFTEEN_FROM_HOURS) return [15];
  return [];
}

// Places every person's breaks, spaced evenly through their shift and
// staggered so people aren't on break at the same time, while
// keeping at least MIN_ON_FLOOR people and (when one's scheduled) a Floor
// Lead on the floor. If no slot satisfies the rules, the break is placed
// as close to ideal as possible and flagged for a lead to look at.
// roster: [{ name, start, end, blocks }] — adds roster[i].breaks = [{start, duration, flagged}]
function deployScheduleBreaks_(roster) {
  const B = DEPLOY.BREAKS;
  const onBreak = {}; // minute -> Set(name)
  const roleAt = (p, m) => { for (const b of p.blocks) if (b.start <= m && m < b.end) return b.code; return null; };
  const working = (p, m) => roleAt(p, m) !== null;

  const valid = (p, start, dur, placed) => {
    const end = start + dur;
    if (start < p.start || end > p.end) return false;
    for (const b of placed) if (start < b.start + b.duration + 30 && b.start < end + 30) return false; // own breaks ≥30 min apart
    for (let m = start; m < end; m += 5) {
      const away = new Set(onBreak[m] || []);
      away.add(p.name);
      const scheduled = roster.filter((q) => working(q, m));
      const onFloor = scheduled.filter((q) => !away.has(q.name));
      if (onFloor.length < B.MIN_ON_FLOOR && scheduled.length > onFloor.length) return false;
      const fls = scheduled.filter((q) => roleAt(q, m) === "FL");
      if (fls.length && onFloor.filter((q) => roleAt(q, m) === "FL").length < Math.min(B.MIN_FLOOR_LEADS, fls.length)) return false;
    }
    return true;
  };
  const snap = (m) => Math.round(m / B.STEP_MIN) * B.STEP_MIN;
  const othersOnBreak = (start, dur) => {
    for (let m = start; m < start + dur; m += 5) if (onBreak[m] && onBreak[m].size) return true;
    return false;
  };

  const order = roster.slice().sort((a, b) =>
    deployRequiredBreaks_((b.end - b.start) / 60).reduce((x, y) => x + y, 0) - deployRequiredBreaks_((a.end - a.start) / 60).reduce((x, y) => x + y, 0) || a.start - b.start);
  for (const p of order) {
    const durs = deployRequiredBreaks_((p.end - p.start) / 60);
    p.breaks = [];
    if (!durs.length) continue;
    let ws = p.start + B.EDGE_BUFFER_MIN, we = p.end - B.EDGE_BUFFER_MIN;
    if (we <= ws) { ws = p.start; we = p.end; }
    const placed = [];
    durs.forEach((dur, i) => {
      const center = ws + ((we - ws) * (i + 1)) / (durs.length + 1);
      const target = Math.max(ws, Math.min(snap(center - dur / 2), we - dur));
      // Nearest valid slot to the target where nobody else is on break:
      // first within half the spacing between this person's breaks (so they
      // stay spread through the shift), then anywhere in the shift. Only if
      // there's no such slot does a break overlap someone else's.
      const search = (radius, alone) => {
        for (let r = 0; r <= radius; r += B.STEP_MIN) {
          for (const c of r === 0 ? [target] : [target + r, target - r]) {
            if (c < ws || c + dur > we) continue;
            if (alone && othersOnBreak(c, dur)) continue;
            if (valid(p, c, dur, placed)) return c;
          }
        }
        return null;
      };
      let found = search((we - ws) / (durs.length + 1) / 2, true);
      if (found === null) found = search(we - ws, true);
      if (found === null) found = search(we - ws, false);
      placed.push({ start: found === null ? target : found, duration: dur, flagged: found === null });
    });
    p.breaks = placed.sort((a, b) => a.start - b.start);
    for (const b of p.breaks) for (let m = b.start; m < b.start + b.duration; m += 5) (onBreak[m] = onBreak[m] || new Set()).add(p.name);
  }
  return roster;
}

/* ===================== grid row <-> blocks ===================== */

function deploySlotCount_() {
  return (DEPLOY.GRID_END_MIN - DEPLOY.GRID_START_MIN) / DEPLOY.SLOT_MIN;
}

// One person's row of slot codes (role blocks with breaks laid over them).
function deploySlotsFor_(person) {
  const n = deploySlotCount_(), slots = new Array(n).fill("");
  const put = (start, end, code) => {
    for (let m = start; m < end; m += DEPLOY.SLOT_MIN) {
      const i = (m - DEPLOY.GRID_START_MIN) / DEPLOY.SLOT_MIN;
      if (i >= 0 && i < n) slots[Math.floor(i)] = code;
    }
  };
  for (const b of person.blocks) put(b.start, b.end, b.code);
  for (const b of person.breaks || []) put(b.start, b.start + b.duration, DEPLOY.BREAK_CODE);
  return slots;
}

// A grid row (as typed in the sheet) back into blocks — this is what the app sees.
function deployBlocksFromSlots_(slots) {
  const blocks = [];
  slots.forEach((raw, i) => {
    const code = String(raw || "").trim().toUpperCase();
    const start = DEPLOY.GRID_START_MIN + i * DEPLOY.SLOT_MIN;
    const last = blocks[blocks.length - 1];
    if (!code) return;
    if (last && last.code === code && last.end === start) last.end = start + DEPLOY.SLOT_MIN;
    else blocks.push({ code, start, end: start + DEPLOY.SLOT_MIN });
  });
  return blocks;
}

/* ===================== building the day (pure) ===================== */

/* ---------- keeping the break columns and the grid's B cells in step ---------- */

// "12:30p", "12:30 pm", "1p", "13:15" → minutes since midnight. A time with
// no am/pm is read as store hours: 8–11 morning, 12–7 afternoon.
function deployParseBreakTime_(text) {
  const m = String(text || "").trim().toLowerCase().match(/^(\d{1,2})(?::?(\d{2}))?\s*([ap])?\.?m?\.?$/);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2] || 0);
  if (h > 23 || min > 59) return null;
  if (m[3] === "p" && h < 12) h += 12;
  else if (m[3] === "a" && h === 12) h = 0;
  else if (!m[3] && h >= 1 && h <= 7) h += 12;
  return h * 60 + min;
}

// The grid's B runs → [30-min break, first 15, second 15] as shown in the
// BREAK / 15 MIN columns. A run of 2+ slots is the 30.
function deployBreaksFromSlots_(slots) {
  const runs = [];
  slots.forEach((code, i) => {
    if (String(code).trim().toUpperCase() !== DEPLOY.BREAK_CODE) return;
    const last = runs[runs.length - 1];
    if (last && last.end === i) last.end = i + 1;
    else runs.push({ start: i, end: i + 1 });
  });
  // A block of B can be breaks that touch (a 15 right before a 30 is three
  // slots): split it into one 30 and then 15s.
  let thirty = null;
  const fifteens = [];
  for (const r of runs) {
    for (let at = r.start; at < r.end;) {
      if (thirty === null && r.end - at >= 2) { thirty = at; at += 2; } else { fifteens.push(at); at += 1; }
    }
  }
  const time = (i) => (i === null || i === undefined ? "" : deployFmtTime_(DEPLOY.GRID_START_MIN + i * DEPLOY.SLOT_MIN));
  return [time(thirty), time(fifteens[0]), time(fifteens[1])];
}

// The grid slots the break times cover, as a sorted "i,j,…" key; null if a
// time can't be read.
function deployBreakSlotKey_(b30, b15a, b15b) {
  const idx = [];
  for (const [t, minutes] of [[b30, 30], [b15a, 15], [b15b, 15]]) {
    if (!String(t || "").trim()) continue;
    const at = deployParseBreakTime_(t);
    if (at === null) return null;
    const first = Math.floor((at - DEPLOY.GRID_START_MIN) / DEPLOY.SLOT_MIN);
    for (let k = first; k < first + minutes / DEPLOY.SLOT_MIN; k++) idx.push(k);
  }
  return [...new Set(idx)].sort((a, b) => a - b).join(",");
}

// Moves the grid's B cells to the times typed in the break columns. The slots
// a break leaves go back to the role next to them. Returns null if a time
// can't be read, so nothing is changed.
function deployMoveBreaksInSlots_(slots, b30, b15a, b15b) {
  const isB = (c) => String(c).trim().toUpperCase() === DEPLOY.BREAK_CODE;
  const out = slots.slice();
  for (let i = 0; i < out.length; i++) {
    if (!isB(out[i])) continue;
    let j = i;
    while (j < out.length && isB(out[j])) j++;
    const before = i > 0 ? String(out[i - 1]).trim() : "";
    const after = j < out.length ? String(out[j]).trim() : "";
    for (let k = i; k < j; k++) out[k] = before || after;
    i = j - 1;
  }
  const wanted = [[b30, 30], [b15a, 15], [b15b, 15]].filter(([t]) => String(t || "").trim());
  for (const [t, minutes] of wanted) {
    const at = deployParseBreakTime_(t);
    if (at === null) return null;
    const first = Math.floor((at - DEPLOY.GRID_START_MIN) / DEPLOY.SLOT_MIN);
    if (first < 0 || first >= out.length || !String(out[first]).trim()) return null; // outside the shift
    for (let k = first; k < first + minutes / DEPLOY.SLOT_MIN; k++) {
      if (k >= 0 && k < out.length && String(out[k]).trim()) out[k] = DEPLOY.BREAK_CODE; // stop at the shift's end
    }
  }
  return out;
}

// people: [{ initials, name, ics }] -> roster sorted by start time, with breaks
function deployBuildRoster_(people, dayKey, codes) {
  const roster = [];
  for (const p of people) {
    if (!p.events && !p.ics) continue;
    const blocks = deployBlocksForDay_(p.events || deployParseIcs_(p.ics), dayKey, codes);
    if (!blocks.length) continue;
    roster.push({ initials: p.initials, name: p.name || p.initials, blocks, start: blocks[0].start, end: blocks[blocks.length - 1].end });
  }
  roster.sort((a, b) => a.start - b.start || a.end - b.end || a.name.localeCompare(b.name));
  return deployScheduleBreaks_(roster);
}

/* ===================== Google Sheets side ===================== */

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("Deployment")
    .addItem("Build today's deployment", "deployMenuBuildToday")
    .addItem("Build for another date…", "deployMenuBuildDate")
    .addSeparator()
    .addItem("Set monthly goal…", "deployMenuSetMonthGoal")
    .addItem("Clear today's pasted sales…", "deployMenuClearSales")
    .addSeparator()
    .addItem("Set the When I Work link…", "deployMenuSetGlobalFeed")
    .addItem("Set up deployment tabs", "deploySetup")
    .addItem("Turn on daily auto-build", "deployInstallTrigger")
    .addItem("Turn off daily auto-build", "deployRemoveTrigger")
    .addToUi();
}

function deploySetup() {
  const ss = SpreadsheetApp.getActive();
  let codes = ss.getSheetByName(DEPLOY.CODES_SHEET);
  if (!codes) {
    codes = ss.insertSheet(DEPLOY.CODES_SHEET);
    codes.getRange(1, 1, 1, 5).setValues([["Code", "Meaning", "Fill color", "Text color", "When I Work positions (comma-separated)"]])
      .setFontWeight("bold").setBackground("#894554").setFontColor("#ffffff");
    codes.getRange(2, 1, DEFAULT_DEPLOY_CODES.length, 5).setValues(DEFAULT_DEPLOY_CODES);
    DEFAULT_DEPLOY_CODES.forEach((c, i) => codes.getRange(i + 2, 1).setBackground(c[2]).setFontColor(c[3]).setFontWeight("bold"));
    codes.setFrozenRows(1);
    codes.setColumnWidth(2, 200); codes.setColumnWidth(5, 380);
  }
  deployReadPlan_(); // seeds Store hours and % of sales next to the codes
  deployEnsureEditSync_();
  SpreadsheetApp.getActive().toast("Deployment tabs are ready. Next: Deployment → Set the When I Work link…, then Build today's deployment.");
}

function deployReadCodes_() {
  const sh = SpreadsheetApp.getActive().getSheetByName(DEPLOY.CODES_SHEET);
  const rows = sh && sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, 5).getDisplayValues() : DEFAULT_DEPLOY_CODES;
  return rows
    .filter((r) => String(r[0]).trim())
    .map((r) => ({
      code: String(r[0]).trim().toUpperCase(), label: String(r[1]).trim(),
      bg: String(r[2]).trim() || "#ffffff", fg: String(r[3]).trim() || "#000000",
      positions: String(r[4]).split(",").map((x) => x.trim().toLowerCase()).filter(Boolean),
    }));
}

function deployFetchFeed_(url) {
  const https = url.replace(/^webcal:\/\//i, "https://");
  const cache = CacheService.getScriptCache();
  const key = "wiw:" + Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, https));
  const hit = cache.get(key);
  if (hit) return hit;
  const res = UrlFetchApp.fetch(https, { muteHttpExceptions: true, followRedirects: true });
  if (res.getResponseCode() !== 200) throw new Error("When I Work answered " + res.getResponseCode());
  const text = res.getContentText();
  if (text.indexOf("BEGIN:VCALENDAR") < 0) throw new Error("That link didn't return a calendar");
  try { cache.put(key, text, DEPLOY.FEED_CACHE_SECONDS); } catch (e) { /* >100KB: skip cache */ }
  return text;
}

// Pulls the full schedule, builds the roster and (re)writes the Deployment tab.
function deployBuild(dayKey) {
  dayKey = dayKey || deployTodayKey_();
  deployEnsureEditSync_();
  const url = PropertiesService.getScriptProperties().getProperty(DEPLOY.GLOBAL_FEED_PROP);
  if (!url) throw new Error("There's no When I Work link yet. Choose Deployment → Set the When I Work link… first.");
  const codes = deployReadCodes_();
  const byName = deploySplitGlobalIcs_(deployFetchFeed_(url));
  const people = Object.keys(byName).map((name) => ({ name, initials: deployInitials_(name), events: byName[name] }));
  const roster = deployBuildRoster_(people, dayKey, codes);
  deployWriteSheet_(dayKey, roster, codes);
  return roster;
}

function deployArchiveCurrent_(ss) {
  const cur = ss.getSheetByName(DEPLOY.SHEET);
  if (!cur) return;
  const oldKey = cur.getRange("B1").getNote();
  if (oldKey) {
    const name = DEPLOY.ARCHIVE_PREFIX + oldKey;
    const existing = ss.getSheetByName(name);
    if (existing) ss.deleteSheet(existing);
    cur.setName(name);
  } else {
    ss.deleteSheet(cur);
  }
}

// Archive tab names older than keepDays before todayKey ("YYYY-MM-DD").
function deployExpiredArchives_(names, todayKey, keepDays) {
  const [y, m, d] = todayKey.split("-").map(Number);
  const cutoff = new Date(Date.UTC(y, m - 1, d - keepDays)).toISOString().slice(0, 10);
  const re = new RegExp("^" + DEPLOY.ARCHIVE_PREFIX + "(\\d{4}-\\d{2}-\\d{2})$");
  return names.filter((n) => { const hit = n.match(re); return hit && hit[1] < cutoff; });
}

// Keeps the tab bar to today's deployment: every archived day is hidden
// (still there under View → Hidden sheets), and deleted after
// ARCHIVE_KEEP_DAYS.
function deployTidyArchives_(ss, todayKey) {
  const re = new RegExp("^" + DEPLOY.ARCHIVE_PREFIX + "\\d{4}-\\d{2}-\\d{2}$");
  const sheets = ss.getSheets().filter((sh) => re.test(sh.getName()));
  const expired = deployExpiredArchives_(sheets.map((sh) => sh.getName()), todayKey, DEPLOY.ARCHIVE_KEEP_DAYS);
  for (const sh of sheets) {
    if (expired.indexOf(sh.getName()) >= 0) ss.deleteSheet(sh);
    else if (!sh.isSheetHidden()) sh.hideSheet();
  }
}

function deployWriteSheet_(dayKey, roster, codes) {
  const ss = SpreadsheetApp.getActive();
  const cur = ss.getSheetByName(DEPLOY.SHEET);
  const curKey = cur ? cur.getRange("B1").getNote() : "";
  const sameDay = !!cur && curKey === dayKey;
  const day = deployDayPlan_(deployReadPlan_(), dayKey);
  // A same-day rebuild keeps what was typed (goal, week, traffic, notes);
  // a new day keeps only the week's goal, within the same week. Sales come
  // back from the Sales Log either way.
  const keep = sameDay ? deployReadTracker_(cur) : {};
  const keepNotes = sameDay ? deployReadNotes_(cur) : {};
  const goals = cur ? deployReadGoals_(cur) : {};
  const keepGoals = sameDay ? goals : deploySameWeek_(curKey, dayKey) ? { week: goals.week } : {};
  // Built under a temporary name and swapped in at the end, so the app never
  // finds the Deployment tab missing while a build is running.
  const tmpName = DEPLOY.SHEET + " (building)";
  const leftover = ss.getSheetByName(tmpName);
  if (leftover) ss.deleteSheet(leftover);
  const sh = ss.insertSheet(tmpName, 0);
  const C = DEPLOY.COL, n = deploySlotCount_();
  const lastGridCol = C.GRID + n - 1;
  const rows = Math.max(DEPLOY.MIN_STAFF_ROWS, roster.length + 4);
  const maroon = "#894554";

  // Header block
  sh.getRange(1, 1, 2, lastGridCol).setFontFamily("Arial");
  sh.getRange("A1").setValue("DATE").setBackground(maroon).setFontColor("#fff").setFontWeight("bold").setHorizontalAlignment("center");
  sh.getRange("B1").setValue(deployDayLabel_(dayKey)).setFontWeight("bold").setNote(dayKey);
  sh.getRange("A2").setValue("Operating hours").setBackground(maroon).setFontColor("#fff").setFontSize(8).setHorizontalAlignment("center");
  sh.getRange("B2").setValue(day.label);
  sh.getRange(1, C.BREAK30, 2, 3).merge().setValue("Built from When I Work " + Utilities.formatDate(new Date(), DEPLOY.TZ, "h:mm a") + "\nEdit any cell — colors follow the code")
    .setFontSize(8).setFontColor("#7c6469").setWrap(true).setVerticalAlignment("middle");

  // Column headers: TEAM | SHIFT | BREAK | 15 MIN | 15 MIN | 8am … 9pm (4 slots per hour)
  sh.getRange(DEPLOY.HEADER_ROW, 1, 1, 5).setValues([["TEAM", "SHIFT", "BREAK", "15 MIN", "15 MIN"]]);
  for (let h = DEPLOY.GRID_START_MIN; h < DEPLOY.GRID_END_MIN; h += 60) {
    const col = C.GRID + (h - DEPLOY.GRID_START_MIN) / DEPLOY.SLOT_MIN;
    sh.getRange(DEPLOY.HEADER_ROW, col, 1, 60 / DEPLOY.SLOT_MIN).merge().setValue(deployFmtTime_(h).replace("a", "am").replace("p", "pm"));
  }
  sh.getRange(DEPLOY.HEADER_ROW, 1, 1, lastGridCol).setBackground(maroon).setFontColor("#ffffff").setFontWeight("bold").setHorizontalAlignment("center").setFontSize(9);

  // Staff rows
  const values = [];
  for (let i = 0; i < rows; i++) {
    const p = roster[i];
    if (!p) { values.push(new Array(lastGridCol).fill("")); continue; }
    const b30 = p.breaks.find((b) => b.duration === 30);
    const b15 = p.breaks.filter((b) => b.duration === 15);
    values.push([p.name, `${deployFmtTime_(p.start)}-${deployFmtTime_(p.end)}`,
      b30 ? deployFmtTime_(b30.start) : "", b15[0] ? deployFmtTime_(b15[0].start) : "", b15[1] ? deployFmtTime_(b15[1].start) : "",
      ...deploySlotsFor_(p)]);
  }
  const body = sh.getRange(DEPLOY.FIRST_STAFF_ROW, 1, rows, lastGridCol);
  body.setNumberFormat("@").setValues(values).setFontFamily("Arial").setVerticalAlignment("middle")
    .setBorder(true, true, true, true, true, true, "#d9c7cc", SpreadsheetApp.BorderStyle.SOLID);
  sh.getRange(DEPLOY.FIRST_STAFF_ROW, 1, rows, 2).setFontWeight("bold").setFontSize(10);
  sh.getRange(DEPLOY.FIRST_STAFF_ROW, C.BREAK30, rows, 3).setFontColor("#C0392B").setFontWeight("bold").setHorizontalAlignment("center");
  sh.getRange(DEPLOY.FIRST_STAFF_ROW, C.GRID, rows, n).setFontSize(7).setFontWeight("bold").setHorizontalAlignment("center");
  // grey out the break cells a shift doesn't get, like the paper template
  roster.forEach((p, i) => {
    const n15 = p.breaks.filter((b) => b.duration === 15).length;
    const has = [p.breaks.some((b) => b.duration === 30), n15 >= 1, n15 >= 2];
    has.forEach((yes, k) => { if (!yes) sh.getRange(DEPLOY.FIRST_STAFF_ROW + i, C.BREAK30 + k).setBackground("#9e9e9e"); });
  });
  // flag breaks the scheduler couldn't place within the coverage rules
  roster.forEach((p, i) => p.breaks.forEach((b) => {
    if (!b.flagged) return;
    const col = b.duration === 30 ? C.BREAK30 : C.BREAK15A + p.breaks.filter((x) => x.duration === 15).indexOf(b);
    sh.getRange(DEPLOY.FIRST_STAFF_ROW + i, col).setBackground("#ffe1e1").setNote("Couldn't keep 2 people / a Floor Lead on the floor for this break — please check it.");
  }));
  // No lines between the cells inside each hour, so touching same-code cells
  // read as one block, and an hour line at every hour. Sheets keeps a line
  // on both cells that share it, and an edge that one side says "none"
  // can vanish after it's drawn, so each hour line is set on both sides
  // and the in-hour clearing never touches an hour edge.
  const per = 60 / DEPLOY.SLOT_MIN, line = "#894554", medium = SpreadsheetApp.BorderStyle.SOLID_MEDIUM;
  for (let h = DEPLOY.GRID_START_MIN; h < DEPLOY.GRID_END_MIN; h += 60) {
    const col = C.GRID + (h - DEPLOY.GRID_START_MIN) / DEPLOY.SLOT_MIN;
    sh.getRange(DEPLOY.FIRST_STAFF_ROW, col, rows, per).setBorder(null, null, null, null, false, null);
    sh.getRange(DEPLOY.HEADER_ROW, col, rows + 1, 1).setBorder(null, true, null, null, null, null, line, medium);
    sh.getRange(DEPLOY.HEADER_ROW, col - 1, rows + 1, 1).setBorder(null, null, null, true, null, null, line, medium);
  }
  sh.getRange(DEPLOY.HEADER_ROW, C.GRID + n - 1, rows + 1, 1).setBorder(null, null, null, true, null, null, line, medium); // after 9pm

  // Colors come from conditional formatting, so typing a code recolors the cell.
  // Touching cells with the same code read as one block: the code shows only
  // in the block's first cell (the rest have their text in the fill colour)
  // and there are no lines between cells. A different code typed inside a
  // block splits it on its own, since the cell after it starts a new block.
  const grid = sh.getRange(DEPLOY.FIRST_STAFF_ROW, C.GRID, rows, n);
  sh.setConditionalFormatRules(deployGridRules_(codes, grid));

  // Legend
  const lc = lastGridCol + 2;
  sh.getRange(DEPLOY.HEADER_ROW, lc, 1, 2).setValues([["Code", "Shift functions"]]).setBackground(maroon).setFontColor("#fff").setFontWeight("bold");
  codes.forEach((c, i) => {
    sh.getRange(DEPLOY.HEADER_ROW + 1 + i, lc).setValue(c.code).setBackground(c.bg).setFontColor(c.fg).setFontWeight("bold").setHorizontalAlignment("center");
    sh.getRange(DEPLOY.HEADER_ROW + 1 + i, lc + 1).setValue(c.label);
  });

  deployWriteGoals_(sh, dayKey, keepGoals);
  const trackerTop = DEPLOY.FIRST_STAFF_ROW + rows + 1;
  deployWriteTracker_(sh, trackerTop, day, keep);
  deployWriteNotes_(sh, trackerTop + DEPLOY_TRACKER_ROWS.length + 2, day.hours, keepNotes);
  deployFillFloorLeads_(sh);
  const sales = deployApplySales_(sh, dayKey);
  deployWritePasteBox_(sh);
  if (sales && sales.items) deployPasteStatus_(sh, `Today so far: $${Math.round(sales.total).toLocaleString()} from ${sales.trans} sales (${sales.items} items pasted).`);

  // Sizing
  sh.setColumnWidth(1, 110); sh.setColumnWidth(2, 100);
  sh.setColumnWidths(C.BREAK30, 3, 58);
  sh.setColumnWidths(C.GRID, n, 26);
  sh.setColumnWidth(lc, 70); sh.setColumnWidth(lc + 1, 170);
  sh.setRowHeights(DEPLOY.FIRST_STAFF_ROW, rows, 22);
  sh.setFrozenRows(DEPLOY.HEADER_ROW);
  sh.setFrozenColumns(2);
  if (sameDay) ss.deleteSheet(cur);
  else deployArchiveCurrent_(ss);
  sh.setName(DEPLOY.SHEET);
  ss.setActiveSheet(sh);
  deployTidyArchives_(ss, deployTodayKey_() > dayKey ? deployTodayKey_() : dayKey);
}

/* ---------- edits on the day ---------- */

// Grid colour rules, first match wins: a cell that continues a block (same
// code as the cell to its left) gets its code's fill with the text hidden;
// any other cell with a code gets the fill and the code shown.
function deployGridRules_(codes, grid) {
  const here = deployColLetter_(DEPLOY.COL.GRID) + DEPLOY.FIRST_STAFF_ROW;
  const left = deployColLetter_(DEPLOY.COL.GRID - 1) + DEPLOY.FIRST_STAFF_ROW;
  const q = (code) => '"' + String(code).replace(/"/g, '""') + '"';
  const rule = () => SpreadsheetApp.newConditionalFormatRule();
  return [
    ...codes.map((c) => rule().whenFormulaSatisfied(`=AND(${here}=${q(c.code)},${left}=${q(c.code)})`)
      .setBackground(c.bg).setFontColor(c.bg).setRanges([grid]).build()),
    ...codes.map((c) => rule().whenTextEqualTo(c.code).setBackground(c.bg).setFontColor(c.fg).setRanges([grid]).build()),
  ];
}

// Installable on-edit trigger (named so it can't clash with an onEdit in
// Code.gs). Typing a time in BREAK / 15 MIN moves that person's B cells on
// the grid; editing the grid rewrites their break times. The app reads the
// grid, so both routes reach it.
function deployOnEdit(e) {
  const range = e && e.range;
  if (!range || range.getSheet().getName() !== DEPLOY.SHEET) return;
  const sh = range.getSheet();
  if (range.getColumn() >= deployPasteCol_() && range.getLastRow() >= DEPLOY.FIRST_STAFF_ROW) {
    deployHandlePaste_(sh, range);
    return;
  }
  // One edit at a time: a quick second edit waits for the first to finish
  // and then reads the row fresh, so neither undoes the other.
  const lock = LockService.getDocumentLock();
  if (!lock.tryLock(20000)) return;
  try {
    deploySyncBreaks_(sh, range);
  } finally {
    lock.releaseLock();
  }
}

// Keeps a row's BREAK / 15 MIN times and its B cells in step after an edit.
// Only cells that actually change are written, so nothing else typed in the
// meantime is overwritten, and times that still match the grid are left
// exactly as typed.
function deploySyncBreaks_(sh, range) {
  const C = DEPLOY.COL, n = deploySlotCount_();
  const tracker = deployTrackerRow_(sh);
  const r0 = Math.max(range.getRow(), DEPLOY.FIRST_STAFF_ROW);
  const r1 = Math.min(range.getLastRow(), tracker ? tracker - 1 : sh.getLastRow());
  const c0 = range.getColumn(), c1 = range.getLastColumn();
  const touchesGrid = c1 >= C.GRID && c0 < C.GRID + n;
  const touchesBreaks = c0 <= C.BREAK15B && c1 >= C.BREAK30;
  if (r1 < r0 || (!touchesGrid && !touchesBreaks)) return;

  let gridChanged = touchesGrid;
  const rows = sh.getRange(r0, 1, r1 - r0 + 1, C.GRID + n - 1).getDisplayValues();
  rows.forEach((r, i) => {
    const row = r0 + i;
    const slots = r.slice(C.GRID - 1);
    if (!slots.some((x) => String(x).trim())) return; // nobody on this row
    const typed = [r[C.BREAK30 - 1], r[C.BREAK15A - 1], r[C.BREAK15B - 1]];

    if (!touchesGrid) {
      // Times were typed: move the B cells to match.
      const moved = deployMoveBreaksInSlots_(slots, typed[0], typed[1], typed[2]);
      if (!moved) return; // a time that can't be read, or is outside the shift: left for the lead
      moved.forEach((v, k) => {
        if (v !== slots[k]) { sh.getRange(row, C.GRID + k).setValue(v); gridChanged = true; }
      });
      // Tidy just the times that were typed here ("1:30" → "1:30p").
      for (let k = 0; k < 3; k++) {
        const col = C.BREAK30 + k;
        if (col < c0 || col > c1) continue;
        const cell = sh.getRange(row, col).setBackground(null).clearNote();
        if (!String(typed[k]).trim()) continue;
        const tidy = deployFmtTime_(deployParseBreakTime_(typed[k]));
        if (tidy !== typed[k]) cell.setValue(tidy);
      }
      return;
    }

    // The grid was edited: if the times still describe its B cells, leave
    // them; otherwise rewrite the ones that changed.
    const onGrid = slots.map((x, k) => (String(x).trim().toUpperCase() === DEPLOY.BREAK_CODE ? k : -1)).filter((k) => k >= 0).join(",");
    if (deployBreakSlotKey_(typed[0], typed[1], typed[2]) === onGrid) return;
    const [b30, ...b15] = deployBreaksFromSlots_(slots);
    // a 15 that didn't move keeps its column; the moved one takes the other
    const norm = (t) => { const m = deployParseBreakTime_(t); return m === null ? "" : deployFmtTime_(m); };
    const keepAt = [1, 2].map((k) => (b15.indexOf(norm(typed[k])) >= 0 && norm(typed[k]) ? norm(typed[k]) : ""));
    const rest = b15.filter((t) => t && keepAt.indexOf(t) < 0);
    const next = [b30, keepAt[0] || rest.shift() || "", keepAt[1] || rest.shift() || ""];
    next.forEach((t, k) => {
      if (t !== typed[k] && !(t && norm(typed[k]) === t)) sh.getRange(row, C.BREAK30 + k).setValue(t).setBackground(null).clearNote();
    });
  });
  if (gridChanged) deployFillFloorLeads_(sh);
}

function deployEnsureEditSync_() {
  const ss = SpreadsheetApp.getActive();
  if (ScriptApp.getProjectTriggers().some((t) => t.getHandlerFunction() === "deployOnEdit")) return;
  ScriptApp.newTrigger("deployOnEdit").forSpreadsheet(ss).onEdit().create();
}

/* ---------- Hourly Tracker ---------- */

function deployColLetter_(col) {
  let s = "";
  for (; col > 0; col = Math.floor((col - 1) / 26)) s = String.fromCharCode(65 + ((col - 1) % 26)) + s;
  return s;
}

// First grid column of an hour (e.g. 10 → the 10:00 slot).
function deployHourCol_(hour) {
  return DEPLOY.COL.GRID + (hour * 60 - DEPLOY.GRID_START_MIN) / DEPLOY.SLOT_MIN;
}

// "10am" label for an hour, as on the grid headers.
function deployHourLabel_(hour) {
  return deployFmtTime_(hour * 60).replace("a", "am").replace("p", "pm");
}

/* ---------- Store hours and % of sales (on the Deployment Codes tab) ---------- */

function deploySeedPlan_(sh) {
  const c = DEPLOY.PLAN_COL, maroon = "#894554", n = DEFAULT_SALES_CURVE.length;
  sh.getRange(1, c, 1, 3).merge().setValue("Store hours").setBackground(maroon).setFontColor("#ffffff").setFontWeight("bold");
  sh.getRange(2, c, 1, 3).setValues([["Day", "Opens", "Closes"]]).setFontWeight("bold");
  sh.getRange(3, c, 7, 3).setNumberFormat("@").setValues(DEFAULT_STORE_HOURS);
  sh.getRange(1, c, 1, 1).setNote("The Hourly Tracker has a column for each hour the store is open that day, then CLOSE. Write times like 10am or 7pm.");
  sh.getRange(1, c + 4, 1, 2).merge().setValue("% of sales").setBackground(maroon).setFontColor("#ffffff").setFontWeight("bold");
  sh.getRange(2, c + 4, 1, 2).setValues([["Hour", "% of goal"]]).setFontWeight("bold");
  sh.getRange(3, c + 4, n, 1).setNumberFormat("@");
  sh.getRange(3, c + 5, n + 1, 1).setNumberFormat("0%");
  sh.getRange(3, c + 4, n, 2).setValues(DEFAULT_SALES_CURVE);
  const L = deployColLetter_(c + 5);
  sh.getRange(3 + n, c + 4, 1, 2).setValues([["Total", `=SUM(${L}3:${L}${2 + n})`]]).setFontWeight("bold");
  sh.getRange(1, c + 4).setNote("Each hour's share of the daily Goal: an hour's Sales Target is Goal × this. Leave an hour blank for no target. The Total shows what the hours add up to.");
  sh.setColumnWidth(c, 90); sh.setColumnWidths(c + 1, 2, 60); sh.setColumnWidth(c + 4, 60); sh.setColumnWidth(c + 5, 70);
}

// Reads (seeding on first use) the Store hours and % of sales tables.
function deployReadPlan_() {
  const sh = SpreadsheetApp.getActive().getSheetByName(DEPLOY.CODES_SHEET);
  if (!sh) return deployParsePlan_(DEFAULT_STORE_HOURS, DEFAULT_SALES_CURVE);
  const c = DEPLOY.PLAN_COL;
  if (!String(sh.getRange(1, c).getValue()).trim()) deploySeedPlan_(sh);
  return deployParsePlan_(sh.getRange(3, c, 7, 3).getDisplayValues(), sh.getRange(3, c + 4, DEFAULT_SALES_CURVE.length, 2).getValues());
}

// hoursRows: [day, opens, closes]; curveRows: [hour, share]. A share can be
// 0.1, 10 or "10%". → { storeHours: { weekday 0–6: { open, close } }, pct: { hour: share } }
function deployParsePlan_(hoursRows, curveRows) {
  const days = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  const storeHours = {};
  for (const [day, open, close] of hoursRows) {
    const d = days.indexOf(String(day).trim().toLowerCase());
    const o = deployParseBreakTime_(open), cl = deployParseBreakTime_(close);
    if (d >= 0 && o !== null && cl !== null && cl > o) storeHours[d] = { open: o, close: cl };
  }
  const pct = {};
  for (const [hour, value] of curveRows) {
    const m = deployParseBreakTime_(hour);
    if (m === null || value === "" || value === null) continue;
    const text = String(value);
    let v = typeof value === "number" ? value : parseFloat(text.replace(/[%\s]/g, ""));
    if (!isFinite(v)) continue;
    if (text.indexOf("%") >= 0 || v > 1) v = v / 100;
    pct[Math.floor(m / 60)] = v;
  }
  return { storeHours, pct };
}

// The tracker's hours for one day: from 8am (or opening, if earlier) to
// close, with CLOSE in the column after. Clipped to the grid.
function deployDayPlan_(plan, dayKey) {
  const [y, m, d] = dayKey.split("-").map(Number);
  const open = plan.storeHours[new Date(Date.UTC(y, m - 1, d)).getUTCDay()] || { open: 10 * 60, close: 19 * 60 };
  const first = Math.max(Math.min(DEPLOY.TRACKER.FIRST_HOUR, Math.floor(open.open / 60)), DEPLOY.GRID_START_MIN / 60);
  const closeHour = Math.max(first + 1, Math.min(Math.ceil(open.close / 60), DEPLOY.GRID_END_MIN / 60 - 1));
  const hours = [];
  for (let h = first; h < closeHour; h++) hours.push(h);
  const fmt = (min) => deployFmtTime_(min).replace("a", "am").replace("p", "pm");
  return { hours, closeHour, pct: plan.pct, label: `${fmt(open.open)} – ${fmt(open.close)}` };
}

/* ---------- Goal · Strive · Week · Month (rows 1–2) ---------- */

// Four label/value pairs, 7 grid columns each, across the top of the grid.
function deployGoalCells_() {
  const F = DEPLOY.COL.GRID, w = 7;
  return { width: w, goalLabel: F, goal: F + w, striveLabel: F + 2 * w, strive: F + 3 * w, weekLabel: F + 4 * w, week: F + 5 * w, monthLabel: F + 6 * w, month: F + 7 * w };
}

function deployGoalRef_() {
  return "$" + deployColLetter_(deployGoalCells_().goal) + "$1";
}

function deployMonthGoal_(dayKey) {
  const v = PropertiesService.getScriptProperties().getProperty(DEPLOY.MONTH_GOAL_PREFIX + dayKey.slice(0, 7));
  return v === null || v === "" ? null : Number(v);
}

function deployWriteMonthCell_(sh, value, dayKey) {
  const cell = sh.getRange(1, deployGoalCells_().month).clearNote();
  if (value === null) {
    const [y, m] = dayKey.split("-").map(Number);
    const month = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"][m - 1];
    cell.setNumberFormat("@").setValue("UPDATE").setFontColor("#d32f2f")
      .setNote(`No monthly goal set for ${month} ${y}. Use Deployment → Set monthly goal…`);
  } else {
    cell.setNumberFormat("$#,##0").setValue(value).setFontColor("#000000");
  }
}

function deployWriteGoals_(sh, dayKey, keep) {
  const g = deployGoalCells_(), w = g.width, goalA1 = deployColLetter_(g.goal) + "1";
  const box = (col) => sh.getRange(1, col, 2, w).merge().setFontFamily("Arial").setFontWeight("bold")
    .setHorizontalAlignment("center").setVerticalAlignment("middle");
  [[g.goalLabel, "Goal"], [g.striveLabel, "Strive"], [g.weekLabel, "Week"], [g.monthLabel, "Month"]].forEach(([col, text]) => {
    const strive = col === g.striveLabel;
    box(col).setValue(text).setFontSize(12).setBackground(strive ? "#f8d7e3" : "#b5577a").setFontColor(strive ? "#b5577a" : "#ffffff");
  });
  box(g.goal).setNumberFormat("$#,##0").setValue(keep.goal === undefined ? "" : keep.goal).setFontSize(14).setBackground("#ffff00")
    .setNote("Type today's sales goal. Each hour's Sales Target is this × its % of sales.");
  box(g.strive).setNumberFormat("$#,##0").setFormula(`=IF(${goalA1}="","",${goalA1}*${DEPLOY.STRIVE_MULTIPLIER})`).setFontSize(14);
  box(g.week).setNumberFormat("$#,##0").setValue(keep.week === undefined ? "" : keep.week).setFontSize(14)
    .setNote("Type this week's goal. It carries over to each day's deployment until Sunday.");
  box(g.month).setFontSize(14);
  deployWriteMonthCell_(sh, deployMonthGoal_(dayKey), dayKey);
}

// { goal, week } typed on a tab ({} for a tab built before the goal block).
function deployReadGoals_(sh) {
  const g = deployGoalCells_();
  if (String(sh.getRange(1, g.goalLabel).getValue()) !== "Goal") return {};
  return { goal: sh.getRange(1, g.goal).getValue(), week: sh.getRange(1, g.week).getValue() };
}

// Same Monday-to-Sunday week?
function deploySameWeek_(a, b) {
  if (!a || !b) return false;
  const monday = (key) => {
    const [y, m, d] = key.split("-").map(Number);
    const t = new Date(Date.UTC(y, m - 1, d));
    t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7));
    return t.toISOString().slice(0, 10);
  };
  return monday(a) === monday(b);
}

function deployMenuSetMonthGoal() {
  const ui = SpreadsheetApp.getUi();
  const today = deployTodayKey_(), month = today.slice(0, 7);
  const [y, m] = month.split("-").map(Number);
  const name = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"][m - 1] + " " + y;
  const current = deployMonthGoal_(today);
  const r = ui.prompt("Monthly goal", `Sales goal for ${name}${current !== null ? ` (now $${Math.round(current).toLocaleString()})` : ""}:`, ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  const value = Number(r.getResponseText().replace(/[$,\s]/g, ""));
  if (!isFinite(value) || value <= 0) { ui.alert("Please enter an amount, like 685137."); return; }
  const props = PropertiesService.getScriptProperties();
  props.setProperty(DEPLOY.MONTH_GOAL_PREFIX + month, String(value));
  // forget goals from more than a year ago
  props.getKeys().filter((k) => k.indexOf(DEPLOY.MONTH_GOAL_PREFIX) === 0 && k < DEPLOY.MONTH_GOAL_PREFIX + `${y - 1}-${String(m).padStart(2, "0")}`)
    .forEach((k) => props.deleteProperty(k));
  const sh = SpreadsheetApp.getActive().getSheetByName(DEPLOY.SHEET);
  if (sh && sh.getRange("B1").getNote().slice(0, 7) === month) deployWriteMonthCell_(sh, value, today);
  ui.alert(`Saved. Every deployment in ${name} shows a monthly goal of $${Math.round(value).toLocaleString()}.`);
}

/* ---------- Hourly Tracker ---------- */

// The tracker's cell contents, as a values/formulas block: one row per
// DEPLOY_TRACKER_ROWS entry, columns 1 … lastCol. keep[label][hour] = value.
function deployTrackerValues_(top, lastCol, day, keep) {
  const L = deployColLetter_, span = 60 / DEPLOY.SLOT_MIN, goal = deployGoalRef_();
  const first = deployHourCol_(day.hours[0]);
  const lastHourEnd = deployHourCol_(day.hours[day.hours.length - 1]) + span - 1;
  const close = deployHourCol_(day.closeHour);
  const rowOf = {};
  DEPLOY_TRACKER_ROWS.forEach((r, i) => (rowOf[r[0]] = top + 1 + i));
  return DEPLOY_TRACKER_ROWS.map(([label, kind, , closeAgg, num, den]) => {
    const row = new Array(lastCol).fill("");
    const r = rowOf[label];
    row[0] = label;
    for (const h of day.hours) {
      const c = deployHourCol_(h), at = (l) => `${L(c)}${rowOf[l]}`;
      if (kind === "header") row[c - 1] = deployHourLabel_(h);
      else if (kind === "plan") row[c - 1] = day.pct[h] === undefined ? "" : day.pct[h];
      else if (kind === "target") row[c - 1] = `=IF(OR(${goal}="",${at("% of sales")}=""),"",${goal}*${at("% of sales")})`;
      else if (kind === "calc") row[c - 1] = `=IF(${at(num)}="","",IFERROR(${at(num)}/${at(den)},""))`;
      else if (keep[label] && keep[label][h] !== undefined) row[c - 1] = keep[label][h];
    }
    const range = `${L(first)}${r}:${L(lastHourEnd)}${r}`, cl = (l) => `${L(close)}${rowOf[l]}`;
    if (kind === "header") row[close - 1] = "CLOSE";
    else if (closeAgg === "sum") row[close - 1] = `=IF(COUNT(${range}),SUM(${range}),"")`;
    else if (closeAgg === "goal") row[close - 1] = `=IF(${goal}="","",${goal})`;
    else if (closeAgg === "ratio") row[close - 1] = `=IF(${cl(num)}="","",IFERROR(${cl(num)}/${cl(den)},""))`;
    else if (closeAgg === "upt") {
      const t = rowOf.Transactions;
      row[close - 1] = `=IFERROR(SUMPRODUCT(${range},${L(first)}${t}:${L(lastHourEnd)}${t})/${cl("Transactions")},"")`;
    }
    return row;
  });
}

function deployWriteTracker_(sh, top, day, keep) {
  const span = 60 / DEPLOY.SLOT_MIN, lastCol = DEPLOY.COL.GRID + deploySlotCount_() - 1;
  const R = DEPLOY_TRACKER_ROWS, n = R.length;
  const first = deployHourCol_(day.hours[0]), close = deployHourCol_(day.closeHour);
  const pink = "#b5577a", grey = "#d9d9d9", closeGrey = "#bfbfbf", filler = "#f4eff1";

  // Title bar. Columns A–B are frozen and a merge can't cross into them.
  sh.getRange(top, 1, 1, lastCol).setBackground(pink);
  sh.getRange(top, 3, 1, lastCol - 2).merge().setValue(DEPLOY.TRACKER.TITLE)
    .setFontColor("#ffffff").setFontWeight("bold").setFontSize(12).setHorizontalAlignment("center");

  // Formats go on before the values, so "10am" stays text.
  R.forEach(([, , fmt], i) => sh.getRange(top + 1 + i, 1, 1, lastCol).setNumberFormat(fmt));
  sh.getRange(top + 1, 1, n, lastCol).setValues(deployTrackerValues_(top, lastCol, day, keep))
    .setFontFamily("Arial").setFontSize(10).setHorizontalAlignment("center").setVerticalAlignment("middle")
    .setBorder(true, true, true, true, true, true, "#5b4a4e", SpreadsheetApp.BorderStyle.SOLID);
  for (const h of day.hours) sh.getRange(top + 1, deployHourCol_(h), n, span).mergeAcross();
  sh.getRange(top + 1, close, n, span).mergeAcross();

  R.forEach(([, kind], i) => {
    if (kind !== "input" && kind !== "sales" && kind !== "auto") sh.getRange(top + 1 + i, 1, 1, lastCol).setBackground(grey);
  });
  sh.getRange(top + 1, 1, n, 1).setFontWeight("bold");
  sh.getRange(top + 2, 1, 1, lastCol).setFontWeight("bold"); // Segment
  sh.getRange(top + 1, 2, n, first - 2).setBackground(filler).setBorder(null, null, null, null, false, false); // before opening
  sh.getRange(top + 1, close, n, span).setBackground(closeGrey).setFontWeight("bold");
  if (close + span <= lastCol) sh.getRange(top + 1, close + span, n, lastCol - close - span + 1).setBackground(filler).setBorder(null, null, null, null, false, false);
  sh.setRowHeight(top, 26);
  sh.setRowHeights(top + 1, n, 22);
}

// Where everything in a tab's tracker is: row per label, and each hour's
// column read back from the Segment row. null if the tab has no tracker.
function deployTrackerLayout_(sh) {
  const top = deployTrackerRow_(sh);
  if (!top) return null;
  const lastCol = DEPLOY.COL.GRID + deploySlotCount_() - 1;
  const values = sh.getRange(top + 1, 1, DEPLOY_TRACKER_ROWS.length, lastCol).getValues();
  const rowOf = {};
  values.forEach((r, i) => { const l = String(r[0]).trim(); if (l) rowOf[l] = top + 1 + i; });
  const hours = [];
  let closeCol = 0;
  if (rowOf.Segment) {
    values[rowOf.Segment - top - 1].forEach((v, i) => {
      const t = String(v).trim();
      if (i === 0 || !t) return;
      if (t === "CLOSE") closeCol = i + 1;
      else { const m = deployParseBreakTime_(t); if (m !== null) hours.push({ hour: Math.floor(m / 60), col: i + 1 }); }
    });
  }
  return { top, rowOf, hours, closeCol, values, lastCol };
}

// { label: { hour: value } } for the typed-in rows of a tab's tracker.
function deployReadTracker_(sh) {
  const lay = deployTrackerLayout_(sh);
  if (!lay) return {};
  const kinds = Object.fromEntries(DEPLOY_TRACKER_ROWS.map((r) => [r[0], r[1]]));
  const out = {};
  for (const [label, row] of Object.entries(lay.rowOf)) {
    if (kinds[label] !== "input") continue;
    out[label] = {};
    for (const { hour, col } of lay.hours) out[label][hour] = lay.values[row - lay.top - 1][col - 1];
  }
  return out;
}

// Floor Lead row ← initials of whoever is on FL in each hour on the grid
// ("MS/SC" when two people share the hour, most time first).
function deployFillFloorLeads_(sh) {
  const lay = deployTrackerLayout_(sh);
  if (!lay || !lay.rowOf["Floor Lead"]) return;
  const C = DEPLOY.COL, n = deploySlotCount_(), per = 60 / DEPLOY.SLOT_MIN;
  const staffRows = lay.top - 1 - DEPLOY.FIRST_STAFF_ROW;
  if (staffRows < 1) return;
  const grid = sh.getRange(DEPLOY.FIRST_STAFF_ROW, 1, staffRows, C.GRID + n - 1).getDisplayValues().filter((r) => String(r[0]).trim());
  const row = lay.values[lay.rowOf["Floor Lead"] - lay.top - 1].slice();
  for (const { hour, col } of lay.hours) {
    const s0 = (hour * 60 - DEPLOY.GRID_START_MIN) / DEPLOY.SLOT_MIN;
    const leads = grid
      .map((r) => ({ who: deployInitials_(r[0]), n: r.slice(C.GRID - 1 + s0, C.GRID - 1 + s0 + per).filter((x) => String(x).trim().toUpperCase() === "FL").length }))
      .filter((x) => x.n > 0)
      .sort((a, b) => b.n - a.n);
    row[col - 1] = [...new Set(leads.map((x) => x.who))].join("/");
  }
  sh.getRange(lay.rowOf["Floor Lead"], 1, 1, lay.lastCol).setValues([row]);
}

/* ---------- MAO "Items Sold" paste box ---------- */

// The box sits to the right of the legend.
function deployPasteCol_() {
  return DEPLOY.COL.GRID + deploySlotCount_() - 1 + 5;
}

function deployWritePasteBox_(sh) {
  const c = deployPasteCol_(), w = DEPLOY.PASTE_WIDTH, maroon = "#894554";
  if (sh.getMaxColumns() < c + w + 3) sh.insertColumnsAfter(sh.getMaxColumns(), c + w + 3 - sh.getMaxColumns());
  sh.getRange(1, c, 1, w).merge().setValue("Items sold (MAO export)").setBackground(maroon).setFontColor("#ffffff")
    .setFontWeight("bold").setFontSize(12).setHorizontalAlignment("center");
  sh.getRange(2, c, 1, w).merge().setValue("Paste the export into the yellow cell ↓  It's added to the Hourly Tracker, then cleared.")
    .setFontSize(9).setFontColor("#5b4a4e").setHorizontalAlignment("center");
  sh.getRange(DEPLOY.HEADER_ROW, c, 1, w).merge().setValue("Nothing pasted yet today").setBackground("#f4eff1")
    .setFontSize(9).setFontColor("#5b4a4e").setHorizontalAlignment("center");
  sh.getRange(DEPLOY.FIRST_STAFF_ROW, c, 1, w).setBackground("#fff59d")
    .setNote("Copy the Items Sold report from MAO (with or without its header row) and paste it here with Ctrl/Cmd+V. " +
      "Paste as often as you like through the day, or once at close: sales already pasted are replaced, never counted twice. " +
      "Sales from another day are ignored.");
  sh.setColumnWidths(c, w, 90);
}

function deployPasteStatus_(sh, text) {
  sh.getRange(DEPLOY.HEADER_ROW, deployPasteCol_()).setValue(text);
}

// "1,400" / "$1,400.00" / "(380)" / 380 → number, or null.
function deployParseMoney_(v) {
  if (typeof v === "number") return isFinite(v) ? v : null;
  const t = String(v || "").trim();
  if (!t) return null;
  const neg = /^\(.*\)$/.test(t) || /^-/.test(t);
  const n = parseFloat(t.replace(/[^0-9.]/g, ""));
  return isFinite(n) ? (neg ? -n : n) : null;
}

// "Oct 15, 2026 12:44:10 PM" (or the Date Sheets turns it into) → { day: "2026-10-15", secs }.
function deployParseSaleTime_(v, tz) {
  if (v instanceof Date && !isNaN(v)) {
    const s = typeof Utilities !== "undefined" ? Utilities.formatDate(v, tz, "yyyy-MM-dd HH:mm:ss") : v.toISOString().slice(0, 19).replace("T", " ");
    const [day, time] = s.split(" ");
    const [h, m, sec] = time.split(":").map(Number);
    return { day, secs: h * 3600 + m * 60 + sec };
  }
  const t = String(v || "").trim().match(/^([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp])\.?[Mm]\.?$/);
  if (!t) return null;
  const mon = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].indexOf(t[1].toLowerCase());
  if (mon < 0) return null;
  let h = Number(t[4]) % 12;
  if (t[7].toLowerCase() === "p") h += 12;
  return { day: `${t[3]}-${String(mon + 1).padStart(2, "0")}-${t[2].padStart(2, "0")}`, secs: h * 3600 + Number(t[5]) * 60 + Number(t[6] || 0) };
}

// Pasted rows → sale lines { day, secs, sku, qty, amount }. Columns are found
// from the header row when it's included, otherwise MAO's standard order:
// Creation Time … SKU, Quantity Sold, On Hand Quantity, In Store Price.
function deployParseItemsSold_(values, tz) {
  let col = { time: 0, sku: 7, qty: 8, price: 10 };
  const lines = [];
  let skipped = 0;
  for (const row of values) {
    const lower = row.map((v) => String(v).trim().toLowerCase());
    if (lower.indexOf("creation time") >= 0) {
      const find = (names, fallback) => { const i = lower.findIndex((x) => names.indexOf(x) >= 0); return i >= 0 ? i : fallback; };
      col = { time: find(["creation time"], 0), sku: find(["sku"], 7), qty: find(["quantity sold", "quantity", "qty"], 8), price: find(["in store price", "price"], 10) };
      continue;
    }
    if (lower.every((x) => !x)) continue;
    const t = deployParseSaleTime_(row[col.time], tz);
    const price = deployParseMoney_(row[col.price]);
    if (!t || price === null) { skipped++; continue; }
    const qty = deployParseMoney_(row[col.qty]);
    const units = qty === null ? 1 : qty;
    lines.push({ day: t.day, secs: t.secs, sku: String(row[col.sku] || "").trim(), qty: units, amount: Math.round(price * units * 100) / 100 });
  }
  return { lines, skipped };
}

// The day's stored lines with a new paste merged in: the paste replaces
// every stored line of that day inside the time span it covers, so pasting
// the same sales again (or a fuller export) never double-counts.
function deployMergeSales_(existing, dayKey, fresh) {
  if (!fresh.length) return existing.slice();
  const lo = Math.min(...fresh.map((l) => l.secs)), hi = Math.max(...fresh.map((l) => l.secs));
  return existing.filter((l) => !(l.day === dayKey && l.secs >= lo && l.secs <= hi)).concat(fresh);
}

// Per tracker hour: { total, units, trans }. Items rung up at the same second
// are one sale. Sales before opening count in the first hour, after closing
// in the last. Hours after the latest sale are left out (blank).
function deploySalesByHour_(lines, hours) {
  const out = {};
  if (!lines.length || !hours.length) return out;
  const bySale = {};
  for (const l of lines) (bySale[l.secs] = bySale[l.secs] || []).push(l);
  const hourOf = (secs) => Math.max(hours[0], Math.min(hours[hours.length - 1], Math.floor(secs / 3600)));
  const latest = hourOf(Math.max(...lines.map((l) => l.secs)));
  for (const h of hours) if (h <= latest) out[h] = { total: 0, units: 0, trans: 0 };
  for (const [secs, items] of Object.entries(bySale)) {
    const o = out[hourOf(Number(secs))];
    const units = items.reduce((n, l) => n + l.qty, 0);
    o.total = Math.round((o.total + items.reduce((n, l) => n + l.amount, 0)) * 100) / 100;
    o.units += units;
    if (units > 0) o.trans += 1; // a return on its own isn't a sale
  }
  return out;
}

function deploySalesLog_(create) {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(DEPLOY.SALES_LOG_SHEET);
  if (!sh && create) {
    sh = ss.insertSheet(DEPLOY.SALES_LOG_SHEET);
    sh.getRange(1, 1, 1, 5).setValues([["Day", "Seconds after midnight", "SKU", "Qty", "Amount"]]).setFontWeight("bold");
    sh.getRange(1, 1, sh.getMaxRows(), 1).setNumberFormat("@");
    sh.hideSheet();
  }
  return sh;
}

function deployReadSalesLog_(sh) {
  if (!sh || sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, 5).getValues()
    .filter((r) => String(r[0]).trim())
    .map((r) => ({ day: String(r[0]), secs: Number(r[1]), sku: String(r[2]), qty: Number(r[3]), amount: Number(r[4]) }));
}

// Writes the day's Total / Transactions / UPT from the Sales Log into a
// tab's tracker. Returns the day's totals.
function deployApplySales_(sh, dayKey) {
  const lay = deployTrackerLayout_(sh);
  if (!lay || !lay.rowOf.Total) return null;
  const lines = deployReadSalesLog_(deploySalesLog_(false)).filter((l) => l.day === dayKey);
  const byHour = deploySalesByHour_(lines, lay.hours.map((h) => h.hour));
  const fill = (label, pick) => {
    if (!lay.rowOf[label]) return;
    const row = lay.values[lay.rowOf[label] - lay.top - 1].slice();
    for (const { hour, col } of lay.hours) row[col - 1] = byHour[hour] ? pick(byHour[hour]) : "";
    sh.getRange(lay.rowOf[label], 1, 1, lay.lastCol).setValues([row]);
  };
  fill("Total", (o) => o.total);
  fill("Transactions", (o) => o.trans);
  fill("UPT", (o) => (o.trans ? Math.round((o.units / o.trans) * 100) / 100 : ""));
  const sum = (k) => Object.values(byHour).reduce((n, o) => n + o[k], 0);
  return { items: lines.length, total: Math.round(sum("total") * 100) / 100, trans: sum("trans") };
}

// Installable on-edit: something was pasted into the box.
function deployHandlePaste_(sh, range) {
  const lock = LockService.getDocumentLock();
  lock.waitLock(30000);
  try {
    const ss = SpreadsheetApp.getActive();
    const dayKey = sh.getRange("B1").getNote();
    const { lines, skipped } = deployParseItemsSold_(range.getValues(), ss.getSpreadsheetTimeZone());
    // Clear the box, ready for the next paste.
    const c = deployPasteCol_();
    const width = Math.max(range.getLastColumn(), c + DEPLOY.PASTE_WIDTH - 1) - c + 1;
    sh.getRange(DEPLOY.FIRST_STAFF_ROW, c, sh.getMaxRows() - DEPLOY.FIRST_STAFF_ROW + 1, width).clear();
    sh.getRange(DEPLOY.FIRST_STAFF_ROW, c, 1, DEPLOY.PASTE_WIDTH).setBackground("#fff59d");

    const today = lines.filter((l) => l.day === dayKey);
    const otherDays = lines.length - today.length;
    if (!today.length) {
      const why = !lines.length ? "Nothing in that paste looked like the MAO Items Sold export." : `That paste had no sales from ${deployDayLabel_(dayKey)} (${otherDays} from other days).`;
      deployPasteStatus_(sh, why);
      ss.toast(why, "Items sold", 8);
      return;
    }
    const log = deploySalesLog_(true);
    const merged = deployMergeSales_(deployReadSalesLog_(log), dayKey, today)
      .filter((l) => !deployExpiredArchives_([DEPLOY.ARCHIVE_PREFIX + l.day], dayKey, DEPLOY.ARCHIVE_KEEP_DAYS).length);
    if (log.getLastRow() > 1) log.getRange(2, 1, log.getLastRow() - 1, 5).clearContent();
    if (merged.length) log.getRange(2, 1, merged.length, 5).setValues(merged.map((l) => [l.day, l.secs, l.sku, l.qty, l.amount]));

    const day = deployApplySales_(sh, dayKey);
    const time = Utilities.formatDate(new Date(), DEPLOY.TZ, "h:mm a");
    const extra = [skipped ? `${skipped} unreadable rows skipped` : "", otherDays ? `${otherDays} from other days ignored` : ""].filter(Boolean).join(" · ");
    const msg = `${time}: ${today.length} items read. Today so far $${Math.round(day.total).toLocaleString()} from ${day.trans} sales.` + (extra ? ` (${extra})` : "");
    const odd = deployOutsideHours_(today, deployDayPlan_(deployReadPlan_(), dayKey));
    if (odd) {
      const warn = `${odd} of these sales are timed well outside ${deployFmtTime_(DEPLOY.TRACKER.FIRST_HOUR * 60).replace("a", "am")} to close. If the times look shifted, the computer that exported them may be on the wrong time zone: use Deployment → Clear today's pasted sales, then paste an export from a computer set to Pacific time.`;
      deployPasteStatus_(sh, "⚠ " + warn);
      SpreadsheetApp.getUi().alert("Check the sale times", msg + "\n\n" + warn, SpreadsheetApp.getUi().ButtonSet.OK);
      return;
    }
    deployPasteStatus_(sh, msg);
    ss.toast(msg, "Items sold", 8);
  } finally {
    lock.releaseLock();
  }
}

// How many sale lines fall more than 30 minutes outside the tracker's hours
// (8am to close): a sign the export came from a computer on another time zone.
function deployOutsideHours_(lines, day) {
  const open = day.hours[0] * 3600 - 1800, close = day.closeHour * 3600 + 1800;
  return lines.filter((l) => l.secs < open || l.secs > close).length;
}

// Removes the tab's day from the Sales Log, so a bad export can be pasted
// over cleanly.
function deployClearDaySales_(sh, dayKey) {
  const log = deploySalesLog_(false);
  if (log) {
    const keep = deployReadSalesLog_(log).filter((l) => l.day !== dayKey);
    if (log.getLastRow() > 1) log.getRange(2, 1, log.getLastRow() - 1, 5).clearContent();
    if (keep.length) log.getRange(2, 1, keep.length, 5).setValues(keep.map((l) => [l.day, l.secs, l.sku, l.qty, l.amount]));
  }
  deployApplySales_(sh, dayKey);
  deployPasteStatus_(sh, "Today's pasted sales were cleared. Paste the export again.");
}

function deployMenuClearSales() {
  const ui = SpreadsheetApp.getUi();
  const sh = SpreadsheetApp.getActive().getSheetByName(DEPLOY.SHEET);
  if (!sh) { ui.alert("There's no Deployment tab yet."); return; }
  const dayKey = sh.getRange("B1").getNote();
  const r = ui.alert("Clear today's pasted sales?",
    `This removes every sale pasted for ${deployDayLabel_(dayKey)}, and empties Total, Transactions and UPT on the Hourly Tracker. ` +
    "Use it when a wrong export was pasted (for example, from a computer on another time zone), then paste the correct one.",
    ui.ButtonSet.OK_CANCEL);
  if (r !== ui.Button.OK) return;
  const lock = LockService.getDocumentLock();
  lock.waitLock(30000);
  try { deployClearDaySales_(sh, dayKey); } finally { lock.releaseLock(); }
  SpreadsheetApp.getActive().toast("Cleared. Paste the correct export into the yellow cell.", "Items sold", 8);
}

/* ---------- Hourly Notes ---------- */

// Title bar, an hour header row, and one tall wrapping box per open hour,
// each lined up under that hour on the grid. notes = { hour: text }.
function deployWriteNotes_(sh, top, hours, notes) {
  const span = 60 / DEPLOY.SLOT_MIN, lastCol = DEPLOY.COL.GRID + deploySlotCount_() - 1;
  const pink = "#b5577a", grey = "#d9d9d9", filler = "#f4eff1";

  sh.getRange(top, 1, 1, lastCol).setBackground(pink);
  sh.getRange(top, 3, 1, lastCol - 2).merge().setValue(DEPLOY.NOTES.TITLE) // A–B are frozen
    .setFontColor("#ffffff").setFontWeight("bold").setFontSize(12).setHorizontalAlignment("center");

  const head = new Array(lastCol).fill(""), body = new Array(lastCol).fill("");
  head[0] = "Hour";
  body[0] = "Notes";
  for (const h of hours) {
    head[deployHourCol_(h) - 1] = deployHourLabel_(h);
    body[deployHourCol_(h) - 1] = notes[h] || "";
  }
  sh.getRange(top + 1, 1, 2, lastCol).setNumberFormat("@").setValues([head, body])
    .setFontFamily("Arial").setFontSize(10)
    .setBorder(true, true, true, true, true, true, "#5b4a4e", SpreadsheetApp.BorderStyle.SOLID);
  for (const h of hours) sh.getRange(top + 1, deployHourCol_(h), 2, span).mergeAcross();

  const first = deployHourCol_(hours[0]), end = deployHourCol_(hours[hours.length - 1]) + span;
  sh.getRange(top + 1, 1, 1, lastCol).setBackground(grey).setFontWeight("bold").setHorizontalAlignment("center");
  sh.getRange(top + 2, 1).setFontWeight("bold").setHorizontalAlignment("center").setVerticalAlignment("middle");
  sh.getRange(top + 1, 2, 2, first - 2).setBackground(filler).setBorder(null, null, null, null, false, false);
  if (end <= lastCol) sh.getRange(top + 1, end, 2, lastCol - end + 1).setBackground(filler).setBorder(null, null, null, null, false, false);
  sh.getRange(top + 2, first, 1, end - first).setWrap(true).setVerticalAlignment("top").setHorizontalAlignment("left");
  sh.setRowHeight(top, 26);
  sh.setRowHeight(top + 1, 22);
  sh.setRowHeight(top + 2, DEPLOY.NOTES.BOX_HEIGHT);
}

// { hour: text } from a tab's notes ({} if it has none).
function deployReadNotes_(sh) {
  const hit = sh.createTextFinder(DEPLOY.NOTES.TITLE).matchEntireCell(true).findNext();
  if (!hit) return {};
  const lastCol = DEPLOY.COL.GRID + deploySlotCount_() - 1;
  const [head, body] = sh.getRange(hit.getRow() + 1, 1, 2, lastCol).getValues();
  const out = {};
  head.forEach((v, i) => {
    const m = i > 0 && String(v).trim() ? deployParseBreakTime_(String(v).trim()) : null;
    if (m !== null && String(body[i]).trim()) out[Math.floor(m / 60)] = body[i];
  });
  return out;
}

function deployTrackerRow_(sh) {
  const hit = sh.createTextFinder(DEPLOY.TRACKER.TITLE).matchEntireCell(true).findNext();
  return hit ? hit.getRow() : 0;
}

function deployMenuBuildToday() {
  const ui = SpreadsheetApp.getUi();
  const cur = SpreadsheetApp.getActive().getSheetByName(DEPLOY.SHEET);
  if (cur && cur.getRange("B1").getNote() === deployTodayKey_()) {
    const r = ui.alert("Rebuild today's deployment?", "Today's tab already exists. Rebuilding pulls fresh shifts from When I Work and replaces any changes made to the grid today. Numbers in the Hourly Tracker are kept.", ui.ButtonSet.OK_CANCEL);
    if (r !== ui.Button.OK) return;
  }
  let roster;
  try { roster = deployBuild(); } catch (e) { ui.alert("Couldn't build the deployment", e.message, ui.ButtonSet.OK); return; }
  const clash = deployClashText_(roster.map((p) => p.name));
  if (clash) ui.alert(`Built today's deployment — ${roster.length} people scheduled.` + clash);
  else SpreadsheetApp.getActive().toast(`Built today's deployment — ${roster.length} people scheduled.`);
}

// Checks and stores the When I Work "entire schedule" link.
function deployMenuSetGlobalFeed() {
  const ui = SpreadsheetApp.getUi();
  const props = PropertiesService.getScriptProperties();
  const current = props.getProperty(DEPLOY.GLOBAL_FEED_PROP);
  const r = ui.prompt("When I Work link",
    (current ? "A link is already set. Paste a new one to replace it (for example after it's been reset in When I Work).\n\n" : "") +
    "Paste the When I Work \"entire schedule\" calendar link (it ends in /global.ics). It's stored in the script, not in the sheet.",
    ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  const url = r.getResponseText().trim();
  if (!url) return;
  let byName;
  try { byName = deploySplitGlobalIcs_(deployFetchFeed_(url)); }
  catch (e) { ui.alert("Couldn't read that link: " + e.message); return; }
  const names = Object.keys(byName);
  if (!names.length) { ui.alert("That link worked, but it has no named shifts in it. Is it the \"entire schedule\" link?"); return; }
  props.setProperty(DEPLOY.GLOBAL_FEED_PROP, url);
  ui.alert(`Saved. The schedule has shifts for ${names.length} people.` + deployClashText_(names));
}

function deployMenuBuildDate() {
  const ui = SpreadsheetApp.getUi();
  const r = ui.prompt("Build deployment for a date", "Date as YYYY-MM-DD (e.g. 2026-10-16):", ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  const key = r.getResponseText().trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) { ui.alert("Please use the format YYYY-MM-DD."); return; }
  let roster;
  try { roster = deployBuild(key); } catch (e) { ui.alert("Couldn't build the deployment", e.message, ui.ButtonSet.OK); return; }
  SpreadsheetApp.getActive().toast(`Built ${deployDayLabel_(key)} — ${roster.length} people scheduled.`);
}

// Time-driven: builds today's tab once, early morning. Never overwrites a
// day that's already been built (so edits made on the day are safe).
function deployDailyTrigger() {
  const cur = SpreadsheetApp.getActive().getSheetByName(DEPLOY.SHEET);
  if (cur && cur.getRange("B1").getNote() === deployTodayKey_()) return;
  deployBuild();
}

function deployInstallTrigger() {
  deployRemoveTrigger(true);
  ScriptApp.newTrigger("deployDailyTrigger").timeBased().everyDays(1).atHour(DEPLOY.AUTO_BUILD_HOUR).inTimezone(DEPLOY.TZ).create();
  SpreadsheetApp.getActive().toast(`Daily auto-build is on — around ${DEPLOY.AUTO_BUILD_HOUR}am every day.`);
}

function deployRemoveTrigger(quiet) {
  ScriptApp.getProjectTriggers().filter((t) => t.getHandlerFunction() === "deployDailyTrigger").forEach((t) => ScriptApp.deleteTrigger(t));
  if (quiet !== true) SpreadsheetApp.getActive().toast("Daily auto-build is off.");
}

/* ===================== served to the app ===================== */

// GET ?sheet=deployment — today's grid as it currently stands (including any
// hand edits), one entry per person. The When I Work link is never sent.
function getDeploymentForApp() {
  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName(DEPLOY.SHEET);
  const codes = deployReadCodes_().map(({ code, label, bg, fg }) => ({ code, label, bg, fg }));
  if (!sh) return { ok: true, deployment: null, codes };
  const dayKey = sh.getRange("B1").getNote();
  const n = deploySlotCount_();
  const tracker = deployTrackerRow_(sh);
  const last = tracker ? tracker - 1 : sh.getLastRow(); // staff rows end above the Hourly Tracker
  const people = [];
  if (last >= DEPLOY.FIRST_STAFF_ROW) {
    const rows = sh.getRange(DEPLOY.FIRST_STAFF_ROW, 1, last - DEPLOY.FIRST_STAFF_ROW + 1, DEPLOY.COL.GRID + n - 1).getDisplayValues()
      .filter((r) => String(r[0]).trim());
    // Two people can share initials; the app asks which name is theirs.
    for (const r of rows) {
      const name = String(r[0]).trim();
      const initials = deployInitials_(name);
      const blocks = deployBlocksFromSlots_(r.slice(DEPLOY.COL.GRID - 1));
      people.push({
        name, initials, shift: String(r[1]).trim(),
        breaks: [r[2], r[3], r[4]].map((x) => String(x).trim()).filter(Boolean),
        start: blocks.length ? blocks[0].start : null, end: blocks.length ? blocks[blocks.length - 1].end : null, blocks,
      });
    }
  }
  return { ok: true, deployment: { date: dayKey, label: dayKey ? deployDayLabel_(dayKey) : "", slotMinutes: DEPLOY.SLOT_MIN, people }, codes };
}

// Node test harness hook (ignored by Apps Script)
if (typeof module !== "undefined") {
  module.exports = { DEPLOY, DEFAULT_DEPLOY_CODES, deployParseIcs_, deployBlocksForDay_, deployBuildRoster_, deployScheduleBreaks_, deploySlotsFor_, deployBlocksFromSlots_, deployFmtTime_, deployDayLabel_, deployRequiredBreaks_, deployLocalParts_, DEPLOY_TRACKER_ROWS, deployTrackerValues_, deployWriteTracker_, deployReadTracker_, deployHourCol_, deployColLetter_, deployWriteSheet_, getDeploymentForApp, deployParseBreakTime_, deployBreaksFromSlots_, deployMoveBreaksInSlots_, deployOnEdit, deploySplitGlobalIcs_, deployBuild, deployInitials_, deployInitialsClashes_, deployWriteNotes_, deployReadNotes_, deployExpiredArchives_, deployTidyArchives_, deployParsePlan_, deployDayPlan_, deployParseItemsSold_, deployMergeSales_, deploySalesByHour_, deployHandlePaste_, deployReadPlan_, deployGoalCells_, deployPasteCol_, deployTrackerLayout_, deployFillFloorLeads_, deployApplySales_, deployMenuSetMonthGoal, deploySameWeek_, deployBreakSlotKey_, deploySyncBreaks_, deployGridRules_, deployOutsideHours_, deployClearDaySales_ };
}
