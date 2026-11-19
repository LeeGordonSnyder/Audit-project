"use strict";

/* ---------- Daily notes (Home) ----------
   Shift notes from the "Daily Notes" tab (Notes.gs add-on). Each note has
   the day and its writer filled in, who else was involved, and two
   sections: Tasks completed and Needs to be done. ‹ › step through the
   days. Notes can be edited (stamped with who and when) and commented on.
   A note being written is kept on the phone as a draft until it's posted.
   Today also shows what yesterday's notes left to do. Hidden when the
   sheet has no notes add-on. */

const NOTES_DAYS_BACK = 90; // the sheet sends this many days; older ones stay on the tab

let notesDay = "";
let noteEditing = null; // { id, done, todo, involved } while a note is being edited
let noteComposing = false; // "+ New note" opened on a day you've already posted
let noteCommenting = ""; // id of the note whose comment box is open
const notePeopleOpen = new Set(); // forms showing the full roster to pick from

function notesToday() {
  return todayISO();
}

function shiftDay(iso, by) {
  const [y, m, d] = iso.split("-").map(Number);
  return localDayISO(new Date(y, m - 1, d + by));
}

function noteDayLabel(iso) {
  if (iso === notesToday()) return "Today";
  if (iso === shiftDay(notesToday(), -1)) return "Yesterday";
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
}

function noteLongDate(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" });
}

function noteClock(at) {
  const d = new Date(at);
  return isNaN(d) ? "" : d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function loadNoteDrafts() {
  return loadJSON(STORE.noteDrafts, {});
}

function noteDraft(day) {
  return loadNoteDrafts()[day] || { done: "", todo: "", involved: [] };
}

function saveNoteDraft(day, draft) {
  const drafts = loadNoteDrafts();
  if (!draft || (!draft.done.trim() && !draft.todo.trim() && !draft.involved.length)) delete drafts[day];
  else drafts[day] = draft;
  saveJSON(STORE.noteDrafts, drafts);
}

function notesForDay(day) {
  const saved = loadJSON(STORE.notes, null);
  return ((saved && saved.notes) || []).filter((n) => n.date === day);
}

// The note form, for a new note (mode "new") or an edit (mode "edit").
function noteFormHtml(mode, { id = "", author, done, todo, involved }) {
  const key = mode === "edit" ? id : "new";
  const roster = [...new Set(loadStaffRoster().map((s) => String(s).toUpperCase()))].filter((i) => i !== author);
  const chosen = involved.filter((i) => i !== author);
  const showAll = notePeopleOpen.has(key);
  const people = (showAll ? [...new Set(roster.concat(chosen))] : chosen)
    .map((i) => `<button type="button" class="chip${chosen.includes(i) ? " active" : ""}" data-action="note-person" data-initials="${escapeHtml(i)}">${escapeHtml(i)}</button>`)
    .join("");
  return `
    <div class="note-form" data-mode="${mode}" data-id="${escapeHtml(id)}">
      <div class="note-form-head">${
        mode === "edit"
          ? `Editing ${escapeHtml(author)}'s note`
          : `${escapeHtml(noteLongDate(notesDay))} · <strong>${escapeHtml(author || "—")}</strong>`
      }</div>
      <label>Tasks completed<textarea class="nf-done" rows="4" maxlength="2000" placeholder="What got done this shift…">${escapeHtml(done)}</textarea></label>
      <label>Needs to be done<textarea class="nf-todo" rows="3" maxlength="2000" placeholder="What's left for the next shift…">${escapeHtml(todo)}</textarea></label>
      <div class="nf-people">
        <span class="nf-people-label">Also involved</span>
        <div class="chips">${people}<button type="button" class="link-btn" data-action="note-people">${showAll ? "Done" : chosen.length ? "+ Add or change" : "+ Add people"}</button></div>
      </div>
      <div class="row">
        <button type="button" class="btn primary" data-action="${mode === "edit" ? "note-save" : "note-post"}">${mode === "edit" ? "Save" : "Post"}</button>
        ${mode === "edit" || noteComposing ? `<button type="button" class="btn secondary" data-action="note-cancel">Cancel</button>` : ""}
      </div>
    </div>`;
}

function noteCardHtml(n) {
  if (noteEditing && noteEditing.id === n.id) return `<article class="note editing">${noteFormHtml("edit", { ...noteEditing, author: n.by })}</article>`;
  const section = (title, text) =>
    text ? `<div class="note-sec"><h4>${title}</h4><p>${escapeHtml(text)}</p></div>` : "";
  const edited = n.editedAt ? ` · edited${n.editedBy ? ` by ${escapeHtml(n.editedBy)}` : ""} ${escapeHtml(noteClock(n.editedAt))}` : "";
  const comments = n.comments || [];
  const open = noteCommenting === n.id;
  return `
    <article class="note" data-id="${escapeHtml(n.id)}">
      <div class="note-head">
        <span class="note-by">${escapeHtml(n.by)}</span>
        ${n.involved.length ? `<span class="note-with">with ${escapeHtml(n.involved.join(", "))}</span>` : ""}
        <span class="note-time">${escapeHtml(noteClock(n.postedAt))}${edited}</span>
      </div>
      ${section("Tasks completed", n.done)}
      ${section("Needs to be done", n.todo)}
      ${
        comments.length
          ? `<ul class="note-comments">${comments
              .map((c) => `<li><span class="note-c-by">${escapeHtml(c.initials)}</span> <span class="note-c-time">${escapeHtml(noteClock(c.at))}</span><br>${escapeHtml(c.text)}</li>`)
              .join("")}</ul>`
          : ""
      }
      ${
        open
          ? `<div class="note-comment-form">
              <input type="text" class="nc-text" maxlength="500" placeholder="Comment as ${escapeHtml(currentInitials())}…" autocomplete="off" enterkeyhint="send">
              <button type="button" class="btn primary small" data-action="note-comment-post" data-id="${escapeHtml(n.id)}">Post</button>
            </div>`
          : ""
      }
      <div class="note-actions">
        <button type="button" class="link-btn" data-action="note-edit" data-id="${escapeHtml(n.id)}">Edit</button>
        <button type="button" class="link-btn" data-action="note-comment" data-id="${escapeHtml(n.id)}">${open ? "Cancel comment" : `Comment${comments.length ? ` (${comments.length})` : ""}`}</button>
      </div>
    </article>`;
}

// While someone is typing, a background refresh must not redraw under them.
function notesBusyTyping() {
  const el = document.activeElement;
  return !!el && !!el.closest && !!el.closest("#home-notes-wrap .note-form, #home-notes-wrap .note-comment-form");
}

function renderDailyNotes({ force = false } = {}) {
  const wrap = document.getElementById("home-notes-wrap");
  const saved = loadJSON(STORE.notes, null);
  wrap.hidden = !saved;
  if (!saved || (!force && notesBusyTyping())) return;
  const today = notesToday();
  if (!notesDay || notesDay > today) notesDay = today;
  const oldest = shiftDay(today, -NOTES_DAYS_BACK);

  document.getElementById("notes-day").textContent = noteDayLabel(notesDay);
  document.getElementById("notes-prev").disabled = notesDay <= oldest;
  document.getElementById("notes-next").disabled = notesDay >= today;

  const me = currentInitials().toUpperCase();
  const notes = notesForDay(notesDay);
  const mine = notes.some((n) => n.by === me);
  // today opens the form for anyone who hasn't posted yet; other days ask first
  const showForm = !noteEditing && (noteComposing || (notesDay === today && !mine));

  // Today: what yesterday's notes left to do
  let carry = "";
  if (notesDay === today) {
    const left = notesForDay(shiftDay(today, -1)).filter((n) => n.todo.trim());
    if (left.length) {
      carry = `
        <details class="note-carry" open>
          <summary>Left to do from yesterday (${left.length})</summary>
          ${left.map((n) => `<p><span class="note-c-by">${escapeHtml(n.by)}</span> ${escapeHtml(n.todo)}</p>`).join("")}
        </details>`;
    }
  }

  const list = notes.length
    ? notes.map(noteCardHtml).join("")
    : showForm
    ? ""
    : `<p class="hint note-empty">No notes for this day.</p>`;
  const form = showForm
    ? noteFormHtml("new", { author: me, ...noteDraft(notesDay) })
    : noteEditing
    ? ""
    : `<button type="button" class="btn secondary block" data-action="note-new">+ New note${notesDay === today ? "" : ` for ${escapeHtml(noteDayLabel(notesDay))}`}</button>`;
  const older = notesDay <= oldest ? `<p class="hint">Older notes are on the <b>Daily Notes</b> tab in the sheet.</p>` : "";
  document.getElementById("home-notes").innerHTML = carry + list + form + older;
}

// Reads a note form's fields.
function readNoteForm(form) {
  return {
    done: form.querySelector(".nf-done").value,
    todo: form.querySelector(".nf-todo").value,
    involved: [...form.querySelectorAll('[data-action="note-person"].active')].map((b) => b.dataset.initials),
  };
}

// Sends one change and shows the list the sheet answers with.
async function noteSend(btn, type, payload, verb) {
  const status = document.getElementById("notes-status");
  if (!requireOnline(status, verb)) return false;
  setStatus(status, "");
  return withBusy(btn, async () => {
    try {
      const res = await api.note(type, payload);
      if (!Array.isArray(res.notes)) throw new Error("the sheet's Code.gs is missing the notes line in doPost (see backend/README.md)");
      saveNotes(res.notes);
      return true;
    } catch (e) {
      setStatus(status, `Couldn't save: ${e.message || e}. Nothing was ${verb}; your text is still here.`, true);
      return false;
    }
  });
}

function initDailyNotes() {
  const wrap = document.getElementById("home-notes-wrap");
  const formOf = (el) => el.closest(".note-form");
  // keep what's typed: drafts for a new note, memory for an edit
  wrap.addEventListener("input", (e) => {
    const form = formOf(e.target);
    if (!form) return;
    if (form.dataset.mode === "new") saveNoteDraft(notesDay, readNoteForm(form));
    else if (noteEditing) Object.assign(noteEditing, readNoteForm(form));
  });
  wrap.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && e.target.classList.contains("nc-text")) wrap.querySelector('[data-action="note-comment-post"]').click();
  });
  onAction(wrap, {
    "notes-prev": () => {
      notesDay = shiftDay(notesDay, -1);
      noteComposing = false;
      renderDailyNotes({ force: true });
    },
    "notes-next": () => {
      notesDay = shiftDay(notesDay, 1);
      noteComposing = false;
      renderDailyNotes({ force: true });
    },
    "notes-today": () => {
      notesDay = notesToday();
      renderDailyNotes({ force: true });
    },
    "note-person": (el) => {
      el.classList.toggle("active");
      const form = formOf(el);
      if (form.dataset.mode === "new") saveNoteDraft(notesDay, readNoteForm(form));
      else if (noteEditing) Object.assign(noteEditing, readNoteForm(form));
    },
    "note-people": (el) => {
      const form = formOf(el);
      const key = form.dataset.mode === "edit" ? form.dataset.id : "new";
      if (form.dataset.mode === "new") saveNoteDraft(notesDay, readNoteForm(form));
      else if (noteEditing) Object.assign(noteEditing, readNoteForm(form));
      if (notePeopleOpen.has(key)) notePeopleOpen.delete(key);
      else notePeopleOpen.add(key);
      renderDailyNotes({ force: true });
    },
    "note-new": () => {
      noteComposing = true;
      renderDailyNotes({ force: true });
      wrap.querySelector(".nf-done").focus();
    },
    "note-cancel": () => {
      noteEditing = null;
      noteComposing = false;
      notePeopleOpen.clear();
      renderDailyNotes({ force: true });
    },
    "note-post": async (el) => {
      const draft = readNoteForm(formOf(el));
      if (!draft.done.trim() && !draft.todo.trim()) {
        setStatus("notes-status", "Write something under Tasks completed or Needs to be done first.", true);
        return;
      }
      if (await noteSend(el, "noteadd", { date: notesDay, ...draft }, "posted")) {
        saveNoteDraft(notesDay, null);
        noteComposing = false;
        notePeopleOpen.delete("new");
        setStatus("notes-status", "Posted.", false);
        renderDailyNotes({ force: true });
      }
    },
    "note-edit": (el) => {
      const n = notesForDay(notesDay).find((x) => x.id === el.dataset.id);
      if (!n) return;
      noteEditing = { id: n.id, done: n.done, todo: n.todo, involved: n.involved.slice() };
      noteCommenting = "";
      renderDailyNotes({ force: true });
    },
    "note-save": async (el) => {
      const form = formOf(el);
      const edit = { id: form.dataset.id, ...readNoteForm(form) };
      if (!edit.done.trim() && !edit.todo.trim()) {
        setStatus("notes-status", "A note needs something in at least one section.", true);
        return;
      }
      if (await noteSend(el, "noteedit", edit, "saved")) {
        noteEditing = null;
        notePeopleOpen.delete(edit.id);
        setStatus("notes-status", "Saved.", false);
        renderDailyNotes({ force: true });
      }
    },
    "note-comment": (el) => {
      noteCommenting = noteCommenting === el.dataset.id ? "" : el.dataset.id;
      renderDailyNotes({ force: true });
      const input = wrap.querySelector(".nc-text");
      if (input) input.focus();
    },
    "note-comment-post": async (el) => {
      const input = el.closest(".note-comment-form").querySelector(".nc-text");
      const text = input.value.trim();
      if (!text) return input.focus();
      if (await noteSend(el, "notecomment", { noteId: el.dataset.id, text }, "posted")) {
        noteCommenting = "";
        setStatus("notes-status", "Comment posted.", false);
        renderDailyNotes({ force: true });
      }
    },
  });
}
