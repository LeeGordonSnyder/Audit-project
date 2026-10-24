"use strict";

function normalize(s) {
  return (s || "").toString().trim().toLowerCase();
}

function escapeHtml(str) {
  return (str == null ? "" : String(str))
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function uid() {
  return Date.now() + "-" + Math.random().toString(36).slice(2, 8);
}

function plural(n, one, many) {
  return `${n} ${n === 1 ? one : many || one + "s"}`;
}

// Local calendar date as YYYY-MM-DD. toISOString() converts to UTC first,
// which rolls the date forward for the last several hours of every local
// day anywhere behind UTC — so build it from local parts instead.
function localDayISO(d) {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function todayISO() {
  return localDayISO(new Date());
}

// Dates come back from the sheet in more than one shape: the app writes
// plain "YYYY-MM-DD" day strings, but Sheets may auto-type that cell as a
// Date and hand it back as a full ISO timestamp. Either way, return a Date
// at local midnight of that day (or null when blank/unparseable).
function parseDay(value) {
  if (!value) return null;
  const s = String(value).trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const d = new Date(s);
  if (isNaN(d)) return null;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

// Whole local days between a past date and today (0 = today).
function daysAgo(value) {
  const day = parseDay(value);
  if (!day) return null;
  const today = parseDay(todayISO());
  return Math.round((today - day) / 86400000);
}

// Monday 00:00 local of the week containing `d` (defaults to now).
function startOfWeek(d = new Date()) {
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dow = (start.getDay() + 6) % 7; // Mon = 0
  start.setDate(start.getDate() - dow);
  return start;
}

function formatDay(value) {
  const d = parseDay(value);
  return d ? d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "—";
}

function formatAge(days) {
  if (days == null) return "";
  if (days <= 0) return "today";
  if (days === 1) return "1 day";
  return `${days} days`;
}

function setStatus(elOrId, message, isError) {
  const el = typeof elOrId === "string" ? document.getElementById(elOrId) : elOrId;
  if (!el) return;
  el.textContent = message;
  el.classList.toggle("error", !!isError);
}

function csvEscape(val) {
  const s = val == null ? "" : String(val);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function downloadCsv(filename, rows) {
  const csv = rows.map((row) => row.map(csvEscape).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
