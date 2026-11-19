/* ============================================================================
   Oakridge Product Suite — Daily notes (Notes.gs)

   Shift notes for the app's Home screen, kept in the shared Google Sheet:
   a "Daily Notes" tab (one row per note) and a "Note Comments" tab (one row
   per comment). Each note has the day, who wrote it, who else was involved,
   and two sections: Tasks completed and Needs to be done. Anyone can edit a
   note (the edit is stamped with who and when) or comment on it.

   Add this as a NEW file in the existing Apps Script project (Files → + →
   Script → "Notes"). Code.gs already has the two lines that call it.
   ========================================================================== */

const NOTES = {
  SHEET: "Daily Notes",
  HEADER: ["ID", "DATE", "BY", "ALSO INVOLVED", "TASKS COMPLETED", "NEEDS TO BE DONE", "POSTED", "EDITED", "EDITED BY"],
  COL: { ID: 1, DATE: 2, BY: 3, INVOLVED: 4, DONE: 5, TODO: 6, POSTED: 7, EDITED: 8, EDITED_BY: 9 },
  COMMENTS_SHEET: "Note Comments",
  COMMENTS_HEADER: ["ID", "NOTE ID", "NOTE DATE", "BY", "COMMENT", "POSTED"],
  DAYS_SENT: 90, // the app gets this many days of notes; older ones stay on the tab
  MAX_TEXT: 2000,
  MAX_COMMENT: 500,
  CACHE_KEY: "doGet:notes", // Code.gs caches GETs for 10s; a change clears it
};

// GET ?sheet=notes
function getNotesForApp() {
  return { ok: true, notes: notesRead_() };
}

// POST { type: "noteadd" | "noteedit" | "notecomment", ... }
// Answers with the whole recent list, so the app shows the change straight away.
function handleNotePost(body) {
  const who = notesInitials_(body.initials);
  if (!who) return jsonResponse({ ok: false, error: "Sign in with your initials first." });
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const now = new Date();
    if (body.type === "noteadd" || body.type === "noteedit") {
      const done = notesText_(body.done, NOTES.MAX_TEXT);
      const todo = notesText_(body.todo, NOTES.MAX_TEXT);
      if (!done && !todo) return jsonResponse({ ok: false, error: "Write something in at least one section." });
      const sh = notesSheet_(NOTES.SHEET, NOTES.HEADER, [NOTES.COL.ID]);
      if (body.type === "noteadd") {
        const day = notesDay_(body.date) || notesDay_(now);
        sh.appendRow([Utilities.getUuid(), day, who, notesInvolved_(body.involved, who), done, todo, now, "", ""]);
        sh.getRange(sh.getLastRow(), NOTES.COL.DATE).setNumberFormat("@").setValue(day);
      } else {
        const row = notesFindRow_(sh, body.id);
        if (!row) return jsonResponse({ ok: false, error: "That note isn't there any more. Refresh to see the latest." });
        const author = notesInitials_(sh.getRange(row, NOTES.COL.BY).getValue());
        sh.getRange(row, NOTES.COL.INVOLVED, 1, 3).setValues([[notesInvolved_(body.involved, author), done, todo]]);
        sh.getRange(row, NOTES.COL.EDITED, 1, 2).setValues([[now, who]]);
      }
    } else if (body.type === "notecomment") {
      const text = notesText_(body.text, NOTES.MAX_COMMENT);
      if (!text) return jsonResponse({ ok: false, error: "The comment is empty." });
      const notes = notesSheet_(NOTES.SHEET, NOTES.HEADER, [NOTES.COL.ID]);
      const row = notesFindRow_(notes, body.noteId);
      if (!row) return jsonResponse({ ok: false, error: "That note isn't there any more. Refresh to see the latest." });
      const day = notesDay_(notes.getRange(row, NOTES.COL.DATE).getValue());
      const sh = notesSheet_(NOTES.COMMENTS_SHEET, NOTES.COMMENTS_HEADER, [1, 2]);
      sh.appendRow([Utilities.getUuid(), String(body.noteId), day, who, text, now]);
      sh.getRange(sh.getLastRow(), 3).setNumberFormat("@").setValue(day);
    } else {
      return jsonResponse({ ok: false, error: "Unknown notes request: " + body.type });
    }
    SpreadsheetApp.flush();
    CacheService.getScriptCache().remove(NOTES.CACHE_KEY);
    return jsonResponse({ ok: true, notes: notesRead_() });
  } finally {
    lock.releaseLock();
  }
}

// Notes from the last DAYS_SENT days, each with its comments, oldest first.
function notesRead_() {
  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName(NOTES.SHEET);
  if (!sh || sh.getLastRow() < 2) return [];
  const since = notesDay_(new Date(Date.now() - NOTES.DAYS_SENT * 86400000));
  const comments = {};
  const csh = ss.getSheetByName(NOTES.COMMENTS_SHEET);
  if (csh && csh.getLastRow() > 1) {
    csh.getRange(2, 1, csh.getLastRow() - 1, NOTES.COMMENTS_HEADER.length).getValues().forEach((r) => {
      if (!String(r[1]).trim() || !String(r[4]).trim()) return;
      (comments[String(r[1])] = comments[String(r[1])] || []).push({
        id: String(r[0]), initials: notesInitials_(r[3]), text: String(r[4]), at: notesIso_(r[5]),
      });
    });
  }
  return sh.getRange(2, 1, sh.getLastRow() - 1, NOTES.HEADER.length).getValues()
    .filter((r) => String(r[0]).trim() && notesDay_(r[1]) >= since)
    .map((r) => ({
      id: String(r[0]),
      date: notesDay_(r[1]),
      by: notesInitials_(r[2]),
      involved: String(r[3]).split(/[\s,]+/).map(notesInitials_).filter(Boolean),
      done: String(r[4]),
      todo: String(r[5]),
      postedAt: notesIso_(r[6]),
      editedAt: notesIso_(r[7]),
      editedBy: notesInitials_(r[8]),
      comments: (comments[String(r[0])] || []).sort((a, b) => a.at.localeCompare(b.at)),
    }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.postedAt.localeCompare(b.postedAt));
}

function notesSheet_(name, header, hiddenCols) {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(name);
  if (sh) return sh;
  sh = ss.insertSheet(name);
  sh.getRange(1, 1, 1, header.length).setValues([header]).setFontWeight("bold");
  sh.setFrozenRows(1);
  hiddenCols.forEach((c) => sh.hideColumns(c));
  if (name === NOTES.SHEET) {
    sh.setColumnWidth(NOTES.COL.DONE, 320).setColumnWidth(NOTES.COL.TODO, 320);
    sh.getRange("E:F").setWrap(true);
    sh.getRange("G:H").setNumberFormat("mmm d, h:mm am/pm");
  } else {
    sh.setColumnWidth(5, 360);
    sh.getRange("E:E").setWrap(true);
    sh.getRange("F:F").setNumberFormat("mmm d, h:mm am/pm");
  }
  return sh;
}

function notesFindRow_(sh, id) {
  id = String(id || "").trim();
  const last = sh.getLastRow();
  if (!id || last < 2) return 0;
  const ids = sh.getRange(2, NOTES.COL.ID, last - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) if (String(ids[i][0]).trim() === id) return i + 2;
  return 0;
}

// "YYYY-MM-DD" in the script's time zone (set to Vancouver), from a Date or
// a typed day.
function notesDay_(v) {
  if (!v) return "";
  if (v instanceof Date) return isNaN(v) ? "" : Utilities.formatDate(v, Session.getScriptTimeZone(), "yyyy-MM-dd");
  const m = String(v).trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : "";
}

function notesInitials_(v) {
  return String(v || "").trim().toUpperCase().replace(/[^A-Z]/g, "").slice(0, 4);
}

// The other people on the note, as "SC, SG": never the writer, no repeats.
function notesInvolved_(list, who) {
  const seen = {};
  return (Array.isArray(list) ? list : String(list || "").split(/[\s,]+/))
    .map(notesInitials_)
    .filter((i) => i && i !== who && !seen[i] && (seen[i] = true))
    .slice(0, 12)
    .join(", ");
}

function notesText_(v, max) {
  return String(v || "").replace(/\r\n?/g, "\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, max);
}

function notesIso_(v) {
  if (!v) return "";
  const d = v instanceof Date ? v : new Date(v);
  return isNaN(d) ? "" : d.toISOString();
}

// Node test harness hook (ignored by Apps Script)
if (typeof module !== "undefined") {
  module.exports = { NOTES, getNotesForApp, handleNotePost, notesRead_, notesDay_, notesInvolved_ };
}
